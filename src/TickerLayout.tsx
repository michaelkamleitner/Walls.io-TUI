/*
 * "Ticker" layout — the wall as a live terminal tail. Posts render as a
 * dense chronological stream (oldest at top, newest at the bottom), one
 * compact entry each, and the view sticks to the bottom as new posts
 * arrive — exactly like tailing a log file. j/k (or the wheel) scroll
 * back through history; scrolling to the bottom re-engages the tail.
 */
import { useMemo, useRef } from "react";
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { wrapText } from "./masonry";
import { networkBadge, networkColor, theme } from "./theme";
import { plainComment, truncateText, type Post } from "./wall-client";

function clock(iso: string | undefined): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--:--";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export interface TickerLayoutProps {
  posts: Post[];
  now: number;
  width: number;
}

export function TickerLayout({ posts, width }: TickerLayoutProps) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const renderer = useRenderer();

  // Chronological, newest last — a tail, not a ranked feed.
  const stream = useMemo(
    () =>
      [...posts].sort(
        (a, b) =>
          (Number(a.external_created_timestamp) || 0) -
          (Number(b.external_created_timestamp) || 0),
      ),
    [posts],
  );

  useKeyboard((key) => {
    const sb = scrollRef.current;
    const page = Math.max(4, (sb?.viewport?.height ?? 10) - 2);
    switch (key.name) {
      case "escape":
        renderer.destroy();
        process.exit(0);
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

  const textCols = Math.max(20, width - 12);

  return (
    <scrollbox
      ref={scrollRef}
      focused
      stickyScroll
      stickyStart="bottom"
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
      {stream.length === 0 ? (
        <box key="empty" style={{ padding: 2, alignItems: "center" }}>
          <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
            ░▒▓ AWAITING TRANSMISSION ▓▒░
          </text>
        </box>
      ) : (
        <box key="stream" style={{ flexDirection: "column", width: "100%" }}>
          {stream.map((post) => {
            const color = networkColor(post.type);
            const author = post.external_fullname || post.external_name || "anonymous";
            const body = truncateText(plainComment(post).replace(/\s*\n\s*/g, " ⏎ "), 220);
            const lines = body ? wrapText(body, textCols) : [];
            return (
              <box key={String(post.id)} style={{ flexDirection: "column", marginBottom: 1 }}>
                <text style={{ wrapMode: "none" }}>
                  <span fg={theme.greenDim}>[{clock(post.external_created)}]</span>{" "}
                  <span fg={color} attributes={TextAttributes.BOLD}>
                    ▌{author}
                  </span>
                  <span fg={theme.dim}> · {networkBadge(post.type)}</span>
                  {post.is_pinned ? <span fg={theme.amber}> · ▲ PINNED</span> : null}
                  {post.is_video ? <span fg={theme.dim}> · ▶</span> : null}
                  {post.post_image_unique_id || post.post_image ? (
                    <span fg={theme.dim}> · ▦</span>
                  ) : null}
                </text>
                {lines.map((line, i) => (
                  <text key={i} fg={theme.text} style={{ wrapMode: "none" }}>
                    {"        "}
                    {line || " "}
                  </text>
                ))}
              </box>
            );
          })}
        </box>
      )}
    </scrollbox>
  );
}
