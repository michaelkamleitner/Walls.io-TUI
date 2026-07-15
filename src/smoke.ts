/*
 * Headless smoke test: connects to the broadcaster, prints a snapshot of
 * the feed, exercises pagination, and dumps one post image as ANSI-colored
 * ASCII. Verifies the whole data pipeline without a TTY.
 *
 *   npm run smoke -- --wall 186670
 */
import { imageToAscii } from "./ascii";
import {
  createWallClient,
  imageUrl,
  plainComment,
  relativeTime,
  truncateText,
  type Post,
} from "./wall-client";

const wallId = Number(process.argv.find((a, i) => process.argv[i - 1] === "--wall")) || 186670;

function hexToAnsi(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
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
  console.log(`\n[ascii] ${src}`);
  const ascii = await imageToAscii(src, 76);
  if (!ascii) {
    console.log("[ascii] failed to fetch/decode image");
  } else {
    for (const runs of ascii) {
      console.log(runs.map((r) => `${hexToAnsi(r.fg)}${r.text}`).join("") + "\x1b[0m");
    }
  }
} else {
  console.log("\n[ascii] no post with an image in the snapshot");
}

client.stop();
process.exit(0);
