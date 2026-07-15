/*
 * Multi-column "masonry" distribution for the feed.
 *
 * Wall posts vary wildly in height (one-liner vs. essay vs. photo), so a
 * naive column split leaves gaps. Terminal yoga layout can't reflow items
 * across boxes, so we do the packing ourselves: estimate each card's
 * rendered height and greedily append to the currently shortest column —
 * the same bottom-up packing a browser masonry library does, with reading
 * order preserved (earlier posts always sit higher).
 */
import { IMAGE_MAX_ROWS } from "./pixels";
import { parseCta, plainComment, truncateText, type Post } from "./wall-client";

// East-Asian wide + emoji ranges count as 2 cells. Approximate on purpose —
// this feeds a height *estimate*, not the renderer.
function charWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) // emoji blocks
  ) {
    return 2;
  }
  return 1;
}

function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/*
 * Word-wrap text to `cols` display columns. Done in JS instead of the
 * renderer's wrapMode="word" because OpenTUI 0.4.3 has a fencepost bug when
 * a word ends exactly at the wrap boundary (the following space leaks onto
 * the next line and the full line can overflow the card border by a cell).
 * Also hard-breaks tokens wider than a line (bare URLs, hashes, CJK runs) —
 * the terminal equivalent of CSS `overflow-wrap: anywhere`.
 */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  const budget = Math.max(4, cols);
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    const flush = () => {
      out.push(line);
      line = "";
      lineWidth = 0;
    };
    for (const word of para.split(" ")) {
      const wordWidth = displayWidth(word);
      if (wordWidth > budget) {
        if (lineWidth) flush();
        let chunk = "";
        let chunkWidth = 0;
        for (const ch of word) {
          const cw = charWidth(ch.codePointAt(0)!);
          if (chunkWidth + cw > budget) {
            out.push(chunk);
            chunk = "";
            chunkWidth = 0;
          }
          chunk += ch;
          chunkWidth += cw;
        }
        line = chunk;
        lineWidth = chunkWidth;
        continue;
      }
      const sep = lineWidth ? 1 : 0;
      if (lineWidth + sep + wordWidth > budget) {
        flush();
        line = word;
        lineWidth = wordWidth;
      } else {
        line += (sep ? " " : "") + word;
        lineWidth += sep + wordWidth;
      }
    }
    out.push(line);
  }
  return out;
}

// Mirrors the PostCard structure: border(2) + header(1) + body + image +
// video tag + CTA + marginBottom(1). Rough is fine — columns only need to
// stay balanced, not pixel-exact.
export function estimateCardHeight(post: Post, innerWidth: number): number {
  let h = 2 + 1 + 1;
  const body = truncateText(plainComment(post));
  if (body) h += 1 + wrapText(body, innerWidth).length;
  // Posters and video slideshows render at the same size, so one estimate
  // covers both (video-only posts use the video's aspect ratio).
  if (post.post_image_unique_id || post.post_image || post.is_video) {
    const ratio =
      post.post_image_width && post.post_image_height
        ? post.post_image_height / post.post_image_width
        : post.post_video_width && post.post_video_height
          ? post.post_video_height / post.post_video_width
          : 0.75;
    // Full column width, center-cropped past IMAGE_MAX_ROWS — same math as
    // pixels.ts render().
    h += 1 + Math.min(IMAGE_MAX_ROWS, Math.max(1, Math.round((innerWidth * ratio) / 2)));
  }
  // Playing slideshows carry no indicator line, so videos add no extra rows.
  if (parseCta(post)) h += 2;
  return h;
}

export function distribute(posts: Post[], columns: number, innerWidth: number): Post[][] {
  const buckets: Post[][] = Array.from({ length: columns }, () => []);
  if (columns <= 1) {
    buckets[0] = posts;
    return buckets;
  }
  const heights = new Array<number>(columns).fill(0);
  for (const post of posts) {
    let shortest = 0;
    for (let i = 1; i < columns; i++) {
      if (heights[i] < heights[shortest]) shortest = i;
    }
    buckets[shortest].push(post);
    heights[shortest] += estimateCardHeight(post, innerWidth);
  }
  return buckets;
}
