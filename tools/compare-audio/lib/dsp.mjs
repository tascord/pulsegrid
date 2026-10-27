// Small DSP toolkit: FFT, spectral features, alignment, comparison metrics.
// Pure JS, no dependencies.

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  return w;
}

/** In-place radix-2 complex FFT (re/im Float64Array, length must be power of 2). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

export function magnitudeSpectrum(frame) {
  let n = 1;
  while (n < frame.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(frame.length);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * w[i];
  fft(re, im);
  const mag = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (n / 2);
  return { mag, binHz: (sr) => (k) => (k * sr) / n, n };
}

export function spectralCentroid(mag, sampleRate, n) {
  let num = 0;
  let den = 0;
  for (let k = 1; k < mag.length; k++) {
    const f = (k * sampleRate) / n;
    num += f * mag[k];
    den += mag[k];
  }
  return den > 1e-12 ? num / den : 0;
}

export function spectralRolloff(mag, sampleRate, n, frac = 0.85) {
  let total = 0;
  for (let k = 0; k < mag.length; k++) total += mag[k];
  let acc = 0;
  for (let k = 0; k < mag.length; k++) {
    acc += mag[k];
    if (acc >= total * frac) return (k * sampleRate) / n;
  }
  return 0;
}

export function rms(x, from = 0, to = x.length) {
  let s = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

export function peak(x, from = 0, to = x.length) {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export const dbfs = (v) => (v <= 1e-12 ? -Infinity : 20 * Math.log10(v));

/** RMS envelope at ~100 Hz for onset/structure comparison. */
export function rmsEnvelope(x, sampleRate, hop = Math.floor(sampleRate / 100)) {
  const n = Math.ceil(x.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = rms(x, i * hop, Math.min(x.length, (i + 1) * hop));
  return { env, hop };
}

export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(Math.max(1e-24, da * db));
}

/**
 * Find integer lag (samples of `dut` relative to `ref`) via decimated
 * cross-correlation over ±maxLagSec. Positive lag = dut starts later.
 */
export function findLag(ref, dut, sampleRate, maxLagSec = 0.5) {
  const decim = 8;
  const rd = [];
  const dd = [];
  for (let i = 0; i < ref.length; i += decim) rd.push(ref[i]);
  for (let i = 0; i < dut.length; i += decim) dd.push(dut[i]);
  const maxLag = Math.floor((maxLagSec * sampleRate) / decim);
  let bestLag = 0;
  let bestScore = -Infinity;
  const coarse = (a, b) => {
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
      num += a[i] * b[i];
      da += a[i] * a[i];
      db += b[i] * b[i];
    }
    return num / Math.sqrt(Math.max(1e-24, da * db));
  };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const start = Math.max(0, -lag);
    const end = Math.min(rd.length, dd.length - lag);
    const score = coarse(rd.slice(start, end), dd.slice(start + lag, end + lag));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Fine pass: full-rate search ±decim around the coarse peak (prefix bounded
  // to 60s so long bounces stay fast).
  const cap = Math.min(ref.length, dut.length, Math.floor(sampleRate * 60));
  let fine = bestLag * decim;
  let fineScore = -Infinity;
  for (let lag = bestLag * decim - decim; lag <= bestLag * decim + decim; lag++) {
    const r0 = Math.max(0, -lag);
    const d0 = Math.max(0, lag);
    const n = Math.min(cap - r0, cap - d0);
    if (n <= 0) continue;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i += 2) {
      const a = ref[r0 + i];
      const b = dut[d0 + i];
      num += a * b;
      da += a * a;
      db += b * b;
    }
    const score = num / Math.sqrt(Math.max(1e-24, da * db));
    if (score > fineScore) {
      fineScore = score;
      fine = lag;
    }
  }
  return { lagSamples: fine, score: fineScore };
}

/** Apply integer lag: returns [refTrim, dutTrim] overlapping views. */
export function applyLag(ref, dut, lagSamples) {
  let r0 = 0;
  let d0 = 0;
  if (lagSamples > 0) d0 = lagSamples;
  else r0 = -lagSamples;
  const len = Math.min(ref.length - r0, dut.length - d0);
  return [ref.subarray(r0, r0 + len), dut.subarray(d0, d0 + len)];
}

/** RBJ cookbook lowpass coefficients. Returns {b0,b1,b2,a1,a2} (a0 normalized). */
export function lowpassCoeffs(sampleRate, freq, Q = 0.8) {
  const w0 = (2 * Math.PI * Math.max(20, Math.min(sampleRate / 2 - 1, freq))) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw = Math.cos(w0);
  const b0 = (1 - cosw) / 2;
  const b1 = 1 - cosw;
  const b2 = (1 - cosw) / 2;
  const a0 = 1 + alpha;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1, a2 };
}

export function biquadLowpass(x, sampleRate, freq, Q = 0.8) {
  const { b0, b1, b2, a1, a2 } = lowpassCoeffs(sampleRate, freq, Q);
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

export function oscSample(type, phase) {
  const p = phase % 1;
  switch (type) {
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'saw':
    case 'sawtooth':
      return 2 * p - 1;
    case 'triangle':
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 'sine':
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Equal-power stereo pan gains for pan in [-1, 1]. */
export function panGains(pan) {
  const p = Math.max(-1, Math.min(1, pan || 0));
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** Per-band энергии (low <300Hz, mid 300-4k, high >4k) from one magnitude spectrum. */
export function bandEnergies(mag, sampleRate, n) {
  const bands = [0, 0, 0];
  for (let k = 1; k < mag.length; k++) {
    const f = (k * sampleRate) / n;
    const e = mag[k] * mag[k];
    bands[f < 300 ? 0 : f < 4000 ? 1 : 2] += e;
  }
  const total = bands[0] + bands[1] + bands[2] || 1;
  return bands.map((b) => b / total);
}
