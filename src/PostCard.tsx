import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { postBody, URL_RE } from "./links";
import { wrapText } from "./masonry";
import { imageToPixels, type PixelImage } from "./pixels";
import { networkBadge, networkColor, theme } from "./theme";
import { videoToPixelFrames } from "./video";
import { imageUrl, parseCta, relativeTime, safeUrl, type Post } from "./wall-client";

const SLIDESHOW_INTERVAL_MS = 800;

function usePixelImage(url: string, cols: number): PixelImage | null {
  const [pixels, setPixels] = useState<PixelImage | null>(null);
  useEffect(() => {
    let alive = true;
    setPixels(null);
    if (!url || cols < 4) return;
    imageToPixels(url, cols).then((result) => {
      if (alive) setPixels(result);
    });
    return () => {
      alive = false;
    };
  }, [url, cols]);
  return pixels;
}

// ffmpeg-extracted frames playing as a looping slideshow. `slideshow` is
// null while extraction runs or after it fails — callers fall back to the
// poster image; `pending` distinguishes "still extracting" from "gave up".
function useVideoSlideshow(
  url: string,
  cols: number,
): {
  slideshow: { frame: PixelImage; index: number; count: number } | null;
  pending: boolean;
} {
  const [frames, setFrames] = useState<PixelImage[] | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let alive = true;
    setFrames(null);
    setIndex(0);
    if (!url || cols < 4) return;
    videoToPixelFrames(url, cols).then((result) => {
      if (alive) setFrames(result ?? []); // [] = extraction failed
    });
    return () => {
      alive = false;
    };
  }, [url, cols]);
  useEffect(() => {
    if (!frames || frames.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % frames.length),
      SLIDESHOW_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [frames]);
  if (!frames?.length) return { slideshow: null, pending: !!url && frames === null };
  return {
    slideshow: { frame: frames[index % frames.length], index, count: frames.length },
    pending: false,
  };
}

export interface PostCardProps {
  post: Post;
  /** usable columns inside the card (for image sizing) */
  innerWidth: number;
  /** timestamp tick — bump to refresh relative times */
  now: number;
  /** link key within this post that keyboard selection is on, or null */
  selected: string | null;
}

export function PostCard({ post, innerWidth, now, selected }: PostCardProps) {
  const pinned = !!post.is_pinned;
  const color = networkColor(post.type);
  const author = post.external_fullname || post.external_name || "anonymous";
  const authorLink = safeUrl(post.external_user_link);
  const body = postBody(post);
  // Wrapped in JS, rendered line-by-line — see wrapText for why not wrapMode="word".
  const bodyLines = body ? wrapText(body, innerWidth) : [];
  const cta = parseCta(post);
  const postLink = safeUrl(post.post_link);
  const time = relativeTime(post.external_created, now);

  // Full column width. jimp can't decode webp, so ask the CDN for jpeg/png;
  // ~4 source px per output pixel gives the downsample headroom.
  const hasImage = !!(post.post_image_unique_id || post.post_image);
  const src = hasImage ? imageUrl(post, { w: Math.max(160, innerWidth * 4), webp: 0 }) : "";
  const pixels = usePixelImage(src, innerWidth);

  // Videos: play extracted frames as a slideshow; poster stays as the
  // fallback while frames extract (or when ffmpeg is unavailable).
  const videoUrl = post.is_video ? safeUrl(post.post_video) : "";
  const { slideshow, pending: videoPending } = useVideoSlideshow(videoUrl, innerWidth);
  const stills = slideshow ? [slideshow.frame] : pixels ? [pixels] : null;

  const highlight = { fg: theme.bg, bg: theme.amber } as const;

  // Body lines with URLs underlined; the selected URL is inverse-video.
  // URL keys count occurrences in reading order, matching postLinks().
  let urlCounter = 0;
  const renderBodyLine = (line: string, index: number) => {
    const parts: Array<string | ReturnType<typeof renderUrlSpan>> = [];
    let last = 0;
    for (const match of line.matchAll(URL_RE)) {
      const key = `url:${urlCounter++}`;
      if (match.index! > last) parts.push(line.slice(last, match.index));
      parts.push(renderUrlSpan(match[0], key, selected === key));
      last = match.index! + match[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
      <text key={index} fg={theme.text} style={{ wrapMode: "none" }}>
        {parts.length ? parts : " "}
      </text>
    );
  };

  const renderUrlSpan = (url: string, key: string, isSelected: boolean) => (
    <a
      key={key}
      href={safeUrl(url) || url}
      fg={isSelected ? highlight.fg : theme.green}
      bg={isSelected ? highlight.bg : undefined}
      attributes={TextAttributes.UNDERLINE}
    >
      {url}
    </a>
  );

  return (
    <box
      id={`card-${post.id}`}
      border
      style={{
        borderStyle: "single",
        borderColor: pinned ? theme.amber : theme.border,
        backgroundColor: theme.panel,
        flexDirection: "column",
        width: "100%",
        paddingLeft: 1,
        paddingRight: 1,
        marginBottom: 1,
      }}
      title={pinned ? `▲ PINNED · ${networkBadge(post.type)} ` : ` ${networkBadge(post.type)} `}
      titleColor={pinned ? theme.amber : color}
    >
      <box style={{ flexDirection: "row", justifyContent: "space-between", width: "100%" }}>
        <text
          fg={selected === "author" ? highlight.fg : color}
          bg={selected === "author" ? highlight.bg : undefined}
          attributes={TextAttributes.BOLD}
          style={{ flexShrink: 1 }}
        >
          {authorLink ? <a href={authorLink}>▌{author}</a> : `▌${author}`}
        </text>
        <text
          fg={selected === "time" ? highlight.fg : theme.dim}
          bg={selected === "time" ? highlight.bg : undefined}
          style={{ flexShrink: 0, marginLeft: 2 }}
        >
          {postLink ? <a href={postLink}>{time}</a> : time}
        </text>
      </box>

      {bodyLines.length ? (
        <box style={{ flexDirection: "column", marginTop: 1 }}>{bodyLines.map(renderBodyLine)}</box>
      ) : null}

      {!stills && (hasImage || videoPending) ? (
        <text fg={theme.dim} style={{ marginTop: 1 }}>
          ░▒▓ receiving image…
        </text>
      ) : null}
      {stills ? (
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          {stills[0].map((runs, y) => (
            <text key={y} style={{ wrapMode: "none" }}>
              {runs.map((run, i) => (
                <span key={i} fg={run.fg} bg={run.bg}>
                  {run.text}
                </span>
              ))}
            </text>
          ))}
        </box>
      ) : null}

      {post.is_video && !slideshow ? (
        <text fg={theme.dim} style={{ marginTop: 1 }}>
          ▶ VIDEO — watch at the source ↗
        </text>
      ) : null}

      {cta ? (
        <box style={{ flexDirection: "row", marginTop: 1 }}>
          <text
            bg={selected === "cta" ? highlight.bg : theme.green}
            fg={theme.bg}
            attributes={TextAttributes.BOLD}
          >
            <a href={cta.link}>{` ${cta.label} `}</a>
          </text>
        </box>
      ) : null}
    </box>
  );
}
