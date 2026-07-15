/*
 * walls.io broadcaster client (layout-agnostic)
 *
 * Connects to the walls.io broadcaster (Socket.IO) for a single wall, keeps a
 * de-duplicated, sorted list of posts ("checkins"), and notifies a layout via
 * a `change` callback whenever that list changes. Layouts only deal with the
 * sorted array — they don't touch sockets, sorting, or de-duping.
 *
 * Depends on `window.io` (the patched walls.io socketio bundle, loaded via
 * <script src="socketio.js">).
 *
 *   const client = createWallClient({ wallId: 139355 });
 *   client.on('change', (posts) => render(posts));
 *   client.start();
 *
 * The protocol is reverse-engineered from wall-fluid.js:
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
 *     }   — used by `client.loadOlder(count)` to paginate history. The
 *           cursor lives under `lowestCheckin` (not at the top level —
 *           that's the bit easy to miss; mirrors wall-fluid.js). Server
 *           replies with an `old checkins` page, or `no more old checkins`
 *           when done.
 *     'get single checkin'     id, callback  (supported, not currently used)
 */
(() => {
  const NODE_URL = 'https://broadcaster.walls.io';

  // Per-network image CDNs, copied from the cventconnect page's
  // `wallOptions.imageCdns`. The broadcaster sends `<field>_unique_id`
  // already shaped as `<ulid>+<type>+<sub_type||"default">`; the final URL
  // is just `<cdn>/<unique_id>?w=…&q=…&webp=1&nu=1`. We pick the CDN by
  // looking up `<type>+<sub_type>`, then `<type>`, then `default` — the
  // same lookup wall-fluid.js does in decideCdn().
  const IMAGE_CDNS = {
    'default':                       'https://img-df-cdn.walls.io/',
    'direct_post':                   'https://img-dp-pt-cdn.walls.io/',
    'direct_post+photo_booth_loop':  'https://img-dp-pb-cdn.walls.io/',
    'direct_post+photo_booth_image': 'https://img-dp-pb-cdn.walls.io/',
    'wallsio':                       'https://img-np-pt-cdn.walls.io/',
    'facebook':                      'https://img-fb-cdn.walls.io/',
    'bluesky':                       'https://img-bs-cdn.walls.io/',
    'flickr':                        'https://img-fl-cdn.walls.io/',
    'instagram':                     'https://img-ig-cdn.walls.io/',
    'linkedin':                      'https://img-li-cdn.walls.io/',
    'mastodon':                      'https://img-mt-cdn.walls.io/',
    'pinterest':                     'https://img-pi-cdn.walls.io/',
    'poll':                          'https://img-pl-cdn.walls.io/',
    'reddit':                        'https://img-rd-cdn.walls.io/',
    'rss':                           'https://img-rs-cdn.walls.io/',
    'tiktok':                        'https://img-tt-cdn.walls.io/',
    'tumblr':                        'https://img-tu-cdn.walls.io/',
    'twitter':                       'https://img-tw-cdn.walls.io/',
    'vimeo':                         'https://img-vi-cdn.walls.io/',
    'youtube':                       'https://img-yt-cdn.walls.io/',
  };

  // ---- Human-readable timestamps -----------------------------------------
  // Every layout must show post timestamps in a human-friendly way (and
  // link them to the original post — see CUSTOMIZE.md). To keep that
  // consistent we ship one canonical formatter here.
  //
  //   relativeTime('2026-05-08T16:35:00.000Z')   // → '5 minutes ago'
  //
  // < 45 s          'Just now'
  // < 1 hour        'N minutes ago'
  // < 1 day         'N hours ago'
  // < 1 week        'N days ago'
  // older           absolute date in the user's locale (e.g. '23 Mar 2026')
  const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relativeTime(iso, now = Date.now()) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const sec = Math.round((t - now) / 1000); // negative for past
    const abs = Math.abs(sec);
    if (abs < 45)             return 'Just now';
    if (abs < 60 * 60)        return RTF.format(Math.round(sec / 60),    'minute');
    if (abs < 60 * 60 * 24)   return RTF.format(Math.round(sec / 3600),  'hour');
    if (abs < 60 * 60 * 24 * 7) return RTF.format(Math.round(sec / 86400), 'day');
    return new Date(iso).toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ---- Comment truncation -------------------------------------------------
  // Layouts must keep post bodies short (≈ 280 chars) so the wall reads as a
  // glanceable feed and never as a wall of text. Naïve `string.slice` breaks
  // HTML and chops words/URLs in half. This helper:
  //   - measures plain-text length, ignoring tag overhead
  //   - treats <a> / <img> (emoji) as atomic — never cut mid-link / mid-emoji
  //   - rewinds to the nearest whitespace boundary so words stay intact
  //   - appends an ellipsis and a "more" link to the original post
  // Pass `post.post_link` so the "more" link points at the source.
  //
  //   client.truncateComment(post.html_comment, post.post_link)
  //   client.truncateComment(html, link, { maxChars: 200, moreLabel: 'read more' })
  function truncateComment(html, postLink, opts = {}) {
    const maxChars  = opts.maxChars  ?? 280;
    const moreLabel = opts.moreLabel ?? 'more';
    if (!html) return '';
    const root = document.createElement('div');
    root.innerHTML = html;
    if ((root.textContent || '').length <= maxChars) return html;

    let used = 0, done = false;
    function visit(node) {
      if (done) return false;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (used + text.length <= maxChars) { used += text.length; return true; }
        const budget = Math.max(0, maxChars - used);
        const slice  = text.slice(0, budget);
        // Rewind to last whitespace in the slice (don't cut mid-word).
        const cut    = slice.search(/\s\S*$/);
        node.nodeValue = (cut > 0 ? slice.slice(0, cut) : slice).replace(/\s+$/, '') + '…';
        done = true;
        return true;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return true;
      // Anchors and emoji <img>s are atomic: include whole or drop whole.
      if (node.tagName === 'A' || node.tagName === 'IMG') {
        const len = (node.textContent || '').length || 1;
        if (used + len <= maxChars) { used += len; return true; }
        done = true;
        return false;
      }
      // Recurse, drop trailing children that don't fit.
      const drop = [];
      for (const child of [...node.childNodes]) {
        if (!visit(child)) drop.push(child);
      }
      for (const c of drop) c.remove();
      return true;
    }
    const drop = [];
    for (const child of [...root.childNodes]) {
      if (!visit(child)) drop.push(child);
    }
    for (const c of drop) c.remove();

    if (postLink) {
      const a = document.createElement('a');
      a.className   = 'more';
      a.href        = postLink;
      a.target      = '_blank';
      a.rel         = 'noopener';
      a.textContent = moreLabel;
      root.appendChild(document.createTextNode(' '));
      root.appendChild(a);
    }
    return root.innerHTML;
  }

  // ---- URL safety ---------------------------------------------------------
  // Only let benign URL schemes through to `href` attributes. `escapeHtml`
  // alone doesn't help: a value like `javascript:alert(1)` passes through
  // unchanged and runs on click. Use this for every author-controlled URL
  // before interpolating it (post links, profile links, CTA links).
  const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];
  function safeUrl(value) {
    if (value == null) return '';
    const s = String(value).trim();
    if (!s) return '';
    // Relative URLs (no scheme) are fine — they resolve against our origin.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
    try {
      const u = new URL(s, 'https://x.invalid/');
      return SAFE_URL_SCHEMES.includes(u.protocol) ? s : '';
    } catch {
      return '';
    }
  }

  // ---- CTA parsing --------------------------------------------------------
  // Walls.io ships `post.cta` as a JSON string (e.g.
  // '{"text":"DOWNLOAD","url":"https://…"}'); some payloads use
  // `label`/`link` instead of `text`/`url`. Returns a normalised
  // `{ label, link }` pair, with the link protocol-checked through
  // safeUrl(), or `null` when no CTA is configured / fields are missing /
  // the URL is unsafe. The label is normalised by replacing `_` with space
  // so canonical strings like `DONATE_NOW` render as `DONATE NOW`.
  function parseCta(post) {
    let cta = post && post.cta;
    if (!cta) return null;
    if (typeof cta === 'string') {
      try { cta = JSON.parse(cta); } catch { return null; }
    }
    if (!cta || typeof cta !== 'object') return null;
    const label = String(cta.text || cta.label || '').replace(/_/g, ' ').trim();
    const link  = safeUrl(cta.url  || cta.link  || '');
    if (!label || !link) return null;
    return { label, link };
  }

  function pickCdn(type, subType) {
    return IMAGE_CDNS[`${type}+${subType}`]
        || IMAGE_CDNS[type]
        || IMAGE_CDNS.default;
  }

  /**
   * Build a CDN image URL for a post field.
   *
   *   imageUrl(post)                        // post image, default size
   *   imageUrl(post, { w: 800 })            // post image, width hint
   *   imageUrl(post, { field: 'external_image', w: 200, h: 200 })  // avatar
   *
   * Falls back to the raw post field URL if the post has no `*_unique_id`
   * (some sources go straight to the upstream image without proxying).
   */
  function imageUrl(post, opts = {}) {
    const field = opts.field || 'post_image';
    const uid   = post[`${field}_unique_id`];
    if (!uid) return post[field] || '';
    const cdn = pickCdn(post.type, post.sub_type || 'default');
    const qs  = new URLSearchParams();
    if (opts.w != null) qs.set('w', opts.w);
    if (opts.h != null) qs.set('h', opts.h);
    qs.set('q',    opts.q    ?? 85);
    qs.set('nu',   opts.nu   ?? 1);
    qs.set('webp', opts.webp ?? 1);
    return `${cdn}${uid}?${qs}`;
  }

  /**
   * @param {object}  opts
   * @param {number}  opts.wallId       wall id to subscribe to (required)
   * @param {string} [opts.nodeUrl]     broadcaster URL (default: walls.io)
   * @param {string} [opts.rankField]   sort field, e.g. 'weight' (default)
   * @param {string} [opts.frontendToken]
   * @param {string} [opts.network]     restrict to one network (e.g. 'twitter')
   */
  function createWallClient(opts) {
    if (!opts || !opts.wallId) throw new Error('createWallClient: wallId required');
    const nodeUrl   = opts.nodeUrl   || NODE_URL;
    const rankField = opts.rankField || 'weight';
    const network   = opts.network   || '';

    /** @type {Map<string, object>} */
    const checkins = new Map();
    const listeners = { change: [], reload: [], 'older-loaded': [] };
    let sock = null;
    let pending = false;
    let lastSorted = [];
    // Pagination state. `loadingOlder` is set while a 'request older checkins'
    // is in flight to suppress duplicate emits; `exhausted` flips to true on
    // 'no more old checkins' so subsequent loadOlder() calls become no-ops.
    let loadingOlder = false;
    let exhausted = false;

    // Mirror wall-fluid.js sort: ['is_pinned', <rankField>, 'id'] descending.
    function compare(a, b) {
      return ((b.is_pinned ? 1 : 0)        - (a.is_pinned ? 1 : 0))
          || ((Number(b[rankField]) || 0)  - (Number(a[rankField]) || 0))
          || ((Number(b.id)         || 0)  - (Number(a.id)         || 0));
    }

    function notifyChange() {
      // Coalesce bursts (e.g. an `old checkins` page of 100 posts) into one
      // change notification per microtask.
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        lastSorted = [...checkins.values()].sort(compare);
        for (const fn of listeners.change) fn(lastSorted);
      });
    }

    // Returns the number of entries that weren't already in the map (i.e.
    // genuinely new posts as opposed to updates). The `old checkins`
    // handler uses this to detect "broadcaster has nothing more for us"
    // without a second pass over the array.
    function upsert(arr) {
      if (!Array.isArray(arr) || !arr.length) return 0;
      let added = 0, touched = false;
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

    function remove(ids) {
      if (!Array.isArray(ids)) ids = [ids];
      let changed = false;
      for (const id of ids) {
        if (id == null) continue;
        if (checkins.delete(String(id))) changed = true;
      }
      if (changed) notifyChange();
    }

    function start() {
      if (sock) return sock;
      if (typeof window.io !== 'function') {
        throw new Error('wall-client: window.io missing — load socketio.js first');
      }
      const qs = new URLSearchParams({
        wallId:        String(opts.wallId),
        client:        'wallsio-frontend',
        frontendToken: opts.frontendToken || '',
        initialCheckins: '',
        network,
      });
      sock = window.io(`${nodeUrl}?${qs}`, {
        transports:           ['websocket'],
        forceNew:             true,
        reconnectionDelay:    100,
        reconnectionDelayMax: 30000,
        timeout:              10000,
        withCredentials:      true,
      });
      // wall-fluid.js falls back to long-polling on error; do the same.
      sock.on('connect_error', () => {
        sock.io.opts.transports = ['polling', 'websocket'];
        sock.io.opts.timeout    = 20000;
      });

      sock.on('new checkins',         upsert);
      sock.on('old checkins',         (arr) => {
        // If a page added zero genuinely-new posts, the broadcaster has run
        // out of older history (some walls keep replying with the current
        // snapshot instead of firing `no more old checkins`); treat that as
        // exhaustion. `upsert` returns the new-key count in one pass.
        const added = upsert(arr);
        loadingOlder = false;
        if (added === 0) exhausted = true;
        for (const fn of listeners['older-loaded']) fn({ exhausted, added });
      });
      sock.on('looped post',          (c) => upsert([c]));
      sock.on('update checkin data',  (c) => upsert([c]));
      sock.on('removed checkins',     remove);
      sock.on('no more old checkins', () => {
        loadingOlder = false;
        exhausted = true;
        for (const fn of listeners['older-loaded']) fn({ exhausted: true });
      });
      sock.on('wallping',             () => {});
      sock.on('reload wall', () => {
        if (listeners.reload.length === 0) location.reload();
        else for (const fn of listeners.reload) fn();
      });
      return sock;
    }

    function stop() {
      if (sock) { sock.close(); sock = null; }
      loadingOlder = false;
      exhausted    = false;
    }

    // Request the next page of older posts from the broadcaster. The cursor
    // ("lowestCheckin") is the tail of the current sorted feed; the server
    // returns posts that sort strictly below it under the same `sortings`
    // order. Payload shape mirrors wall-fluid.js: cursor fields live under
    // `lowestCheckin`, not at the top level. A typical page is 30; the
    // server may cap or extend this. Safe to call repeatedly — the
    // in-flight guard suppresses duplicate emits, and `exhausted` shuts the
    // method off once `no more old checkins` has fired (or the page came
    // back empty — see the `old checkins` handler below).
    function loadOlder(count = 30) {
      if (!sock || loadingOlder || exhausted) return false;
      // Match wall-fluid.js: exclude sponsored when picking the cursor tail
      // so paid placements never become the pagination anchor.
      const tail = lastSorted.filter(p => p.type !== 'sponsored').at(-1);
      if (!tail) return false;
      const payload = { count, network };
      payload.lowestCheckin = {
        sortings:    ['is_pinned', rankField, 'id'],
        is_pinned:   tail.is_pinned,
        [rankField]: tail[rankField],
        id:          parseInt(tail.id, 10) || 0,
      };
      loadingOlder = true;
      sock.emit('request older checkins', payload);
      return true;
    }

    function on(event, fn) {
      if (!listeners[event]) throw new Error(`unknown event: ${event}`);
      listeners[event].push(fn);
      // If we already have data, deliver it synchronously so layouts that
      // subscribe after start() don't miss the current snapshot.
      if (event === 'change' && lastSorted.length) fn(lastSorted);
      return () => {
        const i = listeners[event].indexOf(fn);
        if (i >= 0) listeners[event].splice(i, 1);
      };
    }

    return {
      start, stop, on, loadOlder,
      imageUrl, relativeTime, truncateComment, parseCta, safeUrl,
      get socket()        { return sock; },
      get posts()         { return lastSorted; },
      get canLoadOlder()  { return !!sock && !loadingOlder && !exhausted; },
      get isExhausted()   { return exhausted; },
    };
  }

  // Also expose the formatter and truncation helpers as statics so layouts
  // can call them before a client exists (or in stand-alone utilities).
  createWallClient.relativeTime    = relativeTime;
  createWallClient.truncateComment = truncateComment;
  createWallClient.parseCta        = parseCta;
  createWallClient.safeUrl         = safeUrl;

  window.createWallClient = createWallClient;
})();
