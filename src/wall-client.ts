/*
 * walls.io broadcaster client — TypeScript/TUI port of the original
 * wall-client.js (removed from the working tree; see git history).
 *
 * Same layout-agnostic data layer as the browser original: connects to the
 * walls.io broadcaster (Socket.IO) for a single wall, keeps a de-duplicated,
 * sorted list of posts ("checkins"), and notifies the view via a `change`
 * callback. This port mirrors its behavior 1:1 (sort order, dedupe,
 * pagination cursor inside `lowestCheckin`, empty-page exhaustion heuristic,
 * microtask coalescing).
 *
 * Protocol, reverse-engineered from walls.io's own wall-fluid.js:
 *
 *   server -> client
 *     'new checkins'         Array<Checkin>   fresh posts (initial + live; a
 *                                             re-shown post comes back here)
 *     'old checkins'         Array<Checkin>   paginated history
 *     'no more old checkins' ()               pagination done
 *     'update checkin data'  Checkin          partial update (weight, pin,
 *                                             moderation, …)
 *     'removed checkins'     Array<Id>        posts hidden/deleted by admin
 *     'looped post'          Checkin          single post being looped to top
 *     'wallping'             { serverStartedAt, serverTime }   keepalive
 *     'reload wall'          ()               server asks client to reload
 *
 *   client -> server
 *     'request older checkins' {
 *       count, network,
 *       lowestCheckin: { sortings, is_pinned, <sortField>, id }
 *     }   — used by `loadOlder(count)` to paginate history. The cursor
 *           lives under `lowestCheckin` (not at the top level — that's the
 *           bit easy to miss; mirrors wall-fluid.js). Server replies with
 *           an `old checkins` page, or `no more old checkins` when done.
 *     'get single checkin'     id, callback  (supported, not currently used)
 *
 * Differences from the browser version, all forced by the terminal target:
 *   - `io` comes from the socket.io-client package, not `window.io`.
 *   - `truncateComment` (DOM-based, HTML in/out) is replaced by
 *     `plainComment` + `truncateText`, which produce plain terminal text.
 *   - `reload wall` cannot reload a page; with no `reload` listener the
 *     client restarts itself (clears the map and reconnects).
 *   - a `status` event exposes socket connection state for the UI.
 */
import { io, type Socket } from "socket.io-client";

const NODE_URL = "https://broadcaster.walls.io";

export interface Post {
  id: string | number;
  type: string;
  sub_type?: string | null;
  is_pinned?: 0 | 1 | boolean;
  external_fullname?: string;
  external_name?: string;
  external_image?: string;
  external_image_unique_id?: string;
  external_user_link?: string;
  external_created?: string;
  external_created_timestamp?: number;
  comment?: string;
  html_comment?: string;
  post_image?: string;
  post_image_unique_id?: string;
  post_image_alt_text?: string;
  post_image_width?: number;
  post_image_height?: number;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location?: string | null;
  is_video?: number | boolean;
  post_video?: string;
  post_video_width?: number;
  post_video_height?: number;
  post_link?: string;
  cta?: string | { text?: string; url?: string; label?: string; link?: string };
  weight?: number;
  [key: string]: unknown;
}

export type WallStatus = "connecting" | "connected" | "reconnecting" | "error";

export interface WallClientOptions {
  wallId: number;
  nodeUrl?: string;
  rankField?: string;
  frontendToken?: string;
  network?: string;
  /**
   * How many posts to ask the broadcaster for up front (the `initialCheckins`
   * query param). The server may send fewer per batch — the view is expected
   * to top up via loadOlder() until it has enough (App does this).
   */
  initialCount?: number;
}

interface Listeners {
  change: Array<(posts: Post[]) => void>;
  reload: Array<() => void>;
  "older-loaded": Array<(info: { exhausted: boolean; added?: number }) => void>;
  status: Array<(status: WallStatus) => void>;
}

