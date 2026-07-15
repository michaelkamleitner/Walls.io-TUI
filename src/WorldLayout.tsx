/*
 * "World" layout — every geotagged post on one zoomed-out map. The view is
 * auto-fit to the bounding box of all coordinates; unselected posts show
 * as small dark-orange dots, the selected one gets the full amber marker
 * and its post floats in a card. Space/→/← (or the 5 s auto-advance) cycle
 * through the markers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { postBody } from "./links";
import { clonePixelImage, paintMarker, renderMapImage, worldPixel } from "./map";
import { wrapText } from "./masonry";
import { openInBrowser } from "./open";
import type { PixelImage } from "./pixels";
import { networkBadge, networkColor, theme } from "./theme";
import { relativeTime, safeUrl, type Post } from "./wall-client";

const ADVANCE_MS = 5000;

interface GeoPost {
  post: Post;
  lat: number;
  lon: number;
}

interface View {
  lat: number;
  lon: number;
  zoom: number;
}

// Largest zoom (0..11) where all points fit the stage, centered on the
// bounding box. Zoom scales world pixels by 2^z, so measure at z=0.
// Zoom 0/1 (whole-world) must stay reachable: an India + Florida wall
// needs it, and clamping higher pushes markers off the stage entirely.
function fitView(points: GeoPost[], cols: number, rows: number): View {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
  if (points.length === 1) return { ...center, zoom: 6 };
  const world = points.map((p) => worldPixel(p.lat, p.lon, 0));
  const spanX = Math.max(...world.map((w) => w.x)) - Math.min(...world.map((w) => w.x));
  const spanY = Math.max(...world.map((w) => w.y)) - Math.min(...world.map((w) => w.y));
  // Supersampled canvas is cols*2 × rows*4; leave a 15% margin.
  const fitX = spanX > 0 ? Math.log2((cols * 2 * 0.85) / spanX) : 11;
  const fitY = spanY > 0 ? Math.log2((rows * 4 * 0.85) / spanY) : 11;
  const zoom = Math.max(0, Math.min(11, Math.floor(Math.min(fitX, fitY))));
  return { ...center, zoom };
}

export interface WorldLayoutProps {
  posts: Post[];
  now: number;
  width: number;
  height: number;
}

export function WorldLayout({ posts, now, width, height }: WorldLayoutProps) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<PixelImage | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderer = useRenderer();

  const geoPosts = useMemo<GeoPost[]>(
    () =>
      posts
        .filter((p) => Number(p.latitude) && Number(p.longitude))
        .map((p) => ({ post: p, lat: Number(p.latitude), lon: Number(p.longitude) })),
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
  const selected = count ? geoPosts[current] : null;

  const mapCols = Math.max(20, width);
  const mapRows = Math.max(4, height - 6);
  const view = useMemo(
    () => (count ? fitView(geoPosts, mapCols, mapRows) : null),
    [geoPosts, mapCols, mapRows, count],
  );

  // Base map is memoized by view+size; markers are painted on a clone so
  // selection changes don't refetch tiles.
  useEffect(() => {
    let alive = true;
    if (!view) {
      setStage(null);
      return;
    }
    renderMapImage(view.lat, view.lon, view.zoom, mapCols, mapRows).then((base) => {
      if (!alive || !base) return;
      const image = clonePixelImage(base);
      const centerWorld = worldPixel(view.lat, view.lon, view.zoom);
      const toGrid = (p: GeoPost) => {
        const wp = worldPixel(p.lat, p.lon, view.zoom);
        return {
          // canvas is 2× supersampled, so world px → grid px is /2
          x: Math.round(mapCols / 2 + (wp.x - centerWorld.x) / 2),
          y: Math.round(mapRows + (wp.y - centerWorld.y) / 2),
        };
      };
      // Every post gets the full-size amber marker (same as the Map
      // layout); the selected one is bigger with a white-hot core.
      for (let i = 0; i < geoPosts.length; i++) {
        if (i === current) continue;
        const { x, y } = toGrid(geoPosts[i]);
        paintMarker(image, x, y);
      }
      if (selected) {
        const { x, y } = toGrid(selected);
        paintMarker(image, x, y, { radius: 3.6, core: "#ffffff" });
      }
      setStage(image);
    });
    return () => {
      alive = false;
    };
  }, [view, geoPosts, current, selected, mapCols, mapRows]);

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
        const link = selected && safeUrl(selected.post.post_link);
        if (link) openInBrowser(link);
        break;
      }
    }
  });

  if (!selected) {
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

  const post = selected.post;
  const pinned = !!post.is_pinned;
  const color = networkColor(post.type);
  const author = post.external_fullname || post.external_name || "anonymous";
  const authorLink = safeUrl(post.external_user_link);
  const postLink = safeUrl(post.post_link);
  const time = relativeTime(post.external_created, now);
  const cardWidth = Math.max(30, Math.min(56, width - 8));
  const bodyLines = wrapText(postBody(post), cardWidth - 4).slice(0, 6);

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <box style={{ flexDirection: "column" }}>
        {stage ? (
          stage.map((runs, y) => (
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
            <text fg={theme.dim}>░▒▓ loading world…</text>
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
          ◉ {post.location || `${selected.lat.toFixed(3)}, ${selected.lon.toFixed(3)}`}
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
