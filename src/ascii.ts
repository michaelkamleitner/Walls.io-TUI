/*
 * Image → shaded-ASCII renderer.
 *
 * Fetches a post image from the walls.io resizing CDN, downsamples it to a
 * character grid (terminal cells are ~2x taller than wide, hence the 0.5
 * vertical factor), and maps each cell's luminance to a character from a
 * density ramp plus a quantized gray foreground color. Output is a list of
 * lines, each a list of same-color runs, ready to render as <span>s.
 *
 * Ask the CDN for webp=0 — jimp decodes jpeg/png/bmp/gif/tiff, not webp.
 */
import { Jimp } from "jimp";

// Density ramp, dark → light, tuned for dark terminal backgrounds.
const RAMP = " .:-=+*#%@";

// Foreground grays, dark → light. Runs merge on these buckets, so fewer
// levels = fewer spans; 8 is enough for the chunky retro look.
const GRAYS = [
  "#3c3c3c",
  "#565656",
  "#6f6f6f",
  "#898989",
  "#a3a3a3",
  "#bdbdbd",
  "#d7d7d7",
  "#f2f2f2",
];

// A terminal cell is roughly twice as tall as it is wide.
const CELL_ASPECT = 0.5;

export interface AsciiRun {
  text: string;
  fg: string;
}

export type AsciiImage = AsciiRun[][];

const cache = new Map<string, Promise<AsciiImage | null>>();

export function imageToAscii(
  url: string,
  cols: number,
  maxRows = 20,
): Promise<AsciiImage | null> {
  const key = `${cols}x${maxRows}:${url}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = render(url, cols, maxRows).catch(() => null);
    cache.set(key, entry);
  }
  return entry;
}

async function render(url: string, cols: number, maxRows: number): Promise<AsciiImage | null> {
  if (!url || cols < 4) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const image = await Jimp.fromBuffer(buf);

  const ratio = image.bitmap.height / image.bitmap.width;
  let w = cols;
  let h = Math.max(1, Math.round(w * ratio * CELL_ASPECT));
  if (h > maxRows) {
    h = maxRows;
    w = Math.max(4, Math.round(h / (ratio * CELL_ASPECT)));
  }
  image.resize({ w, h });

  const { data } = image.bitmap;
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }

  // Percentile contrast stretch so dull photos still fill the ramp.
  const sorted = Float64Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const range = Math.max(1, hi - lo);

  const lines: AsciiImage = [];
  for (let y = 0; y < h; y++) {
    const runs: AsciiRun[] = [];
    let current: AsciiRun | null = null;
    for (let x = 0; x < w; x++) {
      const norm = Math.min(1, Math.max(0, (lum[y * w + x] - lo) / range));
      const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(norm * RAMP.length))];
      const fg = GRAYS[Math.min(GRAYS.length - 1, Math.floor(norm * GRAYS.length))];
      if (current && current.fg === fg) {
        current.text += ch;
      } else {
        current = { text: ch, fg };
        runs.push(current);
      }
    }
    lines.push(runs);
  }
  return lines;
}
