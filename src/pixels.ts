/*
 * Image → half-block "pixel" renderer.
 *
 * Every terminal cell displays two vertically stacked pixels using the
 * upper-half-block character '▀': the foreground colors the top pixel, the
 * background colors the bottom one. Since a cell is roughly twice as tall
 * as it is wide, each half-cell is close to square — the result reads as a
 * chunky grayscale bitmap. Luminance is quantized to GRAY_LEVELS shades:
 * enough for smooth gradients, while still letting same-shade neighbors
 * merge into longer runs.
 *
 * Two representations exist:
 *   - PixelImage — run-encoded, ready to render as <span>s
 *   - LumGrid — raw normalized luminance, for callers that post-process
 *     (the Theater layout crossfades by mixing two grids per frame)
 *
 * Fetches from the walls.io resizing CDN with webp=0 — jimp decodes
 * jpeg/png/bmp/gif/tiff, not webp.
 */
import { Jimp } from "jimp";

const HALF_BLOCK = "▀";
const GRAY_LEVELS = 64;

// A terminal cell is roughly twice as tall as it is wide.
const CELL_ASPECT = 0.5;

export interface PixelRun {
  text: string;
  fg: string;
  bg: string;
}

/** Lines of same-color runs; one line = one terminal row = two pixel rows. */
export type PixelImage = PixelRun[][];

/** Contrast-stretched luminance, normalized 0..1, row-major w × h pixels. */
export interface LumGrid {
  w: number;
  h: number;
  lum: Float32Array;
}

const cache = new Map<string, Promise<PixelImage | null>>();
const coverCache = new Map<string, Promise<LumGrid | null>>();

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

/**
 * Fetch an image and cover-crop it to exactly cols × rows cells (fills the
 * whole box, cropping overflow — CSS object-fit: cover). Returns the raw
 * grid so callers can mix/animate before encoding.
 */
export function imageToCoverGrid(
  url: string,
  cols: number,
  rows: number,
): Promise<LumGrid | null> {
  const key = `${cols}x${rows}:${url}`;
  let entry = coverCache.get(key);
  if (!entry) {
    entry = renderCover(url, cols, rows).catch(() => null);
    coverCache.set(key, entry);
  }
  return entry;
}

function grayHex(norm: number): string {
  const level = Math.min(GRAY_LEVELS - 1, Math.max(0, Math.round(norm * (GRAY_LEVELS - 1))));
  const v = Math.round((level * 255) / (GRAY_LEVELS - 1));
  const b = v.toString(16).padStart(2, "0");
  return `#${b}${b}${b}`;
}

// Raw per-pixel luminance of a decoded bitmap.
function luminances(data: Uint8Array | Buffer, count: number): Float64Array {
  const lum = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return lum;
}

// Percentile contrast stretch (2%..98%) → normalized 0..1 grid.
function normalize(lum: Float64Array, w: number, h: number): LumGrid {
  const sorted = Float64Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const range = Math.max(1, hi - lo);
  const out = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    out[i] = Math.min(1, Math.max(0, (lum[i] - lo) / range));
  }
  return { w, h, lum: out };
}

/** Run-encode a luminance grid into renderable lines. */
export function encodeLumGrid(grid: LumGrid): PixelImage {
  const { w, h, lum } = grid;
  const lines: PixelImage = [];
  for (let line = 0; line < Math.floor(h / 2); line++) {
    const runs: PixelRun[] = [];
    let current: PixelRun | null = null;
    for (let x = 0; x < w; x++) {
      const fg = grayHex(lum[2 * line * w + x]);
      const bg = grayHex(lum[(2 * line + 1) * w + x]);
      if (current && current.fg === fg && current.bg === bg) {
        current.text += HALF_BLOCK;
      } else {
        current = { text: HALF_BLOCK, fg, bg };
        runs.push(current);
      }
    }
    lines.push(runs);
  }
  return lines;
}

/** Linear mix of two same-sized grids (t=0 → a, t=1 → b). */
export function mixLumGrids(a: LumGrid, b: LumGrid, t: number): LumGrid {
  const lum = new Float32Array(a.lum.length);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = a.lum[i] + (b.lum[i] - a.lum[i]) * t;
  }
  return { w: a.w, h: a.h, lum };
}

async function render(url: string, cols: number, maxRows: number): Promise<PixelImage | null> {
  if (!url) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return bufferToPixels(await res.arrayBuffer(), cols, maxRows);
}

/** Decode an already-fetched image (jpeg/png/…) into pixel runs. */
export async function bufferToPixels(
  buf: ArrayBuffer | Buffer,
  cols: number,
  maxRows = IMAGE_MAX_ROWS,
): Promise<PixelImage | null> {
  if (cols < 4) return null;
  const image = await Jimp.fromBuffer(buf as ArrayBuffer);

  // Pixel grid: width = cols (always the full column width), height =
  // 2 pixels per terminal row. Very tall images get center-cropped to
  // maxRows instead of shrinking below the column width.
  const ratio = image.bitmap.height / image.bitmap.width;
  const w = cols;
  const fullLines = Math.max(1, Math.round(w * ratio * CELL_ASPECT));
  const lines = Math.min(fullLines, maxRows);
  const h = fullLines * 2;
  image.resize({ w, h });
  const cropOffset = Math.floor((fullLines - lines) / 2) * 2 * w;

  const all = luminances(image.bitmap.data, w * h);
  const visible = all.slice(cropOffset, cropOffset + w * lines * 2);
  return encodeLumGrid(normalize(visible, w, lines * 2));
}

async function renderCover(url: string, cols: number, rows: number): Promise<LumGrid | null> {
  if (!url || cols < 4 || rows < 2) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const image = await Jimp.fromBuffer(await res.arrayBuffer());
  const w = cols;
  const h = rows * 2;
  image.cover({ w, h });
  return normalize(luminances(image.bitmap.data, w * h), w, h);
}
