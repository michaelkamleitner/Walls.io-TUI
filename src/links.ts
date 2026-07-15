/*
 * Link registry for keyboard navigation.
 *
 * Each post exposes an ordered list of openable links — author profile,
 * timestamp (original post), URLs inside the body text, CTA button. The App
 * flattens these across the feed for ←/→ browsing; PostCard uses the same
 * keys to highlight the selected one. Keys are stable per post so selection
 * survives re-sorts and live updates.
 */
import { parseCta, plainComment, safeUrl, truncateText, type Post } from "./wall-client";

export const URL_RE = /https?:\/\/[^\s]+/g;

export interface PostLink {
  key: string;
  url: string;
}

/** The display body — single source of truth for PostCard and postLinks. */
export function postBody(post: Post): string {
  return truncateText(plainComment(post));
}

export function postLinks(post: Post, body: string): PostLink[] {
  const links: PostLink[] = [];
  const author = safeUrl(post.external_user_link);
  if (author) links.push({ key: "author", url: author });
  const original = safeUrl(post.post_link);
  if (original) links.push({ key: "time", url: original });
  let i = 0;
  for (const match of body.matchAll(URL_RE)) {
    const url = safeUrl(match[0]);
    if (url) links.push({ key: `url:${i}`, url });
    i++;
  }
  const cta = parseCta(post);
  if (cta) links.push({ key: "cta", url: cta.link });
  return links;
}

export function linkId(postId: string | number, key: string): string {
  return `${postId}::${key}`;
}
