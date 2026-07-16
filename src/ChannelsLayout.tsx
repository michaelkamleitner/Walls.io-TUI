/*
 * "Channels" layout — TweetDeck-style: one independently scrolling column
 * per network, ordered by post count, headers in brand colors. ←/→ move
 * the active column (bright header + underline), j/k/d/u scroll it; the
 * mouse wheel scrolls whichever column it hovers.
 */
import { useMemo, useRef, useState } from "react";
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useAutoScroll } from "./autoscroll";
import { PostCard } from "./PostCard";
import { networkBadge, networkColor, theme } from "./theme";
import type { Post } from "./wall-client";

export interface ChannelsLayoutProps {
  posts: Post[];
  now: number;
  width: number;
  autoScroll: boolean;
}

export function ChannelsLayout({ posts, now, width, autoScroll }: ChannelsLayoutProps) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const scrollRefs = useRef<Array<ScrollBoxRenderable | null>>([]);
  const renderer = useRenderer();
  // Drives every visible column at once, not just the active one.
  useAutoScroll(autoScroll, () => scrollRefs.current);

  const channels = useMemo(() => {
    const byType = new Map<string, Post[]>();
    for (const post of posts) {
      const key = post.type || "other";
      const list = byType.get(key);
      if (list) list.push(post);
      else byType.set(key, [post]);
    }
    return [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [posts]);

  const columnCount = Math.max(1, Math.min(channels.length, Math.floor((width - 2) / 34)));
  const visible = channels.slice(0, columnCount);
  const gap = 1;
  const columnWidth = Math.floor((width - 2 - (columnCount - 1) * gap) / Math.max(1, columnCount));
  const innerWidth = Math.max(16, columnWidth - 4);
  const activeCol = Math.min(active, Math.max(0, visible.length - 1));

  useKeyboard((key) => {
    const sb = scrollRefs.current[activeRef.current];
    const page = Math.max(4, (sb?.viewport?.height ?? 10) - 2);
    switch (key.name) {
      case "escape":
        renderer.destroy();
        process.exit(0);
      case "left":
      case "right": {
        const dir = key.name === "right" ? 1 : -1;
        const n = Math.max(1, Math.min(channels.length, columnCount));
        activeRef.current = (activeRef.current + dir + n) % n;
        setActive(activeRef.current);
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

  if (visible.length === 0) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
          ░▒▓ AWAITING TRANSMISSION ▓▒░
        </text>
      </box>
    );
  }

  return (
    <box style={{ flexGrow: 1, flexDirection: "row", paddingLeft: 1, paddingRight: 1, gap }}>
      {visible.map(([type, channelPosts], i) => {
        const color = networkColor(type);
        const isActive = i === activeCol;
        return (
          <box key={type} style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0 }}>
            <box
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                backgroundColor: isActive ? color : theme.panel,
                paddingLeft: 1,
                paddingRight: 1,
                flexShrink: 0,
              }}
            >
              <text
                fg={isActive ? theme.bg : color}
                attributes={TextAttributes.BOLD}
                style={{ wrapMode: "none" }}
              >
                ▌{networkBadge(type)}
              </text>
              <text fg={isActive ? theme.bg : theme.dim} style={{ wrapMode: "none" }}>
                {channelPosts.length}
              </text>
            </box>
            <scrollbox
              ref={(sb: ScrollBoxRenderable | null) => {
                scrollRefs.current[i] = sb;
              }}
              focused={isActive}
              style={{
                flexGrow: 1,
                rootOptions: { backgroundColor: theme.bg },
                wrapperOptions: { backgroundColor: theme.bg },
                viewportOptions: { backgroundColor: theme.bg },
                contentOptions: {
                  flexDirection: "column",
                  paddingTop: 1,
                  backgroundColor: theme.bg,
                },
                scrollbarOptions: {
                  trackOptions: {
                    foregroundColor: isActive ? color : theme.greenDim,
                    backgroundColor: theme.panel,
                  },
                },
              }}
            >
              {channelPosts.map((post) => (
                <PostCard
                  key={String(post.id)}
                  post={post}
                  innerWidth={innerWidth}
                  now={now}
                  selected={null}
                />
              ))}
            </scrollbox>
          </box>
        );
      })}
    </box>
  );
}
