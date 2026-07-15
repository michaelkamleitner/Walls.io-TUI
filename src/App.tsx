import { useEffect, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { FluidLayout } from "./FluidLayout";
import { KioskLayout } from "./KioskLayout";
import { MapLayout } from "./MapLayout";
import { theme } from "./theme";
import { createWallClient, type Post, type WallStatus } from "./wall-client";

// Ask for (and top up to) this many posts before the user starts scrolling.
const INITIAL_POSTS = 100;

export type LayoutName = "fluid" | "kiosk" | "map";
export const LAYOUTS: LayoutName[] = ["fluid", "kiosk", "map"];

const STATUS_LABEL: Record<WallStatus, { text: string; color: string }> = {
  connecting: { text: "◌ CONNECTING", color: theme.amber },
  connected: { text: "● LIVE", color: theme.green },
  reconnecting: { text: "◌ RECONNECTING", color: theme.amber },
  error: { text: "✕ RETRYING", color: theme.red },
};

export interface AppProps {
  wallId: number;
  network?: string;
  initialLayout?: LayoutName;
}

export function App({ wallId, network, initialLayout = "fluid" }: AppProps) {
  const client = useMemo(
    () => createWallClient({ wallId, network, initialCount: INITIAL_POSTS }),
    [wallId, network],
  );
  const [layout, setLayout] = useState<LayoutName>(initialLayout);
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState<WallStatus>("connecting");
  const [exhausted, setExhausted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();

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

  // Top up the initial buffer: brokers often send fewer than requested per
  // batch, so keep paging until the feed holds INITIAL_POSTS (or history
  // runs out). canLoadOlder guards in-flight requests and exhaustion.
  useEffect(() => {
    if (posts.length > 0 && posts.length < INITIAL_POSTS && client.canLoadOlder) {
      client.loadOlder(INITIAL_POSTS - posts.length);
    }
  }, [posts, client]);

  // Keep relative timestamps fresh (~30 s, mirroring CUSTOMIZE.md's rule).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Global keys; everything layout-specific lives in the layout components.
  useKeyboard((key) => {
    switch (key.name) {
      case "q":
        renderer.destroy();
        process.exit(0);
      case "l":
        setLayout((l) => LAYOUTS[(LAYOUTS.indexOf(l) + 1) % LAYOUTS.length]);
        break;
      case "r":
        client.restart();
        break;
    }
  });

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
          marginTop: 1,
          marginBottom: 1,
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
            <span fg={theme.dim}> · </span>
            <span fg={theme.text}>{layout.toUpperCase()}</span>
          </text>
          <text fg={statusInfo.color} attributes={TextAttributes.BOLD}>
            {statusInfo.text}
          </text>
        </box>
      </box>

      <text fg={theme.border} style={{ flexShrink: 0, wrapMode: "none" }}>
        {"▔".repeat(Math.max(1, width))}
      </text>

      {layout === "fluid" ? (
        <FluidLayout client={client} posts={posts} now={now} width={width} />
      ) : layout === "kiosk" ? (
        <KioskLayout posts={posts} now={now} width={width} height={height} />
      ) : (
        <MapLayout posts={posts} now={now} width={width} height={height} />
      )}

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
        {layout === "fluid" ? (
          <text fg={theme.dim}>
            <span fg={theme.green}>⇥</span> posts · <span fg={theme.green}>←/→</span> links ·{" "}
            <span fg={theme.green}>↵</span> open · <span fg={theme.green}>j/k</span> scroll ·{" "}
            <span fg={theme.green}>d/u</span> page · <span fg={theme.green}>l</span> layout ·{" "}
            <span fg={theme.green}>r</span> reload · <span fg={theme.green}>q</span> quit
          </text>
        ) : (
          <text fg={theme.dim}>
            <span fg={theme.green}>space/→</span> next · <span fg={theme.green}>←</span> prev ·{" "}
            <span fg={theme.green}>↵</span> open post · <span fg={theme.green}>l</span> layout ·{" "}
            <span fg={theme.green}>r</span> reload · <span fg={theme.green}>q</span> quit
          </text>
        )}
        <text fg={theme.dim}>
          {layout !== "fluid" ? "AUTO-ADVANCE 5s" : exhausted ? "END OF FEED" : "SCROLL FOR MORE"}
        </text>
      </box>
    </box>
  );
}
