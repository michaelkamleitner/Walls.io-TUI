/*
 * Video → pixel-frame slideshow.
 *
 * For video posts, ffmpeg (system install, optional) extracts up to
 * FRAME_COUNT frames spread evenly across the clip, straight from the
 * remote URL. Extracted JPEGs are cached on disk under
 * ~/.cache/walls-tui/frames/<url-hash>/ so a wall full of videos only pays
 * the extraction cost once. Frames are then decoded through the same
 * half-block pixel pipeline as images.
 *
 * Everything degrades gracefully: no ffmpeg, an unreachable URL, or a
 * failed decode simply returns null and the card falls back to the static
 * poster image.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bufferToPixels, IMAGE_MAX_ROWS, type PixelImage } from "./pixels";

const FRAME_COUNT = 10;
const EXTRACT_TIMEOUT_MS = 45_000;
const CACHE_ROOT = path.join(os.homedir(), ".cache", "walls-tui", "frames");

// Don't hammer the network/CPU when a wall is full of videos.
const MAX_CONCURRENT_EXTRACTIONS = 2;
let running = 0;
const waiters: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_EXTRACTIONS) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok, stdout });
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve({ ok: false, stdout: "" });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(false);
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d));
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

let ffmpegAvailable: Promise<boolean> | null = null;
export function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= run("ffmpeg", ["-version"], 5000).then((r) => r.ok);
  return ffmpegAvailable;
}

async function listFrames(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// Extract frames to the disk cache (or reuse it) and return the JPEG paths.
async function extractFrames(url: string): Promise<string[]> {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 24);
  const dir = path.join(CACHE_ROOT, hash);

  const cached = await listFrames(dir);
  if (cached.length) return cached;

  // Spread FRAME_COUNT frames evenly across the clip; unknown duration
  // (streams, probe failure) falls back to one frame every 3 seconds.
  const probe = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url],
    15_000,
  );
  const duration = probe.ok ? parseFloat(probe.stdout) : NaN;
  const fps =
    Number.isFinite(duration) && duration > 1 ? FRAME_COUNT / duration : 1 / 3;

  // Extract into a temp dir, then rename — a killed ffmpeg never leaves a
  // half-filled cache entry behind.
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(tmp, { recursive: true });
  const result = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel", "error",
      "-i", url,
      "-vf", `fps=${fps},scale=320:-2`,
      "-frames:v", String(FRAME_COUNT),
      path.join(tmp, "frame%02d.jpg"),
    ],
    EXTRACT_TIMEOUT_MS,
  );
  const extracted = await listFrames(tmp);
  if (!result.ok && extracted.length === 0) {
    await rm(tmp, { recursive: true, force: true });
    return [];
  }
  try {
    await rename(tmp, dir);
  } catch {
    // Lost a race with another extraction of the same URL — use theirs.
    await rm(tmp, { recursive: true, force: true });
  }
  return listFrames(dir);
}

const memo = new Map<string, Promise<PixelImage[] | null>>();

export function videoToPixelFrames(
  url: string,
  cols: number,
  maxRows = IMAGE_MAX_ROWS,
): Promise<PixelImage[] | null> {
  const key = `${cols}x${maxRows}:${url}`;
  let entry = memo.get(key);
  if (!entry) {
    entry = load(url, cols, maxRows).catch(() => null);
    memo.set(key, entry);
  }
  return entry;
}

async function load(url: string, cols: number, maxRows: number): Promise<PixelImage[] | null> {
  if (!url || cols < 4) return null;
  if (!(await hasFfmpeg())) return null;
  const files = await withSlot(() => extractFrames(url));
  if (!files.length) return null;
  const frames: PixelImage[] = [];
  for (const file of files) {
    const pixels = await bufferToPixels(await readFile(file), cols, maxRows);
    if (pixels) frames.push(pixels);
  }
  return frames.length ? frames : null;
}
