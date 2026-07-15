import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { PostCard } from "./PostCard";
import { theme } from "./theme";
import { createWallClient, type Post, type WallStatus } from "./wall-client";

const STATUS_LABEL: Record<WallStatus, { text: string; color: string }> = {
  connecting: { text: "◌ CONNECTING", color: theme.amber },
  connected: { text: "● LIVE", color: theme.green },
  reconnecting: { text: "◌ RECONNECTING", color: theme.amber },
  error: { text: "✕ RETRYING", color: theme.red },
};

export interface AppProps {
  wallId: number;
  network?: string;
}

export function App({ wallId, network }: AppProps) {
  const client = useMemo(() => createWallClient({ wallId, network }), [wallId, network]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState<WallStatus>("connecting");
  const [exhausted, setExhausted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();

  useEffect(() => {
    const offChange = client.on("change", (next) => setPosts([...next]));
    const offStatus = client.on("status", setStatus);
    const offOlder = client.on("older-loaded", (info) => setExhausted(info.exhausted));
    client.start();
    return () => {
      offChange();
      offStatus();
      offOlder();
      client.stop();
    };
  }, [client]);

  // Keep relative timestamps fresh (~30 s, mirroring CUSTOMIZE.md's rule).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Infinite scroll: when the view sits near the bottom, page in older
  // posts. canLoadOlder already guards in-flight and exhausted states.
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

  useKeyboard((key) => {
    const sb = scrollRef.current;
    const page = Math.max(4, (sb?.viewport?.height ?? 10) - 2);
    switch (key.name) {
      case "q":
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
      case "g":
        if (key.shift) sb?.scrollTo(sb.scrollHeight);
        else sb?.scrollTo(0);
        break;
      case "r":
        client.restart();
        break;
    }
  });

  // outer padding (2) + card border (2) + card padding (2) + scrollbar (2)
  const innerWidth = Math.max(20, width - 8);
  const statusInfo = STATUS_LABEL[status];

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: theme.bg,
        flexDirection: "column",
      }}
    >
      <box
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          paddingLeft: 1,
          paddingRight: 1,
          flexShrink: 0,
        }}
      >
        <ascii-font text="WALLS.IO" font="tiny" color={theme.green} backgroundColor={theme.bg} />
        <box style={{ flexDirection: "column", alignItems: "flex-end" }}>
          <text fg={theme.dim}>
            WALL <span fg={theme.text}>#{wallId}</span>
            {network ? <span fg={theme.dim}> · {network.toUpperCase()}</span> : null}
            <span fg={theme.dim}> · </span>
            <span fg={theme.text}>{posts.length}</span> POSTS
          </text>
          <text fg={statusInfo.color} attributes={TextAttributes.BOLD}>
            {statusInfo.text}
          </text>
        </box>
      </box>

      <text fg={theme.border} style={{ flexShrink: 0, wrapMode: "none" }}>
        {"▔".repeat(Math.max(1, width))}
      </text>

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
          <box style={{ padding: 2, alignItems: "center" }}>
            <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
              ░▒▓ AWAITING TRANSMISSION ▓▒░
            </text>
          </box>
        ) : (
          posts.map((post) => (
            <PostCard key={String(post.id)} post={post} innerWidth={innerWidth} now={now} />
          ))
        )}
        {exhausted && posts.length > 0 ? (
          <box style={{ alignItems: "center", marginBottom: 1 }}>
            <text fg={theme.dim}>── END OF FEED ──</text>
          </box>
        ) : null}
      </scrollbox>

      <box
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: theme.panel,
          flexShrink: 0,
        }}
      >
        <text fg={theme.dim}>
          <span fg={theme.green}>j/k</span> scroll · <span fg={theme.green}>d/u</span> page ·{" "}
          <span fg={theme.green}>g/G</span> top/end · <span fg={theme.green}>r</span> reload ·{" "}
          <span fg={theme.green}>q</span> quit
        </text>
        <text fg={theme.dim}>{exhausted ? "END OF FEED" : "SCROLL FOR MORE"}</text>
      </box>
    </box>
  );
}