// Per-network image CDNs — same table as ../wall-client.js. The raw
// cdn.walls.io URLs are referer-locked and won't load from here either;
// these resizing CDNs are the only reliable image source.
const IMAGE_CDNS: Record<string, string> = {
  default: "https://img-df-cdn.walls.io/",
  direct_post: "https://img-dp-pt-cdn.walls.io/",
  "direct_post+photo_booth_loop": "https://img-dp-pb-cdn.walls.io/",
  "direct_post+photo_booth_image": "https://img-dp-pb-cdn.walls.io/",
  wallsio: "https://img-np-pt-cdn.walls.io/",
  facebook: "https://img-fb-cdn.walls.io/",
  bluesky: "https://img-bs-cdn.walls.io/",
  flickr: "https://img-fl-cdn.walls.io/",
  instagram: "https://img-ig-cdn.walls.io/",
  linkedin: "https://img-li-cdn.walls.io/",
  mastodon: "https://img-mt-cdn.walls.io/",
  pinterest: "https://img-pi-cdn.walls.io/",
  poll: "https://img-pl-cdn.walls.io/",
  reddit: "https://img-rd-cdn.walls.io/",
  rss: "https://img-rs-cdn.walls.io/",
  tiktok: "https://img-tt-cdn.walls.io/",
  tumblr: "https://img-tu-cdn.walls.io/",
  twitter: "https://img-tw-cdn.walls.io/",
  vimeo: "https://img-vi-cdn.walls.io/",
  youtube: "https://img-yt-cdn.walls.io/",
};

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

