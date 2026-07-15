/*
 * "Theater" layout — a full-bleed, media-only slideshow. The photo (or a
 * video's poster) fills the entire stage, cover-cropped, with a thin
 * overlay strip at the bottom (author · one line of text · counter).
 *
 * Transitions are real dissolves: the current and next images are kept as
 * raw luminance grids and mixed pixel-by-pixel over ~600 ms, re-encoded to
 * runs per animation frame. Advances every 6 s; Space/→/← navigate and
 * reset the timer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { openInBrowser } from "./open";
import {
  encodeLumGrid,
  imageToCoverGrid,
  mixLumGrids,
  type LumGrid,
  type PixelImage,
} from "./pixels";
import { networkBadge, networkColor, theme } from "./theme";
import { imageUrl, plainComment, safeUrl, truncateText, type Post } from "./wall-client";

const ADVANCE_MS = 6000;
const FADE_MS = 600;
const FADE_STEPS = 12;

export interface TheaterLayoutProps {
  posts: Post[];
  now: number;
  width: number;
  height: number;
}

export function TheaterLayout({ posts, width, height }: TheaterLayoutProps) {
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<PixelImage | null>(null);
  const shownGrid = useRef<LumGrid | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderer = useRenderer();

  const mediaPosts = useMemo(
    () => posts.filter((p) => p.post_image_unique_id || p.post_image),
    [posts],
  );
  const count = mediaPosts.length;
  const current = count ? ((index % count) + count) % count : 0;
  const post = count ? mediaPosts[current] : null;

  const cols = Math.max(20, width);
  const rows = Math.max(4, height - 7);

  const restartTimer = () => {
    if (advanceTimer.current) clearInterval(advanceTimer.current);
    advanceTimer.current = setInterval(() => setIndex((i) => i + 1), ADVANCE_MS);
  };
  useEffect(() => {
    restartTimer();
    return () => {
      if (advanceTimer.current) clearInterval(advanceTimer.current);
      if (fadeTimer.current) clearInterval(fadeTimer.current);
    };
  }, []);

  // Load the current post's grid; dissolve from whatever is on screen.
  useEffect(() => {
    let alive = true;
    if (!post) return;
    const src = imageUrl(post, { w: Math.max(480, cols * 3), webp: 0 });
    imageToCoverGrid(src, cols, rows).then((grid) => {
      if (!alive || !grid) return;
      if (fadeTimer.current) clearInterval(fadeTimer.current);
      const from = shownGrid.current;
      if (!from || from.lum.length !== grid.lum.length) {
        shownGrid.current = grid;
        setFrame(encodeLumGrid(grid));
        return;
      }
      let step = 0;
      fadeTimer.current = setInterval(() => {
        step++;
        const t = step / FADE_STEPS;
        const mixed = t >= 1 ? grid : mixLumGrids(from, grid, t);
        shownGrid.current = mixed;
        setFrame(encodeLumGrid(mixed));
        if (t >= 1 && fadeTimer.current) clearInterval(fadeTimer.current);
      }, FADE_MS / FADE_STEPS);
    });
    return () => {
      alive = false;
    };
  }, [post, cols, rows]);

  useKeyboard((key) => {
    switch (key.name) {
      case "escape":
        renderer.destroy();
        process.exit(0);
      case "space":
      case "right":
        setIndex((i) => i + 1);
        restartTimer();
        break;
      case "left":
        setIndex((i) => i - 1);
        restartTimer();
        break;
      case "return":
      case "linefeed": {
        const link = post && safeUrl(post.post_link);
        if (link) openInBrowser(link);
        break;
      }
    }
  });

  if (!post) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
          {posts.length === 0
            ? "░▒▓ AWAITING TRANSMISSION ▓▒░"
            : "░▒▓ NO MEDIA POSTS ON THIS WALL ▓▒░"}
        </text>
      </box>
    );
  }

  const color = networkColor(post.type);
  const author = post.external_fullname || post.external_name || "anonymous";
  const oneLiner = truncateText(
    plainComment(post).replace(/\s*\n\s*/g, " "),
    Math.max(20, width - 40),
  );

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        {frame ? (
          frame.map((runs, y) => (
            <text key={y} style={{ wrapMode: "none" }}>
              {runs.map((run, i) => (
                <span key={i} fg={run.fg} bg={run.bg}>
                  {run.text}
                </span>
              ))}
            </text>
          ))
        ) : (
          <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
            <text fg={theme.dim}>░▒▓ receiving image…</text>
          </box>
        )}
      </box>
      <box
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
          flexShrink: 0,
        }}
      >
        <text style={{ wrapMode: "none", flexShrink: 1 }}>
          <span fg={color} attributes={TextAttributes.BOLD}>
            ▌{author}
          </span>
          <span fg={theme.dim}> · {networkBadge(post.type)}</span>
          <span fg={theme.text}> {oneLiner ? `› ${oneLiner}` : ""}</span>
        </text>
        <text fg={theme.dim} style={{ flexShrink: 0, marginLeft: 2 }}>
          {current + 1} / {count}
        </text>
      </box>
    </box>
  );
}
