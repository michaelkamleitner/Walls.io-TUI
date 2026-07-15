import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { imageToAscii, type AsciiImage } from "./ascii";
import { networkBadge, networkColor, theme } from "./theme";
import {
  imageUrl,
  parseCta,
  plainComment,
  relativeTime,
  safeUrl,
  truncateText,
  type Post,
} from "./wall-client";

function useAsciiImage(url: string, cols: number): AsciiImage | null {
  const [ascii, setAscii] = useState<AsciiImage | null>(null);
  useEffect(() => {
    let alive = true;
    setAscii(null);
    if (!url || cols < 4) return;
    imageToAscii(url, cols).then((result) => {
      if (alive) setAscii(result);
    });
    return () => {
      alive = false;
    };
  }, [url, cols]);
  return ascii;
}

export interface PostCardProps {
  post: Post;
  /** usable columns inside the card (for image sizing) */
  innerWidth: number;
  /** timestamp tick — bump to refresh relative times */
  now: number;
}

export function PostCard({ post, innerWidth, now }: PostCardProps) {
  const pinned = !!post.is_pinned;
  const color = networkColor(post.type);
  const author = post.external_fullname || post.external_name || "anonymous";
  const body = truncateText(plainComment(post));
  const cta = parseCta(post);
  const postLink = safeUrl(post.post_link);
  const time = relativeTime(post.external_created, now);

  const imageCols = Math.min(innerWidth, 72);
  // jimp can't decode webp, so ask the CDN for jpeg/png. Request ~4px per
  // character cell so the downsample has headroom.
  const hasImage = !!(post.post_image_unique_id || post.post_image);
  const src = hasImage ? imageUrl(post, { w: Math.max(160, imageCols * 4), webp: 0 }) : "";
  const ascii = useAsciiImage(src, imageCols);

  return (
    <box
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
        <text fg={color} attributes={TextAttributes.BOLD} style={{ flexShrink: 1 }}>
          ▌{author}
        </text>
        <text fg={theme.dim} style={{ flexShrink: 0, marginLeft: 2 }}>
          {postLink ? <a href={postLink}>{time}</a> : time}
        </text>
      </box>

      {body ? (
        <text fg={theme.text} style={{ wrapMode: "word", marginTop: 1 }}>
          {body}
        </text>
      ) : null}

      {hasImage && !ascii ? (
        <text fg={theme.dim} style={{ marginTop: 1 }}>
          ░░ rendering image…
        </text>
      ) : null}
      {ascii ? (
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          {ascii.map((runs, y) => (
            <text key={y} style={{ wrapMode: "none" }}>
              {runs.map((run, i) => (
                <span key={i} fg={run.fg}>
                  {run.text}
                </span>
              ))}
            </text>
          ))}
        </box>
      ) : null}

      {post.is_video ? (
        <text fg={theme.dim} style={{ marginTop: 1 }}>
          ▶ VIDEO — watch at the source ↗
        </text>
      ) : null}

      {cta ? (
        <box style={{ flexDirection: "row", marginTop: 1 }}>
          <text bg={theme.green} fg={theme.bg} attributes={TextAttributes.BOLD}>
            <a href={cta.link}>{` ${cta.label} `}</a>
          </text>
        </box>
      ) : null}
    </box>
  );
}
