import { useEffect, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { ChannelsLayout } from "./ChannelsLayout";
import { DashboardLayout } from "./DashboardLayout";
import { FluidLayout } from "./FluidLayout";
import { KioskLayout } from "./KioskLayout";
import { MapLayout } from "./MapLayout";
import { ScreensaverLayout } from "./ScreensaverLayout";
import { TheaterLayout } from "./TheaterLayout";
import { TickerLayout } from "./TickerLayout";
import { WorldLayout } from "./WorldLayout";
import { theme } from "./theme";
import { createWallClient, type Post, type WallStatus } from "./wall-client";

// Ask for (and top up to) this many posts before the user starts scrolling.
const INITIAL_POSTS = 100;

export type LayoutName =
  | "fluid"
  | "kiosk"
  | "map"
  | "ticker"
  | "theater"
  | "dashboard"
  | "channels"
  | "world"
  | "screensaver";
export const LAYOUTS: LayoutName[] = [
  "fluid",
  "kiosk",
  "map",
  "world",
  "ticker",
  "theater",
  "dashboard",
  "channels",
  "screensaver",
];

// Layout-specific key hints (l/r/q are appended for every layout).
const KEY_HINTS: Record<LayoutName, Array<[string, string]>> = {
  fluid: [
    ["⇥", "posts"],
    ["←/→", "links"],
    ["↵", "open"],
    ["j/k", "scroll"],
    ["d/u", "page"],
    ["s", "auto-scroll"],
  ],
  kiosk: [
    ["space/→", "next"],
    ["←", "prev"],
    ["↵", "open post"],
  ],
  map: [
    ["space/→", "next"],
    ["←", "prev"],
    ["↵", "open post"],
  ],
  world: [
    ["space/→", "next"],
    ["←", "prev"],
    ["↵", "open post"],
  ],
  theater: [
    ["space/→", "next"],
    ["←", "prev"],
    ["↵", "open post"],
  ],
  ticker: [
    ["j/k", "scroll"],
    ["d/u", "page"],
  ],
  dashboard: [],
  channels: [
    ["←/→", "column"],
    ["j/k", "scroll"],
    ["d/u", "page"],
    ["s", "auto-scroll"],
  ],
  screensaver: [["space", "pause"]],
};

const STATUS_LABEL: Record<WallStatus, { text: string; color: string }> = {
  connecting: { text: "◌ CONNECTING", color: theme.amber },
  connected: { text: "● LIVE", color: theme.green },
  reconnecting: { text: "◌ RECONNECTING", color: theme.amber },
  error: { text: "✕ RETRYING", color: theme.red },
};

// Demo mode: how long each layout stays on screen before advancing.
const DEMO_INTERVAL_MS = 60_000;

export interface AppProps {
  wallId: number;
  network?: string;
  initialLayout?: LayoutName;
  demo?: boolean;
}

export function App({ wallId, network, initialLayout = "fluid", demo = false }: AppProps) {
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

  // Demo mode: advance to the next layout every DEMO_INTERVAL_MS. Keyed on
  // `layout` so a manual `l` press restarts the countdown for the new layout.
  useEffect(() => {
    if (!demo) return;
    const t = setTimeout(
      () => setLayout((l) => LAYOUTS[(LAYOUTS.indexOf(l) + 1) % LAYOUTS.length]),
      DEMO_INTERVAL_MS,
    );
    return () => clearTimeout(t);
  }, [demo, layout]);

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
            {demo ? (
              <span fg={theme.amber}> · DEMO</span>
            ) : null}
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
      ) : layout === "map" ? (
        <MapLayout posts={posts} now={now} width={width} height={height} />
      ) : layout === "world" ? (
        <WorldLayout posts={posts} now={now} width={width} height={height} />
      ) : layout === "ticker" ? (
        <TickerLayout posts={posts} now={now} width={width} />
      ) : layout === "theater" ? (
        <TheaterLayout posts={posts} now={now} width={width} height={height} />
      ) : layout === "dashboard" ? (
        <DashboardLayout posts={posts} now={now} width={width} />
      ) : layout === "channels" ? (
        <ChannelsLayout posts={posts} now={now} width={width} />
      ) : (
        <ScreensaverLayout posts={posts} now={now} width={width} height={height} />
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
        <text fg={theme.dim} style={{ wrapMode: "none", flexShrink: 1 }}>
          {[...KEY_HINTS[layout], ["l", "layout"], ["r", "reload"], ["q", "quit"]].map(
            ([k, label], i) => (
              <span key={i}>
                {i > 0 ? " · " : ""}
                <span fg={theme.green}>{k}</span> {label}
              </span>
            ),
          )}
        </text>
        <text fg={theme.dim} style={{ flexShrink: 0, marginLeft: 2 }}>
          {layout === "fluid"
            ? exhausted
              ? "END OF FEED"
              : "SCROLL FOR MORE"
            : layout === "ticker"
              ? "LIVE TAIL"
              : layout === "dashboard"
                ? "LIVE"
                : layout === "channels"
                  ? ""
                  : layout === "screensaver"
                    ? "BOUNCING"
                    : layout === "theater"
                      ? "AUTO-ADVANCE 6s"
                      : "AUTO-ADVANCE 5s"}
        </text>
      </box>
    </box>
  );
}
