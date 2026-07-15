/*
 * "Fluid" layout — the multi-column masonry feed. Owns the scrollbox,
 * infinite scroll, and keyboard link navigation (←/→ walk every link in
 * the feed, ↵ opens the selection, Esc deselects — or quits when nothing
 * is selected).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { linkId, postBody, postLinks } from "./links";
import { distribute } from "./masonry";
import { openInBrowser } from "./open";
import { PostCard } from "./PostCard";
import { theme } from "./theme";
import type { Post, WallClient } from "./wall-client";

export interface FluidLayoutProps {
  client: WallClient;
  posts: Post[];
  now: number;
  width: number;
}

export function FluidLayout({ client, posts, now, width }: FluidLayoutProps) {
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  // Mirror of selectedLink that updates synchronously — rapid/held arrow
  // presses arrive faster than React re-renders, and each press must see
  // the previous one's result.
  const selectedLinkRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const renderer = useRenderer();

  // Infinite scroll: when the view sits near the bottom, page in older posts.
  useEffect(() => {
    const t = setInterval(() => {
      const sb = scrollRef.current;
      if (!sb || !client.canLoadOlder) return;
      const viewportHeight = sb.viewport?.height ?? 0;
      if (sb.scrollTop + viewportHeight >= sb.scrollHeight - 40) {
        client.loadOlder(30);
      }
    }, 500);
    return () => clearInterval(t);
  }, [client]);

  // Flat, reading-ordered list of every openable link in the feed.
  const allLinks = useMemo(() => {
    const flat: Array<{ id: string; url: string; postId: string }> = [];
    for (const post of posts) {
      for (const link of postLinks(post, postBody(post))) {
        flat.push({ id: linkId(post.id, link.key), url: link.url, postId: String(post.id) });
      }
    }
    return flat;
  }, [posts]);

  useKeyboard((key) => {
    const sb = scrollRef.current;
    const page = Math.max(4, (sb?.viewport?.height ?? 10) - 2);
    switch (key.name) {
      case "escape":
        if (selectedLinkRef.current) {
          selectedLinkRef.current = null;
          setSelectedLink(null);
        } else {
          renderer.destroy();
          process.exit(0);
        }
        break;
      case "left":
      case "right": {
        if (!allLinks.length) break;
        const dir = key.name === "right" ? 1 : -1;
        const current = allLinks.findIndex((l) => l.id === selectedLinkRef.current);
        const next =
          current === -1
            ? dir === 1
              ? 0
              : allLinks.length - 1
            : (current + dir + allLinks.length) % allLinks.length;
        const link = allLinks[next];
        selectedLinkRef.current = link.id;
        setSelectedLink(link.id);
        sb?.scrollChildIntoView(`card-${link.postId}`);
        break;
      }
      case "return":
      case "linefeed": {
        const link = allLinks.find((l) => l.id === selectedLinkRef.current);
        if (link) openInBrowser(link.url);
        break;
      }
      case "j":
        sb?.scrollBy(2);
        break;
      case "k":
        sb?.scrollBy(-2);
        break;
      case "d":
      case "pagedown":
        sb?.scrollBy(page);
        break;
      case "u":
      case "pageup":
        sb?.scrollBy(-page);
        break;
    }
  });

  // Responsive masonry: aim for ~38-column cards (a CSS auto-fill grid
  // with minmax(38ch, 1fr), in terminal terms).
  const gap = 1;
  const usableForCount = width - 4;
  const columnCount = Math.max(1, Math.min(6, Math.floor(usableForCount / 38)));
  const usable = width - 4 - (columnCount - 1) * gap;
  const columnWidth = Math.floor(usable / columnCount);
  // card border (2) + card padding (2)
  const innerWidth = Math.max(16, columnWidth - 4);
  const columns = useMemo(
    () => distribute(posts, columnCount, innerWidth),
    [posts, columnCount, innerWidth],
  );

  return (
    <scrollbox
      ref={scrollRef}
      focused
      style={{
        flexGrow: 1,
        rootOptions: { backgroundColor: theme.bg },
        wrapperOptions: { backgroundColor: theme.bg },
        viewportOptions: { backgroundColor: theme.bg },
        contentOptions: {
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: theme.bg,
        },
        scrollbarOptions: {
          trackOptions: {
            foregroundColor: theme.greenDim,
            backgroundColor: theme.panel,
          },
        },
      }}
    >
      {posts.length === 0 ? (
        // key: force a fresh renderable on the empty↔feed swap — reusing
        // the same box leaves this padding stuck on the feed container
        // (removed props aren't reset by the reconciler in OpenTUI 0.4.3).
        <box key="empty" style={{ padding: 2, alignItems: "center" }}>
          <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
            ░▒▓ AWAITING TRANSMISSION ▓▒░
          </text>
        </box>
      ) : (
        <box
          key="feed"
          style={{ flexDirection: "row", width: "100%", alignItems: "flex-start", gap }}
        >
          {columns.map((columnPosts, i) => (
            <box
              key={i}
              style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0, flexShrink: 1 }}
            >
              {columnPosts.map((post) => (
                <PostCard
                  key={String(post.id)}
                  post={post}
                  innerWidth={innerWidth}
                  now={now}
                  selected={
                    selectedLink?.startsWith(`${post.id}::`)
                      ? selectedLink.slice(`${post.id}::`.length)
                      : null
                  }
                />
              ))}
            </box>
          ))}
        </box>
      )}
      {client.isExhausted && posts.length > 0 ? (
        <box style={{ alignItems: "center", marginBottom: 1 }}>
          <text fg={theme.dim}>── END OF FEED ──</text>
        </box>
      ) : null}
    </scrollbox>
  );
}