// Same breakpoints as the web client (frozen — see CUSTOMIZE.md).
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const sec = Math.round((t - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return "Just now";
  if (abs < 60 * 60) return RTF.format(Math.round(sec / 60), "minute");
  if (abs < 60 * 60 * 24) return RTF.format(Math.round(sec / 3600), "hour");
  if (abs < 60 * 60 * 24 * 7) return RTF.format(Math.round(sec / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  eur: "€",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
};

// `post.comment` arrives with HTML entities already encoded ("What&#39;s").
// The browser layouts render it as innerHTML; a terminal has to decode.
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

// Plain-text body of a post. Prefers `comment` (plain text + entities);
// falls back to `html_comment` with tags stripped (Twemoji <img> tags carry
// the emoji character in alt=, so pull that out first).
export function plainComment(post: Post): string {
  let text = post.comment;
  if (!text && post.html_comment) {
    text = post.html_comment
      .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, "$1")
      .replace(/<[^>]+>/g, "");
  }
  if (!text) return "";
  // Collapse runs of spaces/tabs and strip line-trailing whitespace —
  // hanging spaces at a wrap boundary can overflow the card border.
  return decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

// Terminal counterpart of the web client's truncateComment: same ~280-char
// budget, same rewind-to-whitespace rule, ellipsis appended. (Links/emoji
// atomicity doesn't apply — there is no markup left at this point.)
export function truncateText(text: string, maxChars = 280): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const cut = slice.search(/\s\S*$/);
  return (cut > 0 ? slice.slice(0, cut) : slice).replace(/\s+$/, "") + "…";
}

const SAFE_URL_SCHEMES = ["http:", "https:", "mailto:"];
export function safeUrl(value: unknown): string {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  try {
    const u = new URL(s, "https://x.invalid/");
    return SAFE_URL_SCHEMES.includes(u.protocol) ? s : "";
  } catch {
    return "";
  }
}

export interface Cta {
  label: string;
  link: string;
}

// `post.cta` is a JSON string ('{"text":"DOWNLOAD","url":"…"}'); some
// payloads use label/link. Same normalization as the web client.
export function parseCta(post: Post): Cta | null {
  let cta = post?.cta;
  if (!cta) return null;
  if (typeof cta === "string") {
    try {
      cta = JSON.parse(cta);
    } catch {
      return null;
    }
  }
  if (!cta || typeof cta !== "object") return null;
  const label = String(cta.text || cta.label || "").replace(/_/g, " ").trim();
  const link = safeUrl(cta.url || cta.link || "");
  if (!label || !link) return null;
  return { label, link };
}

function pickCdn(type: string, subType: string): string {
  return IMAGE_CDNS[`${type}+${subType}`] || IMAGE_CDNS[type] || IMAGE_CDNS.default;
}

export interface ImageUrlOptions {
  field?: string;
  w?: number;
  h?: number;
  q?: number;
  nu?: number;
  webp?: number;
}

export function imageUrl(post: Post, opts: ImageUrlOptions = {}): string {
  const field = opts.field || "post_image";
  const uid = post[`${field}_unique_id`] as string | undefined;
  if (!uid) return (post[field] as string) || "";
  const cdn = pickCdn(post.type, post.sub_type || "default");
  const qs = new URLSearchParams();
  if (opts.w != null) qs.set("w", String(opts.w));
  if (opts.h != null) qs.set("h", String(opts.h));
  qs.set("q", String(opts.q ?? 85));
  qs.set("nu", String(opts.nu ?? 1));
  qs.set("webp", String(opts.webp ?? 1));
  return `${cdn}${uid}?${qs}`;
}

export interface WallClient {
  start(): Socket;
  stop(): void;
  restart(): void;
  on<E extends keyof Listeners>(event: E, fn: Listeners[E][number]): () => void;
  loadOlder(count?: number): boolean;
  imageUrl: typeof imageUrl;
  relativeTime: typeof relativeTime;
  plainComment: typeof plainComment;
  truncateText: typeof truncateText;
  parseCta: typeof parseCta;
  safeUrl: typeof safeUrl;
  readonly socket: Socket | null;
  readonly posts: Post[];
  readonly status: WallStatus;
  readonly canLoadOlder: boolean;
  readonly isExhausted: boolean;
}

export function createWallClient(opts: WallClientOptions): WallClient {
  if (!opts || !opts.wallId) throw new Error("createWallClient: wallId required");
  const nodeUrl = opts.nodeUrl || NODE_URL;
  const rankField = opts.rankField || "weight";
  const network = opts.network || "";

  const checkins = new Map<string, Post>();
  const listeners: Listeners = { change: [], reload: [], "older-loaded": [], status: [] };
  let sock: Socket | null = null;
  let pending = false;
  let lastSorted: Post[] = [];
  let loadingOlder = false;
  let exhausted = false;
  let status: WallStatus = "connecting";

  // Mirror wall-fluid.js sort: ['is_pinned', <rankField>, 'id'] descending.
  function compare(a: Post, b: Post): number {
    return (
      (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) ||
      (Number(b[rankField]) || 0) - (Number(a[rankField]) || 0) ||
      (Number(b.id) || 0) - (Number(a.id) || 0)
    );
  }

  function setStatus(next: WallStatus) {
    if (status === next) return;
    status = next;
    for (const fn of listeners.status) fn(status);
  }

  function notifyChange() {
    // Coalesce bursts (e.g. an `old checkins` page of 100) per microtask.
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      lastSorted = [...checkins.values()].sort(compare);
      for (const fn of listeners.change) fn(lastSorted);
    });
  }

  // Returns the number of genuinely-new entries; the `old checkins` handler
  // uses added === 0 as the exhaustion signal (some walls never send
  // `no more old checkins` and just replay the current snapshot).
  function upsert(arr: Post[]): number {
    if (!Array.isArray(arr) || !arr.length) return 0;
    let added = 0;
    let touched = false;
    for (const c of arr) {
      if (!c || c.id == null) continue;
      const key = String(c.id);
      if (!checkins.has(key)) added++;
      checkins.set(key, c);
      touched = true;
    }
    if (touched) notifyChange();
    return added;
  }

  function remove(ids: Array<string | number> | string | number) {
    const list = Array.isArray(ids) ? ids : [ids];
    let changed = false;
    for (const id of list) {
      if (id == null) continue;
      if (checkins.delete(String(id))) changed = true;
    }
    if (changed) notifyChange();
  }

  function start(): Socket {
    if (sock) return sock;
    setStatus("connecting");
    const qs = new URLSearchParams({
      wallId: String(opts.wallId),
      client: "wallsio-frontend",
      frontendToken: opts.frontendToken || "",
      initialCheckins: opts.initialCount != null ? String(opts.initialCount) : "",
      network,
    });
    sock = io(`${nodeUrl}?${qs}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnectionDelay: 100,
      reconnectionDelayMax: 30000,
      timeout: 10000,
      withCredentials: true,
    });
    // wall-fluid.js falls back to long-polling on error; do the same.
    sock.on("connect_error", () => {
      sock!.io.opts.transports = ["polling", "websocket"];
      sock!.io.opts.timeout = 20000;
      setStatus("error");
    });
    sock.on("connect", () => setStatus("connected"));
    sock.on("disconnect", () => setStatus("reconnecting"));
    sock.io.on("reconnect_attempt", () => setStatus("reconnecting"));

    sock.on("new checkins", upsert);
    sock.on("old checkins", (arr: Post[]) => {
      const added = upsert(arr);
      loadingOlder = false;
      if (added === 0) exhausted = true;
      for (const fn of listeners["older-loaded"]) fn({ exhausted, added });
    });
    sock.on("looped post", (c: Post) => upsert([c]));
    sock.on("update checkin data", (c: Post) => upsert([c]));
    sock.on("removed checkins", remove);
    sock.on("no more old checkins", () => {
      loadingOlder = false;
      exhausted = true;
      for (const fn of listeners["older-loaded"]) fn({ exhausted: true });
    });
    sock.on("wallping", () => {});
    sock.on("reload wall", () => {
      // No page to reload in a terminal: restart the client unless the
      // view wants to handle it itself.
      if (listeners.reload.length === 0) restart();
      else for (const fn of listeners.reload) fn();
    });
    return sock;
  }

  function stop() {
    if (sock) {
      sock.close();
      sock = null;
    }
    loadingOlder = false;
    exhausted = false;
  }

  function restart() {
    stop();
    checkins.clear();
    lastSorted = [];
    notifyChange();
    start();
  }

  // Cursor fields live under `lowestCheckin` — top-level cursor fields are
  // silently ignored by the broadcaster. Mirrors wall-fluid.js.
  function loadOlder(count = 30): boolean {
    if (!sock || loadingOlder || exhausted) return false;
    const tail = lastSorted.filter((p) => p.type !== "sponsored").at(-1);
    if (!tail) return false;
    const payload = {
      count,
      network,
      lowestCheckin: {
        sortings: ["is_pinned", rankField, "id"],
        is_pinned: tail.is_pinned,
        [rankField]: tail[rankField],
        id: parseInt(String(tail.id), 10) || 0,
      },
    };
    loadingOlder = true;
    sock.emit("request older checkins", payload);
    return true;
  }

  function on<E extends keyof Listeners>(event: E, fn: Listeners[E][number]): () => void {
    if (!listeners[event]) throw new Error(`unknown event: ${String(event)}`);
    (listeners[event] as Array<unknown>).push(fn);
    // Deliver the current snapshot synchronously so views that subscribe
    // after start() don't miss data.
    if (event === "change" && lastSorted.length) (fn as (posts: Post[]) => void)(lastSorted);
    return () => {
      const arr = listeners[event] as Array<unknown>;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  return {
    start,
    stop,
    restart,
    on,
    loadOlder,
    imageUrl,
    relativeTime,
    plainComment,
    truncateText,
    parseCta,
    safeUrl,
    get socket() {
      return sock;
    },
    get posts() {
      return lastSorted;
    },
    get status() {
      return status;
    },
    get canLoadOlder() {
      return !!sock && !loadingOlder && !exhausted;
    },
    get isExhausted() {
      return exhausted;
    },
  };
}
