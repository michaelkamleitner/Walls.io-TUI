/*
 * "Screensaver" layout — pure whimsy: three compact post cards drift
 * around the stage DVD-logo style, bouncing off the edges. Every bounce
 * swaps that card to the next post in the feed. Space pauses.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { wrapText } from "./masonry";
import { networkBadge, networkColor, theme } from "./theme";
import { plainComment, truncateText, type Post } from "./wall-client";

const TICK_MS = 120;
const CARD_W = 36;
const CARD_H = 7;
const SPRITES = 3;

interface Sprite {
  x: number;
  y: number;
  vx: number;
  vy: number;
  postIndex: number;
}

export interface ScreensaverLayoutProps {
  posts: Post[];
  now: number;
  width: number;
  height: number;
}

export function ScreensaverLayout({ posts, width, height }: ScreensaverLayoutProps) {
  const stageW = Math.max(CARD_W + 2, width);
  const stageH = Math.max(CARD_H + 2, height - 6);
  const renderer = useRenderer();

  const nextIndex = useRef(SPRITES);
  const [paused, setPaused] = useState(false);
  const [sprites, setSprites] = useState<Sprite[]>(() =>
    Array.from({ length: SPRITES }, (_, i) => ({
      x: 2 + i * 17,
      y: 1 + i * 5,
      vx: i % 2 === 0 ? 1 : -1,
      vy: i % 3 === 0 ? 1 : -1,
      postIndex: i,
    })),
  );

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setSprites((prev) =>
        prev.map((s) => {
          let { x, y, vx, vy, postIndex } = s;
          x += vx;
          y += vy;
          let bounced = false;
          if (x <= 0) {
            x = 0;
            vx = 1;
            bounced = true;
          } else if (x + CARD_W >= stageW) {
            x = stageW - CARD_W;
            vx = -1;
            bounced = true;
          }
          if (y <= 0) {
            y = 0;
            vy = 1;
            bounced = true;
          } else if (y + CARD_H >= stageH) {
            y = stageH - CARD_H;
            vy = -1;
            bounced = true;
          }
          if (bounced) {
            postIndex = nextIndex.current++;
          }
          return { x, y, vx, vy, postIndex };
        }),
      );
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [paused, stageW, stageH]);

  useKeyboard((key) => {
    switch (key.name) {
      case "escape":
        renderer.destroy();
        process.exit(0);
      case "space":
        setPaused((p) => !p);
        break;
    }
  });

  const cards = useMemo(
    () =>
      sprites.map((s) => {
        if (!posts.length) return null;
        const post = posts[s.postIndex % posts.length];
        const color = networkColor(post.type);
        const author = post.external_fullname || post.external_name || "anonymous";
        const body = truncateText(plainComment(post).replace(/\s*\n\s*/g, " "), 90);
        const lines = wrapText(body, CARD_W - 4).slice(0, 3);
        return { post, color, author, lines, sprite: s };
      }),
    [sprites, posts],
  );

  if (!posts.length) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
          ░▒▓ AWAITING TRANSMISSION ▓▒░
        </text>
      </box>
    );
  }

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      {cards.map((card, i) =>
        card ? (
          <box
            key={i}
            border
            style={{
              position: "absolute",
              left: Math.round(card.sprite.x),
              top: Math.round(card.sprite.y),
              width: CARD_W,
              height: CARD_H,
              flexDirection: "column",
              borderStyle: "single",
              borderColor: card.color,
              backgroundColor: theme.panel,
              paddingLeft: 1,
              paddingRight: 1,
            }}
            title={` ${networkBadge(card.post.type)} `}
            titleColor={card.color}
          >
            <text
              fg={card.color}
              attributes={TextAttributes.BOLD}
              style={{ wrapMode: "none" }}
            >
              ▌{card.author}
            </text>
            {card.lines.map((line, j) => (
              <text key={j} fg={theme.text} style={{ wrapMode: "none" }}>
                {line || " "}
              </text>
            ))}
          </box>
        ) : null,
      )}
      {paused ? (
        <box style={{ position: "absolute", right: 2, top: 0 }}>
          <text fg={theme.amber} attributes={TextAttributes.BOLD}>
            ▐▐ PAUSED
          </text>
        </box>
      ) : null}
    </box>
  );
}
