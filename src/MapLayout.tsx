/*
 * "Map" layout — a slideshow over the wall's geotagged posts. The stage is
 * a full-bleed rasterized OpenStreetMap view centered on the current
 * post's coordinates (amber ◉ marker), with the post floating in a card
 * at the bottom left. Same navigation contract as Kiosk: 5 s auto-advance,
 * Space/→ next, ← previous, wrap-around, manual navigation resets the
 * timer, Enter opens the post.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { postBody } from "./links";
import { mapToPixels } from "./map";
import { wrapText } from "./masonry";
import { openInBrowser } from "./open";
import type { PixelImage } from "./pixels";
import { networkBadge, networkColor, theme } from "./theme";
import { relativeTime, safeUrl, type Post } from "./wall-client";

const ADVANCE_MS = 5000;

function useMapPixels(
  lat: number,
  lon: number,
  cols: number,
  rows: number,
): PixelImage | null {
  const [pixels, setPixels] = useState<PixelImage | null>(null);
  useEffect(() => {
    let alive = true;
    setPixels(null);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    mapToPixels(lat, lon, cols, rows).then((result) => {
      if (alive) setPixels(result);
    });
    return () => {
      alive = false;
    };
  }, [lat, lon, cols, rows]);
  return pixels;
}

export interface MapLayoutProps {
  posts: Post[];
  now: number;
  width: number;
  height: number;
}

export function MapLayout({ posts, now, width, height }: MapLayoutProps) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderer = useRenderer();

  const geoPosts = useMemo(
    () => posts.filter((p) => Number(p.latitude) && Number(p.longitude)),
    [posts],
  );

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

  const count = geoPosts.length;
  const current = count ? ((index % count) + count) % count : 0;
  const post = count ? geoPosts[current] : null;

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

  // Full-bleed stage: header (5 rows incl. separator) + footer (1) are
  // outside this component; the map fills everything in between.
  const mapCols = Math.max(20, width);
  const mapRows = Math.max(4, height - 6);
  const lat = Number(post?.latitude);
  const lon = Number(post?.longitude);
  const map = useMapPixels(lat, lon, mapCols, mapRows);

  if (!post) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 1 }}>
        <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
          {posts.length === 0
            ? "░▒▓ AWAITING TRANSMISSION ▓▒░"
            : "░▒▓ NO GEOTAGGED POSTS ON THIS WALL ▓▒░"}
        </text>
        {posts.length > 0 ? (
          <text fg={theme.dim}>
            press <span fg={theme.green}>l</span> for another layout
          </text>
        ) : null}
      </box>
    );
  }

  const pinned = !!post.is_pinned;
  const color = networkColor(post.type);
  const author = post.external_fullname || post.external_name || "anonymous";
  const authorLink = safeUrl(post.external_user_link);
  const postLink = safeUrl(post.post_link);
  const time = relativeTime(post.external_created, now);
  const cardWidth = Math.max(30, Math.min(56, width - 8));
  const bodyLines = wrapText(postBody(post), cardWidth - 4).slice(0, 8);

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <box style={{ flexDirection: "column" }}>
        {map ? (
          map.map((runs, y) => (
            <text key={y} style={{ wrapMode: "none" }}>
              {runs.map((run, i) => (
                <span key={i} fg={run.fg} bg={run.bg}>
                  {run.text}
                </span>
              ))}
            </text>
          ))
        ) : (
          <box
            style={{ width: "100%", height: mapRows, alignItems: "center", justifyContent: "center" }}
          >
            <text fg={theme.dim}>░▒▓ loading map…</text>
          </box>
        )}
      </box>

      <box
        border
        style={{
          position: "absolute",
          left: 2,
          bottom: 0,
          width: cardWidth,
          flexDirection: "column",
          borderStyle: "single",
          borderColor: pinned ? theme.amber : theme.border,
          backgroundColor: theme.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
        title={pinned ? `▲ PINNED · ${networkBadge(post.type)} ` : ` ${networkBadge(post.type)} `}
        titleColor={pinned ? theme.amber : color}
      >
        <box style={{ flexDirection: "row", justifyContent: "space-between", width: "100%" }}>
          <text fg={color} attributes={TextAttributes.BOLD} style={{ flexShrink: 1 }}>
            {authorLink ? <a href={authorLink}>▌{author}</a> : `▌${author}`}
          </text>
          <text fg={theme.dim} style={{ flexShrink: 0, marginLeft: 2 }}>
            {postLink ? <a href={postLink}>{time}</a> : time}
          </text>
        </box>
        <text fg={theme.amber}>
          ◉ {post.location || `${lat.toFixed(3)}, ${lon.toFixed(3)}`}
        </text>
        {bodyLines.length ? (
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            {bodyLines.map((line, i) => (
              <text key={i} fg={theme.text} style={{ wrapMode: "none" }}>
                {line || " "}
              </text>
            ))}
          </box>
        ) : null}
        <text fg={theme.dim} style={{ marginTop: 1 }}>
          {current + 1} / {count} geotagged
        </text>
      </box>
    </box>
  );
}
