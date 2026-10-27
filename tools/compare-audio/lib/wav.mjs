// Minimal WAV reader/writer (pure Node, no native deps).
// Reads PCM 16/24/32-bit int + 32/64-bit float, any channel count,
// with chunk scanning (handles JUNK/bext/LIST/cart headers like wt_bad_day.wav).
// Writes 16-bit PCM stereo (listening copies) and 32-bit float (analysis).

import fs from 'node:fs';

function ascii(buf, off, len) {
  return String.fromCharCode(...buf.subarray(off, off + len));
}

export function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  if (ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WAVE') {
    throw new Error(`${filePath}: not a RIFF/WAVE file`);
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = ascii(buf, off, 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    off = body + size + (size % 2); // word-aligned
  }
  if (!fmt) throw new Error(`${filePath}: missing fmt chunk`);
  if (!data) throw new Error(`${filePath}: missing data chunk`);
  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(data.length / (bytesPerSample * channels));
  const ch = [];
  for (let c = 0; c < channels; c++) ch.push(new Float32Array(frames));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytesPerSample;
      let v;
      if (audioFormat === 3 && bitsPerSample === 32) v = dv.getFloat32(o, true);
      else if (audioFormat === 3 && bitsPerSample === 64) v = dv.getFloat64(o, true);
      else if (bitsPerSample === 16) v = dv.getInt16(o, true) / 32768;
      else if (bitsPerSample === 24) {
        let s = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
        if (s & 0x800000) s -= 0x1000000;
        v = s / 8388608;
      } else if (bitsPerSample === 32) v = dv.getInt32(o, true) / 2147483648;
      else if (bitsPerSample === 8) v = (dv.getUint8(o) - 128) / 128;
      else throw new Error(`${filePath}: unsupported format (${audioFormat}, ${bitsPerSample}-bit)`);
      ch[c][i] = v;
    }
  }
  return { sampleRate, channels, frames, data: ch };
}

function interleave(channelsData, bits) {
  const nCh = channelsData.length;
  const frames = channelsData[0].length;
  const bytesPerSample = bits / 8;
  const out = Buffer.alloc(frames * nCh * bytesPerSample);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const o = (i * nCh + c) * bytesPerSample;
      const v = Math.max(-1, Math.min(1, channelsData[c][i]));
      if (bits === 16) out.writeInt16LE(Math.round(v * 32767), o);
      else out.writeFloatLE(v, o);
    }
  }
  return out;
}

export function writeWav(filePath, channelsData, sampleRate, { float32 = false } = {}) {
  const bits = float32 ? 32 : 16;
  const pcm = interleave(channelsData, bits);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(float32 ? 3 : 1, 20);
  header.writeUInt16LE(channelsData.length, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channelsData.length * bits) / 8, 28);
  header.writeUInt16LE((channelsData.length * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

/** Linear-interpolation resample of one channel to a new rate. */
export function resample(channel, fromRate, toRate) {
  if (fromRate === toRate) return channel;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(channel.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = channel[Math.min(i0, channel.length - 1)];
    const b = channel[Math.min(i0 + 1, channel.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Average channels to mono. */
export function toMono(wav) {
  const { frames, data } = wav;
  const mono = new Float32Array(frames);
  for (let c = 0; c < data.length; c++) {
    for (let i = 0; i < frames; i++) mono[i] += data[c][i] / data.length;
  }
  return mono;
}

/** Peak-normalize mono/stereo data in place to a target peak; returns applied gain. */
export function normalizePeak(channelsData, target = 0.89) {
  let peak = 0;
  for (const ch of channelsData) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const g = peak > 1e-9 ? target / peak : 1;
  if (g !== 1) for (const ch of channelsData) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return g;
}
