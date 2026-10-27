export const WALLPAPER_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Largest source file we will attempt to process (20 MB). */
export const MAX_SOURCE_BYTES = 20_000_000;
/**
 * Soft ceiling for stored still images: larger ones are downscaled +
 * compressed toward this size to keep decoding cheap. (Storage itself is
 * IndexedDB, so GIFs and small stills may exceed it.)
 */
export const MAX_STORED_DATA_URL_CHARS = 2_000_000;
/** Longest edge of the stored image; wallpaper is a blurred/covered backdrop. */
export const MAX_STORED_DIMENSION = 1920;

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
      } else {
        reject(new Error('decode'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsDataURL(file);
  });
}

function loadElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = dataUrl;
  });
}

function canvasToDataURL(
  canvas: HTMLCanvasElement,
  type: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === 'string' ? resolve(reader.result) : resolve(null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        },
        type,
        quality
      );
    } catch {
      resolve(null);
    }
  });
}

import { optimizeAnimatedGif } from './gifOptimize';

/**
 * Prepare an uploaded image for use as wallpaper.
 *
 * GIFs are re-encoded smaller (downscaled + fewer frames) so they keep
 * animating instead of decoding to a black square — the result lives in
 * IndexedDB, outside the localStorage quota. Still images are downscaled +
 * compressed to stay small and cheap to decode.
 */
export async function processWallpaperFile(file: File): Promise<string> {
  if (!WALLPAPER_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('type');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('too-large');
  }

  const original = await readAsDataURL(file);

  if (file.type === 'image/gif') {
    try {
      return await optimizeAnimatedGif(file);
    } catch (err) {
      // Optimizer failed (single frame, odd encoding, …): fall through to
      // the still path (first frame) rather than failing outright. A truly
      // broken file errors out below when it can't be drawn either.
      if (err instanceof Error && err.message === 'too-large') throw err;
    }
  }

  // Small files need no processing — keeps PNG crispness.
  if (original.length <= MAX_STORED_DATA_URL_CHARS) {
    // Very large pixel dimensions can still blow up memory/GPU; downscale those.
    try {
      const probe = await loadElement(original);
      if (Math.max(probe.naturalWidth, probe.naturalHeight) <= MAX_STORED_DIMENSION) {
        return original;
      }
    } catch {
      return original;
    }
  }

  const img = await loadElement(original);
  const srcW = img.naturalWidth || 1;
  const srcH = img.naturalHeight || 1;

  // Try progressively smaller scales until the output fits the storage budget.
  const scales = [1, 0.75, 0.5, 0.375, 0.25];
  const baseScale = Math.min(1, MAX_STORED_DIMENSION / Math.max(srcW, srcH));
  for (const step of scales) {
    const scale = baseScale * step;
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(img, 0, 0, w, h);
    for (const quality of [0.85, 0.72, 0.6]) {
      // Prefer WebP (smaller); fall back to JPEG where WebP encoding is missing.
      const out =
        (await canvasToDataURL(canvas, 'image/webp', quality)) ??
        (await canvasToDataURL(canvas, 'image/jpeg', quality));
      if (out && out.length <= MAX_STORED_DATA_URL_CHARS) return out;
      // Keep the smallest attempt in case nothing fits.
      if (quality === 0.6 && out && step === scales[scales.length - 1]) return out;
    }
  }

  throw new Error('too-large');
}
