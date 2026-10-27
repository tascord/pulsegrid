import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';

/**
 * Re-encode an animated GIF at a smaller size so it stays animatable.
 *
 * Why this exists: a 12 MB GIF can mean hundreds of full frames, which needs
 * gigabytes of RAM once decoded — browsers then refuse to animate it and show
 * a black square. Compositing every frame at full size and downscaling keeps
 * the animation while cutting decoded memory by 10-100x.
 */

const OUTPUT_BUDGET_CHARS = 8_000_000; // ~6 MB binary; comfortable for IndexedDB
const MAX_SAMPLE_PIXELS = 500_000; // pixels fed to the color quantizer

interface Attempt {
  maxDim: number;
  maxFrames: number;
}

// High quality first; smaller/fewer frames only if the output is still huge.
const ATTEMPTS: Attempt[] = [
  { maxDim: 880, maxFrames: 48 },
  { maxDim: 640, maxFrames: 32 },
  { maxDim: 480, maxFrames: 24 },
];

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('decode'));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsDataURL(blob);
  });
}

function sampleWithDelays(
  frames: ParsedFrame[],
  delays: number[],
  maxFrames: number
): { frames: ParsedFrame[]; delays: number[] } {
  if (frames.length <= maxFrames) return { frames, delays };
  const step = Math.ceil(frames.length / maxFrames);
  const kept: ParsedFrame[] = [];
  const keptDelays: number[] = [];
  for (let i = 0; i < frames.length; i += step) {
    kept.push(frames[i]);
    let d = 0;
    for (let j = i; j < Math.min(i + step, delays.length); j++) d += delays[j];
    keptDelays.push(Math.max(20, d));
  }
  return { frames: kept, delays: keptDelays };
}

function renderAttempt(
  all: ParsedFrame[],
  srcW: number,
  srcH: number,
  maxDim: number,
  maxFrames: number
): Uint8Array {
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));

  const delays = all.map((f) => Math.max(20, f.delay ?? 100));
  const { frames, delays: keptDelays } = sampleWithDelays(all, delays, maxFrames);

  // Composite at the (small) target size — never allocate a full-res canvas.
  const comp = document.createElement('canvas');
  comp.width = dw;
  comp.height = dh;
  const ctx = comp.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d');
  if (!patchCtx) throw new Error('canvas');

  let snapshot: ImageData | null = null;
  let prev: ParsedFrame | null = null;
  const captured: Uint8ClampedArray[] = [];
  let hasAlpha = false;

  for (const frame of frames) {
    const d = frame.dims;
    if (!d || d.width <= 0 || d.height <= 0) continue;
    if (prev) {
      if (prev.disposalType === 2) {
        const pd = prev.dims;
        ctx.clearRect(
          Math.floor(pd.left * scale) - 1,
          Math.floor(pd.top * scale) - 1,
          Math.ceil(pd.width * scale) + 2,
          Math.ceil(pd.height * scale) + 2
        );
      } else if (prev.disposalType === 3 && snapshot) {
        ctx.putImageData(snapshot, 0, 0);
      }
    }
    patchCanvas.width = d.width;
    patchCanvas.height = d.height;
    const patch = frame.patch as Uint8ClampedArray<ArrayBuffer>;
    patchCtx.putImageData(new ImageData(patch, d.width, d.height), 0, 0);
    ctx.drawImage(patchCanvas, d.left * scale, d.top * scale, d.width * scale, d.height * scale);
    if (frame.disposalType === 3) snapshot = ctx.getImageData(0, 0, dw, dh);
    prev = frame;
    const img = ctx.getImageData(0, 0, dw, dh);
    captured.push(img.data);
    if (!hasAlpha) {
      for (let i = 3; i < img.data.length; i += 16) {
        if (img.data[i] < 128) {
          hasAlpha = true;
          break;
        }
      }
    }
  }
  if (captured.length === 0) throw new Error('decode');

  const fmt = hasAlpha ? 'rgba4444' : 'rgb565';
  if (hasAlpha) {
    // Normalize all transparent pixels to one exact color so they quantize
    // to a single palette entry we can flag as transparent.
    for (const data of captured) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] <= 127) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 0;
        }
      }
    }
  }

  // One shared palette for all frames: faster to encode and smaller on disk.
  const picked = captured.filter(
    (_, i) => i % Math.max(1, Math.floor(captured.length / 6)) === 0
  ).slice(0, 6);
  const stride = Math.max(1, Math.floor((picked.length * dw * dh) / MAX_SAMPLE_PIXELS));
  const sampleCount = Math.ceil((picked.length * dw * dh) / stride);
  const sample = new Uint8ClampedArray(sampleCount * 4);
  let n = 0;
  for (const data of picked) {
    for (let p = 0; p < dw * dh; p += stride) {
      sample[n * 4] = data[p * 4];
      sample[n * 4 + 1] = data[p * 4 + 1];
      sample[n * 4 + 2] = data[p * 4 + 2];
      sample[n * 4 + 3] = data[p * 4 + 3];
      n++;
    }
  }
  const palette = quantize(
    sample.subarray(0, n * 4),
    256,
    hasAlpha ? { format: 'rgba4444', oneBitAlpha: true, clearAlpha: false } : undefined
  );

  let transparentIndex = -1;
  if (hasAlpha) {
    transparentIndex = palette.findIndex((c) => c.length > 3 && c[3] === 0);
    if (transparentIndex === -1 && palette.length < 256) {
      palette.push([0, 0, 0, 0]);
      transparentIndex = palette.length - 1;
    }
  }
  const useTransparency = transparentIndex >= 0;

  const gif = GIFEncoder();
  captured.forEach((data, i) => {
    const index = applyPalette(data, palette, fmt);
    gif.writeFrame(index, dw, dh, {
      palette: i === 0 ? palette : undefined,
      transparent: useTransparency,
      transparentIndex: useTransparency ? transparentIndex : 0,
      delay: keptDelays[i] ?? 100,
      repeat: i === 0 ? 0 : undefined,
    });
  });
  gif.finish();
  return gif.bytes();
}

export async function optimizeAnimatedGif(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let parsed: ReturnType<typeof parseGIF>;
  try {
    parsed = parseGIF(buf);
  } catch {
    throw new Error('decode');
  }
  const srcW = parsed.lsd?.width ?? 0;
  const srcH = parsed.lsd?.height ?? 0;
  if (!srcW || !srcH) throw new Error('decode');

  let all: ParsedFrame[];
  try {
    all = decompressFrames(parsed, true);
  } catch {
    throw new Error('decode');
  }
  if (all.length < 2) throw new Error('static');

  let best: Uint8Array | null = null;
  for (const a of ATTEMPTS) {
    try {
      const bytes = renderAttempt(all, srcW, srcH, a.maxDim, a.maxFrames);
      if (!best || bytes.length < best.length) best = bytes;
      if ((bytes.length * 4) / 3 <= OUTPUT_BUDGET_CHARS) break;
    } catch {
      // Try the next smaller attempt.
    }
  }
  if (!best) throw new Error('decode');
  return blobToDataURL(new Blob([best as unknown as BlobPart], { type: 'image/gif' }));
}
