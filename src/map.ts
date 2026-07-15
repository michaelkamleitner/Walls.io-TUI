/*
 * Map rendering for the "Map" layout.
 *
 * OpenStreetMap slippy tiles (256px PNGs) are fetched around a coordinate,
 * composited into one canvas, cropped to the requested character grid, and
 * run through the same half-block pixel pipeline as photos — plus an amber
 * ◉ marker painted at the center cell (the post's location).
 *
 * Tiles are cached on disk under ~/.cache/walls-tui/tiles/z/x/y.png and
 * requests carry a proper User-Agent, per the OSM tile usage policy.
 */
import { Jimp } from "jimp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bufferToPixels, type PixelImage } from "./pixels";
import { theme } from "./theme";

const TILE_SIZE = 256;
const USER_AGENT = "walls-tui/1.0 (+https://github.com/michaelkamleitner/Walls.io-TUI)";
const TILE_CACHE = path.join(os.homedir(), ".cache", "walls-tui", "tiles");
export const MAP_ZOOM = 11;

const tileInflight = new Map<string, Promise<Buffer | null>>();

function fetchTile(zoom: number, x: number, y: number): Promise<Buffer | null> {
  const n = 2 ** zoom;
  x = ((x % n) + n) % n; // wrap around the antimeridian
  if (y < 0 || y >= n) return Promise.resolve(null); // beyond the poles
  const key = `${zoom}/${x}/${y}`;
  let job = tileInflight.get(key);
  if (!job) {
    job = loadTile(zoom, x, y).catch(() => null);
    tileInflight.set(key, job);
  }
  return job;
}

async function loadTile(zoom: number, x: number, y: number): Promise<Buffer | null> {
  const file = path.join(TILE_CACHE, String(zoom), String(x), `${y}.png`);
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const res = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf);
  } catch {
    // cache write failure is not fatal
  }
  return buf;
}

// Web-Mercator world pixel position of a coordinate at a zoom level.
function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  const xt = ((lon + 180) / 360) * n;
  const yt = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x: xt * TILE_SIZE, y: yt * TILE_SIZE };
}

async function composeMap(
  lat: number,
  lon: number,
  pxWidth: number,
  pxHeight: number,
  zoom: number,
) {
  const center = worldPixel(lat, lon, zoom);
  const left = Math.round(center.x - pxWidth / 2);
  const top = Math.round(center.y - pxHeight / 2);
  const canvas = new Jimp({ width: pxWidth, height: pxHeight, color: 0xd0d0d0ff });
  const jobs: Array<Promise<void>> = [];
  for (
    let ty = Math.floor(top / TILE_SIZE);
    ty <= Math.floor((top + pxHeight - 1) / TILE_SIZE);
    ty++
  ) {
    for (
      let tx = Math.floor(left / TILE_SIZE);
      tx <= Math.floor((left + pxWidth - 1) / TILE_SIZE);
      tx++
    ) {
      jobs.push(
        fetchTile(zoom, tx, ty).then(async (buf) => {
          if (!buf) return;
          const tile = await Jimp.fromBuffer(buf);
          canvas.composite(tile, tx * TILE_SIZE - left, ty * TILE_SIZE - top);
        }),
      );
    }
  }
  await Promise.all(jobs);
  return canvas;
}

// Paint one cell of a rendered pixel image (splitting the run it sits in).
function paintCell(image: PixelImage, row: number, col: number, ch: string, fg: string) {
  const line = image[row];
  if (!line) return;
  let x = 0;
  for (let i = 0; i < line.length; i++) {
    const run = line[i];
    const chars = [...run.text];
    if (col < x + chars.length) {
      const idx = col - x;
      const parts = [];
      if (idx > 0) parts.push({ text: chars.slice(0, idx).join(""), fg: run.fg, bg: run.bg });
      parts.push({ text: ch, fg, bg: run.bg });
      if (idx + 1 < chars.length)
        parts.push({ text: chars.slice(idx + 1).join(""), fg: run.fg, bg: run.bg });
      line.splice(i, 1, ...parts);
      return;
    }
    x += chars.length;
  }
}

// The marker: a circle spanning two cells (◖◗) — cells are ~1:2, so two
// side by side read as one large round dot, twice the size of a
// single-cell ◉.
function paintMarker(image: PixelImage, row: number, col: number) {
  const start = Math.max(0, col - 1);
  paintCell(image, row, start, "◖", theme.amber);
  paintCell(image, row, start + 1, "◗", theme.amber);
}

const memo = new Map<string, Promise<PixelImage | null>>();

/**
 * Render a map centered on (lat, lon) as `cols` × `rows` terminal cells,
 * marker at the center. `rows` is exact (unlike photos, a map has no
 * intrinsic aspect ratio to respect).
 */
export function mapToPixels(
  lat: number,
  lon: number,
  cols: number,
  rows: number,
  zoom = MAP_ZOOM,
): Promise<PixelImage | null> {
  const key = `${cols}x${rows}z${zoom}@${lat.toFixed(4)},${lon.toFixed(4)}`;
  let entry = memo.get(key);
  if (!entry) {
    entry = render(lat, lon, cols, rows, zoom).catch(() => null);
    memo.set(key, entry);
  }
  return entry;
}

async function render(
  lat: number,
  lon: number,
  cols: number,
  rows: number,
  zoom: number,
): Promise<PixelImage | null> {
  if (cols < 4 || rows < 2) return null;
  // 2× supersampling: the canvas aspect matches the pixel grid
  // (cols × rows*2), so bufferToPixels resizes without cropping.
  const canvas = await composeMap(lat, lon, cols * 2, rows * 4, zoom);
  const buf = await canvas.getBuffer("image/png");
  const pixels = await bufferToPixels(buf, cols, rows);
  if (!pixels) return null;
  paintMarker(pixels, Math.floor(rows / 2), Math.floor(cols / 2));
  return pixels;
}
