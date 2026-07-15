/*
 * Image → half-block "pixel" renderer.
 *
 * Every terminal cell displays two vertically stacked pixels using the
 * upper-half-block character '▀': the foreground colors the top pixel, the
 * background colors the bottom one. Since a cell is roughly twice as tall
 * as it is wide, each half-cell is close to square — the result reads as a
 * chunky, quantized grayscale bitmap (16 gray levels for the retro look;
 * quantizing also lets adjacent cells merge into longer same-color runs).
 *
 * Fetches from the walls.io resizing CDN with webp=0 — jimp decodes
 * jpeg/png/bmp/gif/tiff, not webp.
 */
import { Jimp } from "jimp";

const HALF_BLOCK = "▀";
const GRAY_LEVELS = 16;

export interface PixelRun {
  text: string;
  fg: string;
  bg: string;
}

/** Lines of same-color runs; one line = one terminal row = two pixel rows. */
export type PixelImage = PixelRun[][];

const cache = new Map<string, Promise<PixelImage | null>>();

/** Keep in sync with the height estimate in masonry.ts. */
export const IMAGE_MAX_ROWS = 22;

export function imageToPixels(
  url: string,
  cols: number,
  maxRows = IMAGE_MAX_ROWS,
): Promise<PixelImage | null> {
  const key = `${cols}x${maxRows}:${url}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = render(url, cols, maxRows).catch(() => null);
    cache.set(key, entry);
  }
  return entry;
}

function grayHex(norm: number): string {
  const level = Math.min(GRAY_LEVELS - 1, Math.max(0, Math.round(norm * (GRAY_LEVELS - 1))));
  const v = Math.round((level * 255) / (GRAY_LEVELS - 1));
  const b = v.toString(16).padStart(2, "0");
  return `#${b}${b}${b}`;
}

async function render(url: string, cols: number, maxRows: number): Promise<PixelImage | null> {
  if (!url || cols < 4) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const image = await Jimp.fromBuffer(buf);

  // Pixel grid: width = cols (always the full column width), height =
  // 2 pixels per terminal row. Very tall images get center-cropped to
  // maxRows instead of shrinking below the column width.
  const ratio = image.bitmap.height / image.bitmap.width;
  const w = cols;
  const fullLines = Math.max(1, Math.round((w * ratio) / 2));
  const lines = Math.min(fullLines, maxRows);
  const h = fullLines * 2;
  image.resize({ w, h });
  const cropOffset = Math.floor((fullLines - lines) / 2) * 2 * w;

  const { data } = image.bitmap;
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  const px = (i: number) => lum[cropOffset + i];

  // Percentile contrast stretch so dull photos still span black → white.
  const sorted = Float64Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const range = Math.max(1, hi - lo);
  const norm = (i: number) => Math.min(1, Math.max(0, (px(i) - lo) / range));

  const out: PixelImage = [];
  for (let line = 0; line < lines; line++) {
    const runs: PixelRun[] = [];
    let current: PixelRun | null = null;
    for (let x = 0; x < w; x++) {
      const fg = grayHex(norm(2 * line * w + x));
      const bg = grayHex(norm((2 * line + 1) * w + x));
      if (current && current.fg === fg && current.bg === bg) {
        current.text += HALF_BLOCK;
      } else {
        current = { text: HALF_BLOCK, fg, bg };
        runs.push(current);
      }
    }
    out.push(runs);
  }
  return out;
}
