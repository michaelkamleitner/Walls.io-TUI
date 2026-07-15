/*
 * "Kiosk" layout — a full-screen slideshow showing one post at a time:
 * media (image / video slideshow) on the left, author + timestamp + text
 * on the right. Advances automatically every 5 s; Space/→ skip ahead and
 * ← goes back (both wrap around and reset the autoplay timer).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { usePixelImage, useVideoSlideshow } from "./hooks";
import { URL_RE } from "./links";
import { wrapText } from "./masonry";
import { openInBrowser } from "./open";
import { networkBadge, networkColor, theme } from "./theme";
import {
  imageUrl,
  parseCta,
  plainComment,
  relativeTime,
  safeUrl,
  type Post,
} from "./wall-client";

const ADVANCE_MS = 5000;

export interface KioskLayoutProps {
  posts: Post[];
  now: number;
  width: number;
  height: number;
}

export function KioskLayout({ posts, now, width, height }: KioskLayoutProps) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderer = useRenderer();

  // Autoplay; manual navigation restarts the interval so the reader gets a
  // full 5 s on the post they navigated to.
  const restartTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setIndex((i) => i + 1), ADVANCE_MS);
  };
  useEffect(() => {
    restartTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const count = posts.length;
  const current = count ? ((index % count) + count) % count : 0;
  const post = count ? posts[current] : null;

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

  // Left panel: media at roughly half the width, as tall as the stage allows.
  const mediaCols = Math.max(20, Math.min(Math.floor((width - 10) / 2), 96));
  const mediaRows = Math.max(8, height - 11);
  const hasImage = !!post && !!(post.post_image_unique_id || post.post_image);
  const src = post && hasImage ? imageUrl(post, { w: Math.max(320, mediaCols * 4), webp: 0 }) : "";
  const pixels = usePixelImage(src, mediaCols, mediaRows);
  const videoUrl = post?.is_video ? safeUrl(post.post_video) : "";
  const { slideshow, pending: videoPending } = useVideoSlideshow(videoUrl, mediaCols, mediaRows);
  const media = slideshow?.frame ?? pixels;
  const mediaPending = (hasImage && !media) || videoPending;

  if (!post) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
          ░▒▓ AWAITING TRANSMISSION ▓▒░
        </text>
      </box>
    );
  }

  const pinned = !!post.is_pinned;
  const color = networkColor(post.type);
  const author = post.external_fullname || post.external_name || "anonymous";
  const authorLink = safeUrl(post.external_user_link);
  const postLink = safeUrl(post.post_link);
  const time = relativeTime(post.external_created, now);
  const cta = parseCta(post);
  const showMedia = media || mediaPending;
  // Right panel: cap the measure for readability.
  const textCols = Math.max(
    20,
    Math.min(showMedia ? width - mediaCols - 12 : width - 16, 64),
  );
  // Full post text — the kiosk is a reading view, so no 280-char cap. Only
  // the screen itself limits it: there's no scrolling here, so anything
  // that can't fit the stage is ellipsized on the last visible line.
  const allLines = wrapText(plainComment(post), textCols);
  const maxBodyLines = Math.max(4, height - 16);
  const bodyLines =
    allLines.length > maxBodyLines
      ? allLines
          .slice(0, maxBodyLines)
          .map((line, i) => (i === maxBodyLines - 1 ? line.replace(/\s+$/, "") + " …" : line))
      : allLines;

  const renderBodyLine = (line: string, i: number) => {
    const parts: Array<string | ReactNode> = [];
    let last = 0;
    for (const match of line.matchAll(URL_RE)) {
      if (match.index! > last) parts.push(line.slice(last, match.index));
      parts.push(
        <a
          key={`u${i}-${match.index}`}
          href={safeUrl(match[0]) || match[0]}
          fg={theme.green}
          attributes={TextAttributes.UNDERLINE}
        >
          {match[0]}
        </a>,
      );
      last = match.index! + match[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
      <text key={i} fg={theme.text} style={{ wrapMode: "none" }}>
        {parts.length ? parts : " "}
      </text>
    );
  };

  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 3,
        paddingRight: 3,
        gap: 4,
      }}
    >
      {showMedia ? (
        <box style={{ flexDirection: "column", flexShrink: 0, width: mediaCols }}>
          {media ? (
            media.map((runs, y) => (
              <text key={y} style={{ wrapMode: "none" }}>
                {runs.map((run, i) => (
                  <span key={i} fg={run.fg} bg={run.bg}>
                    {run.text}
                  </span>
                ))}
              </text>
            ))
          ) : (
            <text fg={theme.dim}>░▒▓ receiving image…</text>
          )}
        </box>
      ) : null}

      <box style={{ flexDirection: "column", flexShrink: 1, width: textCols, gap: 1 }}>
        <text fg={pinned ? theme.amber : color} attributes={TextAttributes.BOLD}>
          {pinned ? `▲ PINNED · ${networkBadge(post.type)}` : networkBadge(post.type)}
        </text>
        <box style={{ flexDirection: "column" }}>
          <text fg={color} attributes={TextAttributes.BOLD}>
            {authorLink ? <a href={authorLink}>▌{author}</a> : `▌${author}`}
          </text>
          <text fg={theme.dim}>{postLink ? <a href={postLink}>{time}</a> : time}</text>
        </box>
        {bodyLines.length ? (
          <box style={{ flexDirection: "column" }}>{bodyLines.map(renderBodyLine)}</box>
        ) : null}
        {cta ? (
          <box style={{ flexDirection: "row" }}>
            <text bg={theme.green} fg={theme.bg} attributes={TextAttributes.BOLD}>
              <a href={cta.link}>{` ${cta.label} `}</a>
            </text>
          </box>
        ) : null}
        <text fg={theme.dim}>
          {current + 1} / {count}
        </text>
      </box>
    </box>
  );
}
