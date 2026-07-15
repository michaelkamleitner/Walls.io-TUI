# Customizing the layout

This project is a template for building custom front-ends on top of a
walls.io social wall. The repo cleanly separates **data** (sockets, sorting,
de-duping, hide/show events) from **view** (HTML structure + CSS + render
code), so a layout can be redesigned end-to-end by editing three files.

## Files

| File              | Edit?           | Purpose                                                                                              |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `index.html`      | **Yes** (carefully) | Page skeleton + script tags. Change the DOM root, fonts, meta tags, viewport, etc.               |
| `styles.css`      | **Yes**         | All styling for the current layout. Replace freely.                                                  |
| `layout.js`       | **Yes**         | View layer — turns the sorted `Post[]` from the client into DOM. This is the main file to rewrite.   |
| `wall-client.js`  | **No**          | Data layer. Owns the socket, sort, dedupe, hide/show, image-CDN URLs. Touch only to extend the API.  |
| (socket.io)       | **No**          | Loaded from `https://cdn.socket.io/4.7.5/socket.io.min.js` via `<script>` in `index.html`. Don't pin a different version unless you have a reason. |
| (masonry-layout)  | **No**          | MIT, [masonry.desandro.com](https://masonry.desandro.com). Loaded from `unpkg.com/masonry-layout@4.2.2`. The default multi-column layout depends on it — see *Multi-column layouts (masonry)*. |
| (imagesLoaded)    | **No**          | MIT, paired with masonry. Loaded from `unpkg.com/imagesloaded@5.0.0`. Triggers a re-layout once each `<img>` has known dimensions. |
| `CUSTOMIZE.md`    | **No** (this file) | The instructions you are reading.                                                                |

> **Rule of thumb:** if your change is about *what the wall shows*, edit
> `layout.js` / `styles.css` / `index.html`. If it's about *what data the
> wall has*, the answer is almost certainly already in `wall-client.js` —
> read it before extending it.

## Keep `index.html`, `styles.css`, and `layout.js` in sync (required)

`index.html`, `styles.css`, and `layout.js` form a tight contract — any
change to one **must** be matched in the others, in the same edit session.
This is the single biggest source of broken layouts.

The contract:

1. **Every DOM id / class `layout.js` references must exist in `index.html`.**
   If you change the layout from a masonry grid (`#feed`, `.grid-sizer`,
   `.grid-item`) to a slideshow (`#stage`, `#slide`, `#post-counter`),
   you have to rewrite `layout.js` to query the new ids — never leave the
   old `document.getElementById('feed')` calls behind.

2. **Every library `layout.js` uses must have a matching `<script>` tag in `index.html`.**
   - Using `Masonry`/`imagesLoaded`? Both unpkg `<script>` tags must be
     present. If you remove either tag, you must also remove every
     `new Masonry(...)`, `masonry.layout()`, `masonry.reloadItems()`,
     and `imagesLoaded(...)` call from `layout.js`. The most common
     version of this bug is building a **slideshow / kiosk** from the
     masonry-grid default and leaving the masonry `<script>` tags — or a
     leftover `new Masonry(…)` call — behind; see *Slideshow / kiosk
     layouts*.
   - Conversely, never reference a library that isn't loaded — the page
     will throw `ReferenceError: <Lib> is not defined` on load and the
     wall never renders. The `socket.io` and `wall-client.js` tags are
     mandatory; everything else is opt-in based on what your layout uses.

3. **Every CSS class `layout.js` writes must be styled in `styles.css`** (or
   intentionally unstyled). New card markup with no matching CSS rules
   produces an unstyled blob.

4. **Before finishing your turn, mentally trace the page load:**
   - `index.html` parses → which `<script>` tags load? → which globals
     does that expose?
   - `layout.js` runs → which `document.getElementById` / `querySelector`
     calls does it make? → do those nodes exist in the new HTML?
   - If any answer is "no" or "throws", finish the rewrite before
     handing back to the user.

When you swap layout types (grid ↔ slideshow ↔ list ↔ ticker ↔ kiosk),
treat it as **rewriting all three files together**, not editing one.

## Responsive design (required)

**Every layout must work flawlessly from a 320 px-wide phone up to a
2560 px-wide TV / desktop wall display.** A walls.io wall is just as
likely to be embedded on a mobile site, projected at an event, or shown in
a kiosk as it is to be opened on a laptop. There is no "desktop-only"
escape hatch.

Hard requirements:

1. **Viewport meta tag.** `index.html` ships with
   `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
   Don't remove it. Don't add `maximum-scale=1` or `user-scalable=no` —
   pinch-to-zoom must remain available for accessibility.
2. **No horizontal scrolling at any width ≥ 320 px.** Test with the
   narrowest mobile breakpoint. If you see a sideways scrollbar, you've
   shipped a bug.
3. **Fluid widths, not fixed.** Use `max-width` + `width: 100%`,
   `min()` / `max()` / `clamp()`, percentages, `vw`/`vh` (sparingly), CSS
   grid `auto-fill` / `auto-fit`, or flexbox wrap. Avoid hard-coded
   `width: 600px` style declarations on anything that holds content.
4. **Images respect their container.** Use `width: 100%; height: auto;`
   (or the equivalent `max-width: 100%`). Pair it with `client.imageUrl`
   sized for the largest reasonable rendered width — `{ w: 600 }` for a
   single-column phone feed, `{ w: 1200 }` for a desktop hero, etc.
5. **Typography.** Body text **at least 16 px** on mobile (smaller is
   penalized by mobile browsers and is unreadable in a kiosk). Use
   `clamp()` to scale headings up on large viewports rather than two
   separate font sizes.
6. **Tap targets.** Anything clickable (links, buttons, the timestamp
   anchor) must be **at least 44 × 44 CSS pixels** in its hit box on
   touch devices, per WCAG 2.5.5. Use `padding`, not just `font-size`,
   to hit that.
7. **Safe-area insets.** Phones with notches / home indicators expose
   `env(safe-area-inset-*)`. The default layout uses
   `padding: max(env(safe-area-inset-…), 16px)` on `<body>`. Preserve an
   equivalent.
8. **Responsive grids: prefer CSS over JS.** `grid-template-columns:
   repeat(auto-fill, minmax(280px, 1fr))` gives you a wall that reflows
   from 1 column on a phone to 6 on a TV without media queries or
   `ResizeObserver`.
9. **Test breakpoints.** Before declaring done, sanity-check the layout
   at 320 px, 414 px, 768 px, 1024 px, 1440 px, and 1920 px. The DOM and
   CSS should produce a usable result at every size with no clipped
   content, no overlapping text, no overflowing images.
10. **Don't break the timestamp link.** It's a primary tap target and
    must keep a 44 px hit area on touch.

Soft preferences:

- Use `prefers-reduced-motion: reduce` to disable any animation /
  ticker / autoscroll for users who opt out.
- Lazy-load images below the fold: `<img loading="lazy" decoding="async">`.
- Provide a `srcset` with two or three `client.imageUrl(post, { w: … })`
  variants if the layout has wildly different image sizes per breakpoint.

If a layout choice forces breaking any of these requirements, pick a
different layout choice. There is no exception.

### Long unbreakable strings (required)

Social posts routinely contain long tokens with no whitespace: crypto
wallet addresses (`DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump`), bare
URLs, run-on hashtags, transaction hashes. By default the browser
refuses to break inside these and they push the card wider than its
column, breaking the masonry grid and producing horizontal scroll on
mobile.

The fix is one CSS rule on whatever element holds post text (and ideally
the card too, as a safety net):

```css
.grid-item, .comment {
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

`overflow-wrap: anywhere` is the modern, correct property — it only
breaks long tokens when needed to prevent overflow, and (unlike
`word-break: break-all`) leaves normal prose wrapping alone. The
`word-break: break-word` line is a fallback for older Safari.

Don't solve this by hiding overflow (`overflow: hidden` or `text-overflow:
ellipsis`) — it silently truncates real content and the user can't tell.

## The minimal layout

`index.html` only needs:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>My Wall</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="root"></div>

  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"
          integrity="sha384-2huaZvOR9iDzHqslqwpR87isEmrfxqyWOF7hr7BY6KG0+hVKLoEXMPUJw3ynWuhO"
          crossorigin="anonymous"></script>
  <!-- masonry + imagesLoaded are only required for multi-column
       layouts; drop them for a single-column list. -->
  <script src="https://unpkg.com/masonry-layout@4.2.2/dist/masonry.pkgd.min.js"></script>
  <script src="https://unpkg.com/imagesloaded@5.0.0/imagesloaded.pkgd.min.js"></script>
  <script src="wall-client.js"></script>
  <script src="layout.js"></script>
</body>
</html>
```

The script-tag order is **load-bearing**: socket.io → wall-client → layout.
The viewport meta tag is **mandatory** — see *Responsive design (required)*.

## The data API (read-only contract)

`wall-client.js` exposes one global, `createWallClient(opts)`. It returns a
client object with this surface:

```js
const client = createWallClient({
  wallId:    139355,            // required — the walls.io wall id
  rankField: 'weight',          // optional — sort field, default 'weight'
  nodeUrl:   '…',               // optional — broadcaster URL override
  network:   'twitter',         // optional — restrict to one network
  frontendToken: '…',           // optional — for non-public walls
});

client.start();                 // open the socket
client.stop();                  // close it

client.on('change', (posts) => { … });   // sorted Post[], pinned-first
client.on('reload', () => { … });        // server asked us to reload
client.on('older-loaded', ({ exhausted, added }) => { … })  // see Infinite scroll

client.posts           // last sorted snapshot (Post[])
client.socket          // raw socket.io instance, for advanced cases
client.loadOlder(count)      // request next page of older posts (see Infinite scroll)
client.canLoadOlder          // true while more pages may be available
client.isExhausted           // true once broadcaster has no more older posts
client.imageUrl(post, { w, h, q, field })   // CDN image URL helper
client.relativeTime(iso)                    // 'Just now' / '5 minutes ago' / …
client.truncateComment(html, postLink, { maxChars, moreLabel })  // ~280-char trim with "more"
client.parseCta(post)                       // → { label, link } | null  (see Call-to-action buttons)
client.safeUrl(url)                         // protocol-checked href value (see below)
```

Things the client already does so a layout doesn't have to:

- Connects via Socket.IO with the right query string and falls back to
  long-polling on `connect_error`, exactly like wall-fluid.js.
- Listens for **all** lifecycle events: `new checkins`, `old checkins`,
  `update checkin data`, `removed checkins` (admin hide/delete),
  `looped post`, `reload wall`.
- De-dupes by `id` across `new checkins` and `old checkins`.
- Sorts pinned-first, then by `rankField` desc, then by `id` desc — the
  same ordering the live wall uses with `rankingMode: "weight"`.
- Coalesces bursts (e.g. a 100-post `old checkins` batch) into a single
  `change` callback per microtask, so a full re-render is cheap.
- Delivers the current snapshot synchronously to any `change` listener
  added after `start()`, so late-mounted layouts don't miss data.

**Don't reimplement any of that in `layout.js`.** Subscribe to `change`
and re-render from `posts`.

## The `Post` shape

Every entry in the array passed to `change` is a checkin straight from the
broadcaster. The fields a layout normally uses:

| Field                                    | Notes                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `id`                                     | Stable string id. Use it as DOM key (`dataset.id`).                                  |
| `type`                                   | Network: `twitter`, `linkedin`, `instagram`, `facebook`, `tiktok`, `direct_post`, …  |
| `sub_type`                               | Sub-channel, often `null`. Used for image-CDN routing (e.g. `photo_booth_image`).    |
| `is_pinned`                              | `1` for pinned posts. Already affects sort; use it for visual emphasis if desired.   |
| `external_fullname` / `external_name`    | Author display name. Prefer `external_fullname`, fall back to `external_name`.       |
| `external_image` / `external_image_unique_id` | Author avatar. Use `client.imageUrl(post, { field: 'external_image', w: 80 })`. |
| `external_user_link`                     | Link to the author's profile.                                                        |
| `external_created`                       | ISO string. Source-of-truth timestamp.                                               |
| `external_created_timestamp`             | Same time as a unix integer; useful for sort keys.                                   |
| `comment`                                | Plain text **with HTML entities** already encoded (e.g. `What&#39;s`).               |
| `html_comment`                           | Server-pre-rendered HTML (entities + hashtag/mention links). **Use this for display, via `innerHTML`.** Don't run it through your own escape function. |
| `post_image` / `post_image_unique_id`    | Post image. Use `client.imageUrl(post, { w: 600 })`.                                 |
| `post_image_alt_text`                    | Descriptive alt text for the post image (often AI-generated). **Always pass to `alt=`** — see *Image alt text*. |
| `post_image_width` / `post_image_height` | Natural dimensions; useful for masonry grids and aspect-ratio padding.               |
| `post_video` / `post_video_width` / `post_video_height` / `transformed_videos` | Video assets when `is_video`.                          |
| `is_video`                               | Truthy if the post has a video.                                                      |
| `post_link`                              | URL of the original post on the source network. **Always `target="_blank"` + `rel="noopener"`.** |
| `weight`                                 | Server-assigned ranking score. Don't display.                                        |
| `language`, `latitude`, `longitude`, `location`, `tags`, `entities`, `cta`, `wallsio_likes` | Available; usually situational.       |

## Images — always use `client.imageUrl`

The raw `post.post_image` URL points at `cdn.walls.io`, which is locked to
walls.io referers and **will not load** from your origin. There's a
per-network resizable CDN (`img-li-cdn.walls.io` for LinkedIn, `img-tw-cdn`
for Twitter, etc.), and `client.imageUrl` builds the right URL with the
right resize params:

```js
client.imageUrl(post)                              // default size
client.imageUrl(post, { w: 600 })                  // post image
client.imageUrl(post, { field: 'external_image', w: 80, h: 80 })  // avatar
client.imageUrl(post, { w: 1200, q: 90, webp: 0 })
```

Falls back to the raw field URL when no `*_unique_id` is present (rare —
some sources don't go through the proxy).

### Image alt text (required)

Every `<img>` must carry an `alt` attribute — empty for decorative images,
descriptive for content images. Walls.io provides real alt text for post
images on `post.post_image_alt_text` (often AI-generated, usually a 1–3
sentence description of what's in the photo). Use it directly.

```js
`<img class="checkin-image"
      loading="lazy"
      decoding="async"
      alt="${escapeHtml(post.post_image_alt_text || '')}"
      src="${escapeHtml(client.imageUrl(post, { w: 600 }))}">`
```

Rules:

1. **Post images: pass `post.post_image_alt_text` through `escapeHtml` into
   `alt=`.** When empty, the attribute is still present with an empty
   value — that's the WCAG-correct way to mark an image as having no
   meaningful alternative (rather than omitting `alt` entirely, which
   screen readers will announce as the file name).
2. **Avatars: `alt=""` (decorative).** The author's name is shown right
   next to the avatar, so the photo carries no additional information.
   Put the name in the wrapping link's `aria-label` instead (the default
   layout does this on `.avatar-link`).
3. **Emoji `<img>` in `html_comment`: handled by the server.** Twemoji
   image tags already carry an `alt` of the literal emoji character; you
   don't need to do anything.
4. **Video posters / sponsored images** (if your layout renders them):
   apply the same rule — use any descriptive field the broadcaster
   exposes, fall back to empty `alt=""`. Never omit the attribute.
5. **Don't use the post comment as alt text.** It describes what was
   said, not what's in the picture. `post_image_alt_text` is the right
   field; if it's missing, an empty `alt=""` is more honest than a
   redundant caption.

## Comments — use `html_comment` as `innerHTML`

The comment text comes pre-encoded. Concretely:

```js
// ✅ correct
li.querySelector('.comment').innerHTML = post.html_comment || post.comment || '';

// ❌ wrong — double-encodes existing entities ("What&#39;s" shows literally)
li.querySelector('.comment').textContent = post.html_comment;
li.querySelector('.comment').innerHTML   = escapeHtml(post.comment);
```

If you build the post element with a template-string `innerHTML =` (as the
default layout does), interpolate `post.html_comment` raw — do **not** wrap
it in your `escapeHtml()`.

`html_comment` includes `<img>` tags for emoji (Twemoji 72×72 PNGs). If
you don't constrain them in CSS they render at 72 px. The default layout
has:

```css
.comment img { height: 1em; width: 1em; vertical-align: -0.15em; }
```

Keep an equivalent rule in any layout that displays comments.

### Link colours inside post text (required)

`html_comment` contains `<a>` tags for hashtags, @mentions, and bare
URLs. **When you customise the layout's colour palette, style these
links to match the surrounding body text — not as bright blue browser
defaults.** A wall card is a glanceable quote of someone's post; if half
the words are saturated blue links, the prose becomes unreadable.

Rules:

1. **Base colour: `color: inherit`** (or the body text colour). The link
   should read like prose at a glance.
2. **Use the underline as the affordance.** A subtle low-contrast
   underline (e.g. `text-decoration-color: rgba(0,0,0,0.25)`) signals
   "clickable" without shouting.
3. **Add a hover state.** On hover, raise the underline contrast to
   `currentColor` (or change the text colour) so users get clear
   feedback that the link is live.
4. **The "more" link follows the same rule.** It's bolder
   (`font-weight: 600`) but the same colour family — don't paint it a
   contrasting accent.

For example:

```css
.comment a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: rgba(0, 0, 0, 0.25);
  text-underline-offset: 2px;
}
.comment a:hover { text-decoration-color: currentColor; }
```

Pick equivalent values that fit your palette, but don't drop back to a
default browser blue.

## Post text length (required)

A wall is a glanceable feed, not a blog. Long LinkedIn essays and Twitter
threads must be trimmed in the layout so the reader can scan many posts
quickly.

Rules:

1. **Soft cap at ~280 characters of plain text.** That's enough for any
   tweet plus a generous LinkedIn opener. Don't show more by default.
2. **Use the shared helper** rather than writing your own truncation:

   ```js
   const html = client.truncateComment(
     post.html_comment || post.comment,
     post.post_link
   );
   // or, for stand-alone helpers / before a client exists:
   //   createWallClient.truncateComment(html, postLink, opts)
   ```

3. **Never cut mid-word.** The helper rewinds to the last whitespace
   inside the budget so you don't get `"…opportuni"`.
4. **Never cut mid-link or mid-emoji.** The helper treats `<a>` and
   `<img>` (Twemoji) as atomic — either the whole link/emoji is in, or
   it's dropped. Critically: a URL is never displayed broken.
5. **Always append a "more" link to the original post.** The helper does
   this for you when you pass `post.post_link`. The link must be
   `target="_blank"` + `rel="noopener"` (the helper sets both). If a
   post happens to have no `post_link`, the trim still happens but no
   "more" link is appended (that's fine — these are rare).
6. **Style the "more" link as visibly clickable.** The default layout
   uses:

   ```css
   .comment .more { color: #1a73e8; font-weight: 600; white-space: nowrap; }
   ```

   Pick something that fits the rest of your typography but keeps the
   link clearly distinct from the surrounding text.
7. **Only override `maxChars` for a deliberate reason.** If you build,
   say, a TV-wall layout with huge text, drop the cap to 160; for a
   reading view raise it to 400. Don't disable truncation — there is no
   "show full text" mode for the wall.

The helper accepts an `opts` object: `{ maxChars: 280, moreLabel: 'more' }`.
Both are optional.

## Author identity (required)

Every post must visibly attribute its author. A wall without names and
faces reads like an anonymous text dump and loses the social-proof value
of showing real people. The rules:

1. **Show the author's display name.** Use `post.external_fullname`, fall
   back to `post.external_name` if missing. Don't display `external_id`
   or any internal handle.
2. **Show the author's profile image.** Build the URL with
   `client.imageUrl(post, { field: 'external_image', w: 80, h: 80 })` —
   never use `post.external_image` directly (same CDN-referer issue as
   post images). Render it at a size that makes sense for the layout
   (typically 32–48 px on mobile, up to ~64 px in a kiosk view).
3. **Provide a placeholder when there's no avatar.** Some networks /
   direct posts have no `external_image`. Render a neutral circle with
   the first letter of the author's name (or a generic glyph) so the
   layout doesn't shift between cards.
4. **Constrain the avatar.** `border-radius: 50%`, `object-fit: cover`,
   fixed `width`/`height` — otherwise oddly-shaped source images break
   the row.
5. **Link name + avatar to the author's profile** when
   `post.external_user_link` is present. Use `target="_blank"` +
   `rel="noopener"`, and keep a 44 × 44 px tap target on touch (per the
   responsive rules).
6. **Don't show the author twice.** If your card has a header band with
   the avatar + name, don't repeat the name in the body. One mention per
   post.

## Call-to-action buttons (required when present)

The wall admin can attach a CTA to any post — a label + link pair that
turns into a tappable button on the card (e.g. `DOWNLOAD`, `RSVP`,
`SHOP NOW`). The broadcaster delivers it on `post.cta` as a **JSON
string** (not an already-parsed object — easy to miss):

```js
post.cta // → '{"text":"DOWNLOAD","url":"https://example.com/app"}'
```

`JSON.parse` it before reading fields, and wrap the parse in `try /
catch` — a malformed value should render nothing, not throw and break
the whole card. The keys are `text` and `url`; some walls also use
`label` / `link`, so accept either. When `post.cta` is missing,
unparseable, or has empty fields, render nothing — the field is
opt-in per post.

Rules:

1. **Render the button only when both label and link are present.** A
   half-configured CTA (label without link, or vice versa) should be
   silently dropped, not rendered as a broken control.
2. **Place the button at the bottom of the card,** after the comment
   and the post image. It's the primary action; don't bury it.
3. **Style it as a clearly tappable button**, not a plain text link —
   filled background, generous padding, rounded pill or rectangle.
4. **Honour the 44 × 44 px tap-target rule** from *Responsive design
   (required)*. CTAs are the primary touch action on the card.
5. **Open in a new tab.** `target="_blank"` + `rel="noopener"`, same as
   every other outbound link on the wall.
6. **Escape both fields** when interpolating into HTML — the label is
   author-controlled plain text and the link is a URL string. The CTA
   label is **not** HTML; don't run it through anything that expects
   pre-encoded entities (unlike `html_comment`).
7. **Don't truncate the label.** CTAs are short by design; if a label
   is too wide for the column, let it wrap rather than cutting it.

Use the shared parser instead of rolling your own — it handles the JSON
string form, both key conventions, the `_` → space label cleanup, and
runs the link through `safeUrl` to block `javascript:` / `data:` href
attacks. Returns `null` when there's nothing renderable.

```js
function renderCta(post) {
  const cta = client.parseCta(post);   // or createWallClient.parseCta(post)
  if (!cta) return '';
  return `<a class="cta-button" href="${escapeHtml(cta.link)}" target="_blank" rel="noopener">${escapeHtml(cta.label)}</a>`;
}
```

### URL safety — always pass author-controlled URLs through `client.safeUrl`

Walls.io posts carry several URL fields (`post_link`, `external_user_link`,
the CTA link, etc.). Plain HTML-escaping is **not enough**: a value like
`javascript:alert(1)` survives `escapeHtml` unchanged and runs when the
user clicks the link. The client exposes `client.safeUrl(value)` which
returns the original string when its scheme is `http:` / `https:` /
`mailto:` (or no scheme — a relative URL), and `''` for anything else.

```js
const userLink = client.safeUrl(post.external_user_link);
if (userLink) { /* render as <a href> */ }
```

`client.parseCta` already uses this internally; you only need to call
`safeUrl` yourself for `href` attributes you build directly.

## Timestamps (required)

Every layout displays timestamps the same way. The rules:

1. **Use the shared formatter.** `wall-client.js` exports
   `client.relativeTime(iso)` (also reachable as
   `createWallClient.relativeTime(iso)` before a client exists). **Do not
   write your own.** Different layouts using different breakpoints would
   make the project feel inconsistent.

   ```js
   client.relativeTime(post.external_created)
   // → 'Just now' | '5 minutes ago' | '2 hours ago' | '3 days ago' | '23 Mar 2026'
   ```

   Breakpoints (frozen — don't tune them per layout):

   | Age          | Output             |
   | ------------ | ------------------ |
   | < 45 s       | `Just now`         |
   | < 1 h        | `5 minutes ago`    |
   | < 1 d        | `2 hours ago`      |
   | < 1 w        | `3 days ago`       |
   | ≥ 1 w        | locale date, e.g. `23 Mar 2026` |

   The formatter respects the user's locale via `Intl.RelativeTimeFormat`.

2. **Always link the timestamp to the original post.** `post.post_link`
   is the URL of the post on its source network (LinkedIn / Instagram /
   Twitter / …). Wrap the timestamp in an `<a>`:

   ```html
   <a class="timestamp"
      href="${escapeHtml(post.post_link)}"
      target="_blank"
      rel="noopener"
      data-iso="${isoString}"
      title="${absoluteLocaleDateTime}">
     ${client.relativeTime(post.external_created)}
   </a>
   ```

   - `target="_blank"` is required — clicking the timestamp must never
     navigate away from the wall.
   - `rel="noopener"` is required for security.
   - `title` should be the absolute locale date+time so hovering reveals
     the full timestamp.
   - The `<a>` must satisfy the 44 × 44 px tap target rule from
     *Responsive design (required)*.
   - If a particular post happens to have no `post_link` (rare; some
     direct-post types), fall back to a `<span class="timestamp">` with
     the same `title`/`data-iso`, no link.

3. **Keep relative times fresh.** Set an interval (~30 s is plenty) that
   rewrites every visible timestamp:

   ```js
   setInterval(() => {
     for (const el of document.querySelectorAll('.timestamp[data-iso]')) {
       el.textContent = client.relativeTime(el.dataset.iso);
     }
   }, 30_000);
   ```

   Storing the ISO on `data-iso` means the ticker doesn't need to know
   about your DOM structure. If you use a different class name than
   `.timestamp`, update the selector but keep the pattern.

4. **Don't display two competing timestamps.** Either show the relative
   string with the absolute one in `title`, or show the absolute one
   directly — never both side-by-side as plain text.

## Wall id and the `?id=` override

The wall to render is configured at the top of `layout.js`:

```js
const DEFAULT_WALL_ID = 186670;
const wallId = Number(new URLSearchParams(location.search).get('id'))
            || DEFAULT_WALL_ID;
```

- `DEFAULT_WALL_ID` is what the page shows when opened with no query string.
  Change this to whatever wall the layout primarily targets.
- `?id=<wallId>` in the URL overrides the default at load time, e.g.
  `index.html?id=139355`. This is intended for previewing other walls
  without editing the file (handy when an AI is iterating on a layout
  against a couple of test walls).
- Any non-numeric or missing value falls back to the default — `Number(null)`
  is `NaN`, and `NaN || DEFAULT_WALL_ID` evaluates to the default.

**Keep this mechanism intact** when rewriting `layout.js`. Always read
`?id=` first and only fall back to the hard-coded default. Don't read
`wallId` from anywhere else (no `data-*` attributes, no globals); the URL
is the single override surface.

If you need other URL-driven config (e.g. `?network=twitter`, `?layout=compact`),
add it next to the `id` lookup and document it here.

## Multi-column layouts (masonry)

Walls.io posts have wildly varying heights — a one-line tweet next to a
LinkedIn paragraph next to a portrait photo. A naïve CSS grid leaves big
empty gaps under the short cards; CSS `column-count` keeps reading order
weird (top-to-bottom-then-next-column) and breaks if a card needs to be
re-positioned. **For any layout with more than one column, use a masonry
library.** It packs cards bottom-up like bricks so there are no gaps and
the visual order matches the data order (left-to-right, then down).

The template ships with **[masonry-layout](https://masonry.desandro.com)**
(MIT, by David DeSandro) and its companion **imagesLoaded** (MIT) loaded
from unpkg. Both are vanilla JS, dependency-free, ~25 KB combined. Don't
swap them for jQuery Isotope (commercial license for commercial use),
Packery (same), or hand-rolled column logic.

The integration pattern used in `layout.js`:

```js
const masonry = new Masonry($feed, {
  itemSelector:    '.grid-item',
  columnWidth:     '.grid-sizer',  // CSS-driven column width
  gutter:          16,
  percentPosition: true,
  transitionDuration: 0,
  initLayout:      false,
});

function render(posts) {
  // Re-render DOM, keeping the .grid-sizer element …
  masonry.reloadItems();
  masonry.layout();
  // … then re-layout once images have known dimensions.
  imagesLoaded($feed).on('progress', () => masonry.layout());
}
```

Why this shape:

1. **Column count is CSS, not JS.** `.grid-sizer` is an empty element
   whose width is set by media queries (`width: 100%` → `1/2` → `1/3`
   → `1/4` → `1/5`). Masonry reads its width on every `layout()`, so
   resizing the viewport reflows automatically — no `ResizeObserver`,
   no JS breakpoints to maintain.
2. **`imagesLoaded` on every render.** Without it, masonry positions
   cards using their initial (zero-height) `<img>` boxes and they
   overlap once images decode. The `progress` callback fires per image,
   so tall photos snap into place as they arrive instead of the whole
   grid jumping once at the end.
3. **One long-lived instance.** `reloadItems()` + `layout()` is cheaper
   than tearing down and recreating Masonry on every `change`.
4. **`transitionDuration: 0`.** A walls.io feed updates frequently;
   animated reflow on every `new checkins` event looks chaotic.

### Column width math (required)

The `.grid-sizer` width must match what Masonry actually places, or you
get a leftover gap on the right (or cards that overflow the container).
The formula is:

```
column-width = (100% − (columns − 1) × gutter) / columns
```

**N columns have N−1 gutters between them, not N.** This is the single
most common masonry bug. For `gutter: 16` in the Masonry options:

```css
/* 2 cols */ .grid-sizer { width: calc((100% -  1 * 16px) / 2); }
/* 3 cols */ .grid-sizer { width: calc((100% -  2 * 16px) / 3); }
/* 4 cols */ .grid-sizer { width: calc((100% -  3 * 16px) / 4); }
/* 5 cols */ .grid-sizer { width: calc((100% -  4 * 16px) / 5); }
```

The gutter value in CSS **must equal** the `gutter:` option passed to
`new Masonry(...)`. If you change one, change both — mismatches are the
other common source of "why is there a gap / overflow" bugs.

Sanity check before shipping: open the layout at a width where each
breakpoint kicks in, and confirm the rightmost card's right edge lines
up flush with the feed container.

If you write a single-column layout, you don't need masonry — strip the
two `<script>` tags from `index.html` and use a plain `<ul>` like the
old default did. But the moment you go to two or more columns, wire it
back in. There is no good reason to reinvent bin-packing in 2026.

## Slideshow / kiosk layouts

### Remove all masonry / imagesLoaded code (required)

A slideshow shows **one post at a time** — there are no columns to pack,
so masonry has no job to do. The default template is a masonry grid and
wires masonry up **eagerly at the top of `layout.js`**
(`const masonry = new Masonry($feed, …)`), with the masonry + imagesLoaded
`<script>` tags loaded ahead of `layout.js` in `index.html`. If you adapt
that template into a slideshow without ripping masonry out, you get a JS
error on load and the wall never renders. The two ways it bites:

- **Script tags kept, container renamed** (`#feed` → `#stage`):
  `document.getElementById('feed')` returns `null`, so `new Masonry(null, …)`
  throws *inside `masonry.pkgd.min.js`* — that's the "masonry.js error" you
  keep hitting.
- **Script tags dropped, a call left behind:** any leftover `new Masonry(…)`,
  `masonry.layout()`, `masonry.reloadItems()`, or `imagesLoaded(…)` throws
  `ReferenceError: Masonry is not defined` (or `imagesLoaded is not defined`).

So for any slideshow / kiosk layout, strip masonry **completely** — both
ends of the contract:

1. **`index.html`:** delete the two `<script>` tags — `masonry-layout@4.2.2`
   and `imagesloaded@5.0.0`. Keep only socket.io → wall-client → layout.
2. **`layout.js`:** delete the top-level `const masonry = new Masonry(…)`,
   the `relayoutOnImages()` helper and its `imagesLoaded(…)` call, every
   `masonry.reloadItems()` / `masonry.layout()` in `render()`, and the
   `window._masonry` debug line.
3. **Don't reintroduce grid markup or CSS** — no `.grid-sizer` /
   `.grid-item` scaffold. A slideshow positions its single slide directly.

A slideshow's `render()` just swaps the current slide's content; there is
nothing to re-pack. This is point 2 of *Keep `index.html`, `styles.css`,
and `layout.js` in sync* applied to the case people get wrong most often.

### Keyboard shortcuts (required)

If you build a slideshow / kiosk layout that shows one post at a time,
it **must** support these keyboard shortcuts for navigating posts:

| Key            | Action          |
| -------------- | --------------- |
| `Space`        | next post       |
| `ArrowRight`   | next post       |
| `ArrowLeft`    | previous post   |

Implementation notes:

1. **Listen on `window`**, not on a specific element — the user
   shouldn't have to focus the slide first.
2. **Use `event.key`** (`' '`, `'ArrowLeft'`, `'ArrowRight'`), not
   `keyCode` / `which` (deprecated).
3. **Call `event.preventDefault()`** for `Space` so the page doesn't
   scroll behind the slideshow.
4. **Ignore the event when a form field is focused** (`event.target`
   is an `<input>`, `<textarea>`, or `[contenteditable]`) so typing in
   a search/admin field doesn't skip slides.
5. **Wrap around** at both ends: pressing `ArrowLeft` on the first
   post jumps to the last; `Space` / `ArrowRight` on the last wraps
   to the first. The wall is a loop, not a finite deck.
6. **Pause the autoplay timer** (if any) on manual navigation and
   reset it so the user gets a full interval to read the post they
   just navigated to.

Sketch:

```js
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.matches('input, textarea, [contenteditable]'))) return;
  if (e.key === ' ' || e.key === 'ArrowRight') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
  }
});
```

## Infinite scroll (grid / feed layouts only)

Grid / masonry / list layouts should load older posts automatically as
the user scrolls toward the bottom of the feed. The default layout
does this with an IntersectionObserver-driven sentinel; slideshow and
single-post layouts must **not** wire this up (see *Slideshow / kiosk
layouts* — "older" is not a meaningful concept for a one-post-at-a-time
view).

### Client API

`wall-client.js` exposes pagination on the client object:

```js
client.loadOlder(count = 30)   // request the next page of older posts
client.canLoadOlder            // true while more pages may be available
client.isExhausted             // true once the broadcaster has no more
client.on('older-loaded', ({ exhausted, added }) => { … })
```

What's already taken care of:

1. **Cursor.** `loadOlder()` reads the tail of `client.posts` (ignoring
   sponsored items, same as wall-fluid.js) and emits
   `'request older checkins'` with the wall-fluid-compatible payload:

   ```js
   { count, network, lowestCheckin: { sortings, is_pinned, <rankField>, id } }
   ```

   The cursor lives **inside `lowestCheckin`** — top-level cursor
   fields are silently ignored by the broadcaster and you'll get the
   initial buffer back on every request. Easy to miss if you skim the
   protocol; this is the one bit worth re-checking against
   `wall-fluid.js` if pagination ever appears broken.
2. **In-flight guard.** A second `loadOlder()` while one is already
   pending returns `false` and emits nothing. No need to debounce in
   the layout.
3. **End-of-history.** When the broadcaster fires
   `'no more old checkins'`, `exhausted` flips to true permanently and
   `loadOlder()` becomes a no-op. **Some walls keep replying with the
   current snapshot instead of sending `no more old checkins`** — to
   handle that, the client also flips `exhausted` when an
   `'old checkins'` page contains zero posts that weren't already in
   the local map. Either way, `canLoadOlder` becomes the single
   "should we ask for more?" answer for the layout.
4. **Merging into the feed.** Older posts arrive via the existing
   `'old checkins'` upsert path, get sorted into the same array, and
   `change` fires — your incremental `render()` from
   *Re-render must be incremental* picks them up with no extra code.

### Layout pattern

Three pieces in `index.html` / `layout.js` / `styles.css`:

```html
<!-- index.html, immediately after the feed container -->
<div id="feed" class="grid"><div class="grid-sizer"></div></div>
<div id="feed-sentinel" aria-hidden="true"></div>
<div id="feed-status"   role="status" aria-live="polite"></div>
```

```js
// layout.js, after client.start()
const $sentinel = document.getElementById('feed-sentinel');
const $status   = document.getElementById('feed-status');
const setStatus = (text) => { $status.textContent = text; };

const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting || !client.canLoadOlder) continue;
    setStatus('Loading older posts…');
    client.loadOlder(30);
  }
}, { rootMargin: '600px 0px' });
io.observe($sentinel);

client.on('older-loaded', ({ exhausted }) => {
  if (exhausted) { setStatus('End of feed.'); io.disconnect(); }
  else           { setStatus(''); }
});
```

```css
#feed-sentinel { height: 1px; }
#feed-status   { text-align: center; color: #888; font-size: 13px; padding: 16px 0; min-height: 1.5em; }
```

Rules:

1. **Sentinel sits *outside* `#feed`,** not inside — masonry would
   otherwise try to position it as a grid item.
2. **`rootMargin: '600px 0px'`** triggers the fetch ~600 px before
   the sentinel is actually visible, so the next page is usually
   waiting by the time the user scrolls there. Tune up for very tall
   cards, down for tiny ones.
3. **Always read `canLoadOlder` before calling `loadOlder()`.** Don't
   track loading/exhausted state manually in the layout — the client
   is the source of truth.
4. **Disconnect the observer on exhaustion.** Otherwise it keeps
   firing intersection callbacks forever, even though the client now
   ignores them.
5. **Don't reset `exhausted` from the layout.** When the wall genuinely
   gets new live posts at the top, the user keeps scrolling down to
   the same exhausted tail — that's correct. A reload is what resets
   the feed.

### Slideshow / kiosk layouts

Do not call `loadOlder()` from these layouts. The 50–100 most recent
posts that the broadcaster initially streams is the right working set
for a rotating display; paginating into history would just produce
stale content on the screen. If you build a "scroll through everything
ever posted" archive view, that's a feed layout — wire up the sentinel
as above.

## Pinned posts

Pinned posts are sorted to the top by the client. Layouts decide *how* to
emphasize them. Pick something subtle — the live wall uses a pin icon.
The default layout does:

```css
ul#feed li.pinned::before { content: "📌"; margin-right: 6px; }
```

(The `pinned` class is set in `renderPost()` based on `post.is_pinned`.)

## Hide / show is automatic

When an admin hides or deletes a post on walls.io, the broadcaster sends a
`removed checkins` event with the id. The client drops it and fires
`change` with the new list. When a post is unhidden it comes back through
`new checkins`. Your render function only sees the current truth — no
hide/show logic in `layout.js`.

## Re-render must be incremental — never rebuild the feed (required)

The wall is a long-lived realtime stream. Every few seconds the broadcaster
fires a `change` event with a new sorted `Post[]`. **Your `render(posts)`
function must update the DOM in place** — diff the incoming list against
the existing card nodes (keyed by `data-id`) and only insert, move, or
remove what actually changed.

Do **not**:

- Call `$feed.replaceChildren(...)`, `$feed.innerHTML = ''`, `removeChild`-loops,
  or any other "wipe and rebuild" pattern. Even when fast, it causes a
  full visible flash on every update — images blank out, masonry re-lays
  out from zero, scroll position can jump. Users see this as the page
  "reloading" every 30–60 seconds.
- Call `location.reload()`, `window.location.href = ...`, set up
  polling timers that re-fetch the wall, or anything that re-mounts the
  layout. The socket connection is already pushing updates in real time;
  re-mounting only loses state.
- Recreate the masonry instance on each change. Reuse the long-lived
  one and call `masonry.reloadItems(); masonry.layout()` after diffing.

Correct pattern (sketch):

```js
const seen = new Map();          // data-id → element
function render(posts) {
  const wantedIds = new Set(posts.map(p => String(p.id)));

  // 1. remove cards that are gone
  for (const [id, el] of seen) {
    if (!wantedIds.has(id)) { el.remove(); seen.delete(id); }
  }

  // 2. insert new cards in the right slot, move existing ones if order changed
  let prev = $feed.querySelector('.grid-sizer'); // anchor; never remove
  for (const post of posts) {
    const id = String(post.id);
    let el = seen.get(id);
    if (!el) { el = renderPost(post); seen.set(id, el); }
    if (el.previousElementSibling !== prev) prev.after(el);
    prev = el;
  }

  masonry.reloadItems();
  masonry.layout();
  relayoutOnImages();
}
```

## Performance

- The `change` callback is microtask-coalesced, so a flood of
  `update checkin data` events doesn't cause render thrash.
- Avoid layout reads (`offsetHeight`, `getBoundingClientRect`) inside the
  render loop — batch them after the diff is applied.
- Don't recompute static text on every render. If a card's content hasn't
  changed (same `data-id`, same `external_created`), leave it alone.

## Things you should NOT do

- **Don't** open a second socket. Use the one `wall-client.js` already
  manages, or call `client.start()` again (it's idempotent).
- **Don't** reach into `cdn.walls.io` for images — it'll silently fail.
- **Don't** run `html_comment` through HTML escaping.
- **Don't** add post moderation/hiding logic — the broadcaster does it.
- **Don't** hard-code the `wallId` anywhere except the `DEFAULT_WALL_ID`
  constant in `layout.js`. See the *Wall id and the `?id=` override* section.
- **Don't** include a `CUSTOMIZE.md`-style file in your output. This file
  is the meta-doc; layouts shouldn't ship docs about how to write
  layouts.
- **Don't** ship a desktop-only layout. Mobile responsiveness is a
  hard requirement, not a polish item — see *Responsive design (required)*.
- **Don't** show full post bodies. Trim to ~280 chars with `client.truncateComment`
  and link to the original — see *Post text length (required)*.
- **Don't** wipe and rebuild the feed on every `change` event. The wall is
  long-lived; diff incrementally — see *Re-render must be incremental*.
- **Don't** leave masonry / imagesLoaded in a slideshow / kiosk layout. One
  post at a time has no grid to pack; a leftover `<script>` tag or
  `new Masonry(…)` call is the #1 cause of a masonry.js load error — see
  *Slideshow / kiosk layouts*.
- **Don't** call `location.reload()`, set polling timers, or otherwise
  re-mount the layout. The socket already pushes updates.

## Extending `wall-client.js`

If you need data the client doesn't expose (e.g. an `unread` count,
filtering by network, real-time view counts), add a method to the client
and document it here. Don't bolt the logic onto `layout.js` — layouts
should stay swappable.

The protocol reference, taken from walls.io's own `wall-fluid.js`, is in
the header comment of `wall-client.js`.
