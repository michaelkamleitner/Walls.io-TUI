import { useEffect, useMemo, useRef, useState } from "react";
import { spawn } from "node:child_process";
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { linkId, postBody, postLinks } from "./links";
import { distribute } from "./masonry";
import { PostCard } from "./PostCard";
import { theme } from "./theme";
import { createWallClient, type Post, type WallStatus } from "./wall-client";

// Ask for (and top up to) this many posts before the user starts scrolling.
const INITIAL_POSTS = 100;

const STATUS_LABEL: Record<WallStatus, { text: string; color: string }> = {
  connecting: { text: "◌ CONNECTING", color: theme.amber },
  connected: { text: "● LIVE", color: theme.green },
  reconnecting: { text: "◌ RECONNECTING", color: theme.amber },
  error: { text: "✕ RETRYING", color: theme.red },
};

function openInBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // last resort: nothing sensible to do in a TUI
  }
}

export interface AppProps {
  wallId: number;
  network?: string;
}

export function App({ wallId, network }: AppProps) {
  const client = useMemo(
    () => createWallClient({ wallId, network, initialCount: INITIAL_POSTS }),
    [wallId, network],
  );
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState<WallStatus>("connecting");
  const [exhausted, setExhausted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  // Mirror of selectedLink that updates synchronously — rapid/held arrow
  // presses arrive faster than React re-renders, and each press must see
  // the previous one's result.
  const selectedLinkRef = useRef<string | null>(null);
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

  // Infinite scroll: when the view sits near the bottom, page in older posts.
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

  // Flat, reading-ordered list of every openable link in the feed.
  const allLinks = useMemo(() => {
    const flat: Array<{ id: string; url: string; postId: string }> = [];
    for (const post of posts) {
      for (const link of postLinks(post, postBody(post))) {
        flat.push({ id: linkId(post.id, link.key), url: link.url, postId: String(post.id) });
      }
    }
    return flat;
  }, [posts]);

  useKeyboard((key) => {
    const sb = scrollRef.current;
    const page = Math.max(4, (sb?.viewport?.height ?? 10) - 2);
    switch (key.name) {
      case "q":
        renderer.destroy();
        process.exit(0);
      case "escape":
        if (selectedLinkRef.current) {
          selectedLinkRef.current = null;
          setSelectedLink(null);
        } else {
          renderer.destroy();
          process.exit(0);
        }
        break;
      case "left":
      case "right": {
        if (!allLinks.length) break;
        const dir = key.name === "right" ? 1 : -1;
        const current = allLinks.findIndex((l) => l.id === selectedLinkRef.current);
        const next =
          current === -1
            ? dir === 1
              ? 0
              : allLinks.length - 1
            : (current + dir + allLinks.length) % allLinks.length;
        const link = allLinks[next];
        selectedLinkRef.current = link.id;
        setSelectedLink(link.id);
        sb?.scrollChildIntoView(`card-${link.postId}`);
        break;
      }
      case "return":
      case "linefeed": {
        const link = allLinks.find((l) => l.id === selectedLinkRef.current);
        if (link) openInBrowser(link.url);
        break;
      }
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
      case "r":
        client.restart();
        break;
    }
  });

  // Responsive masonry: aim for ~38-column cards (a CSS auto-fill grid
  // with minmax(38ch, 1fr), in terminal terms).
  const gap = 1;
  const usableForCount = width - 4;
  const columnCount = Math.max(1, Math.min(6, Math.floor(usableForCount / 38)));
  const usable = width - 4 - (columnCount - 1) * gap;
  const columnWidth = Math.floor(usable / columnCount);
  // card border (2) + card padding (2)
  const innerWidth = Math.max(16, columnWidth - 4);
  const columns = useMemo(
    () => distribute(posts, columnCount, innerWidth),
    [posts, columnCount, innerWidth],
  );
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
          // key: force a fresh renderable on the empty↔feed swap — reusing
          // the same box leaves this padding stuck on the feed container
          // (removed props aren't reset by the reconciler in OpenTUI 0.4.3).
          <box key="empty" style={{ padding: 2, alignItems: "center" }}>
            <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
              ░▒▓ AWAITING TRANSMISSION ▓▒░
            </text>
          </box>
        ) : (
          <box
            key="feed"
            style={{ flexDirection: "row", width: "100%", alignItems: "flex-start", gap }}
          >
            {columns.map((columnPosts, i) => (
              <box
                key={i}
                style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0, flexShrink: 1 }}
              >
                {columnPosts.map((post) => (
                  <PostCard
                    key={String(post.id)}
                    post={post}
                    innerWidth={innerWidth}
                    now={now}
                    selected={
                      selectedLink?.startsWith(`${post.id}::`)
                        ? selectedLink.slice(`${post.id}::`.length)
                        : null
                    }
                  />
                ))}
              </box>
            ))}
          </box>
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
          <span fg={theme.green}>←/→</span> links · <span fg={theme.green}>↵</span> open ·{" "}
          <span fg={theme.green}>j/k</span> scroll · <span fg={theme.green}>d/u</span> page ·{" "}
          <span fg={theme.green}>r</span> reload · <span fg={theme.green}>q</span> quit
        </text>
        <text fg={theme.dim}>{exhausted ? "END OF FEED" : "SCROLL FOR MORE"}</text>
      </box>
    </box>
  );
}
