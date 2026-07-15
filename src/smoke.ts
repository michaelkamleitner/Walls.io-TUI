/*
 * Headless smoke test: connects to the broadcaster, prints a snapshot of
 * the feed, exercises pagination, and dumps one post image as ANSI-colored
 * ASCII. Verifies the whole data pipeline without a TTY.
 *
 *   npm run smoke -- --wall 186670
 */
import { imageToPixels } from "./pixels";
import { hasFfmpeg, videoToPixelFrames } from "./video";
import {
  createWallClient,
  imageUrl,
  plainComment,
  relativeTime,
  truncateText,
  type Post,
} from "./wall-client";

const wallId = Number(process.argv.find((a, i) => process.argv[i - 1] === "--wall")) || 186670;

function hexToAnsi(hex: string, layer: 38 | 48): string {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[${layer};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

const client = createWallClient({ wallId });
client.on("status", (s) => console.log(`[status] ${s}`));

const posts = await new Promise<Post[]>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout: no posts after 20s")), 20000);
  client.on("change", (list) => {
    if (list.length > 0) {
      clearTimeout(timer);
      resolve(list);
    }
  });
  client.start();
});

console.log(`\n${posts.length} posts on wall #${wallId}. First three:\n`);
for (const post of posts.slice(0, 3)) {
  const author = post.external_fullname || post.external_name || "anonymous";
  console.log(`  [${post.type}] ${author} — ${relativeTime(post.external_created)}`);
  const body = truncateText(plainComment(post), 120);
  if (body) console.log(`    ${body.replace(/\n/g, " ")}`);
}

console.log("\n[loadOlder] requesting 10 older posts…");
const older = await new Promise<string>((resolve) => {
  const timer = setTimeout(() => resolve("no response after 10s"), 10000);
  client.on("older-loaded", ({ exhausted, added }) => {
    clearTimeout(timer);
    resolve(`added=${added} exhausted=${exhausted}`);
  });
  if (!client.loadOlder(10)) resolve("loadOlder() returned false");
});
console.log(`[loadOlder] ${older}`);

const withImage = posts.find((p) => p.post_image_unique_id || p.post_image);
if (withImage) {
  const src = imageUrl(withImage, { w: 320, webp: 0 });
  console.log(`\n[pixels] ${src}`);
  const pixels = await imageToPixels(src, 76);
  if (!pixels) {
    console.log("[pixels] failed to fetch/decode image");
  } else {
    for (const runs of pixels) {
      console.log(
        runs.map((r) => `${hexToAnsi(r.fg, 38)}${hexToAnsi(r.bg, 48)}${r.text}`).join("") +
          "\x1b[0m",
      );
    }
  }
} else {
  console.log("\n[pixels] no post with an image in the snapshot");
}

const video = posts.find((p) => p.is_video && p.post_video);
if (!video) {
  console.log("\n[video] no video post in the snapshot");
} else if (!(await hasFfmpeg())) {
  console.log("\n[video] ffmpeg not installed — slideshow disabled");
} else {
  console.log(`\n[video] extracting frames from ${String(video.post_video).slice(0, 80)}…`);
  const t0 = Date.now();
  const frames = await videoToPixelFrames(String(video.post_video), 40);
  console.log(`[video] ${frames?.length ?? 0} frames in ${Date.now() - t0}ms (cached on disk)`);
  // Different cols → different memo key, same disk cache entry: this
  // measures the disk-cache hit, not the in-memory one.
  const again = Date.now();
  await videoToPixelFrames(String(video.post_video), 41);
  console.log(`[video] disk-cache re-read in ${Date.now() - again}ms`);
}

client.stop();
process.exit(0);
