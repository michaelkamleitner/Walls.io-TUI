# Walls.io TUI

A retro terminal client for a [walls.io](https://walls.io) social wall.
Live posts stream in over the walls.io broadcaster (Socket.IO) and render as
a responsive multi-column masonry feed — with post photos drawn as shaded
half-block "pixels", CRT-green styling, and full keyboard link navigation.

Built with [OpenTUI](https://github.com/anomalyco/opentui) (React renderer)
on [Bun](https://bun.sh).

## Requirements

- **Node.js ≥ 20** with npm — that's all. Bun is installed as a local
  dev dependency by `npm install`; nothing global is needed.
- A terminal with **24-bit color** (Ghostty, iTerm2, WezTerm, Kitty,
  Windows Terminal, …). Images are drawn with truecolor half-blocks and
  look washed out in 256-color terminals.
- Optional: a terminal with OSC-8 hyperlink support makes every link
  Cmd/Ctrl-clickable too.
- Optional: **ffmpeg** on your PATH turns video posts into animated
  slideshows (see *Video slideshows*). Without it, videos show their
  poster image.

## Install

```sh
npm install
```

## Run

```sh
npm start                        # default wall
npm start -- --wall 139355       # any other wall id
npm start -- --network twitter   # restrict to one network
npm start -- --layout kiosk      # start in the kiosk slideshow
```

## Standalone binary (nicer than npm start)

Bun compiles the whole app — TypeScript, the React tree, socket.io, and
OpenTUI's native renderer — into one self-contained executable (~71 MB,
no `node_modules` needed at runtime):

```sh
npm run build          # produces ./walls-tui
./walls-tui --wall 139355
```

Put it on your PATH and run it from anywhere:

```sh
cp walls-tui /usr/local/bin/
walls-tui
```

The binary is per-platform (build on the machine you run it on).

## Layouts

Two layouts ship; `l` toggles between them at any time and `--layout`
picks the starting one.

- **Fluid** (default) — the responsive multi-column masonry feed.
- **Kiosk** — a full-screen slideshow showing one post at a time: media
  large on the left, author / timestamp / text on the right. Advances
  every 5 seconds; manual navigation resets the timer.
- **Map** — a slideshow over the wall's *geotagged* posts: a full-bleed
  rasterized OpenStreetMap view centered on each post's coordinates
  (◉ marks the spot), with the post floating in a card. Same navigation
  as Kiosk. Tiles come from tile.openstreetmap.org and are cached in
  `~/.cache/walls-tui/tiles/`; walls without lat/long data show a hint
  to switch layouts.

## Keyboard

Global:

| Key   | Action                                |
| ----- | ------------------------------------- |
| `l`   | cycle layout (Fluid → Kiosk → Map)    |
| `r`   | reconnect and reload the wall         |
| `q`   | quit                                  |

Fluid:

| Key           | Action                                    |
| ------------- | ----------------------------------------- |
| `Tab` / `Shift+Tab` | focus next / previous post (green border) |
| `←` / `→`     | select previous / next link in the feed   |
| `Enter`       | open the selected link — or the focused post — in your browser |
| `Esc`         | clear focus/selection (quit when none)    |
| `j` / `k`     | scroll down / up                          |
| `d` / `u`     | page down / up (PgDn / PgUp work too)     |
| `↑` / `↓` / mouse wheel | scroll                          |

Author names, timestamps, URLs in post text, and CTA buttons are all
links — `←`/`→` walks through every one of them in reading order and
scrolls its card into view. Link selection and post focus stay in sync:
browsing links moves the green post highlight along, and after `Tab`bing
to a post, `→` starts at that post's first link.

Kiosk / Map:

| Key             | Action                                  |
| --------------- | --------------------------------------- |
| `Space` / `→`   | next post (wraps around)                |
| `←`             | previous post (wraps around)            |
| `Enter`         | open the current post in your browser   |
| `Esc`           | quit                                    |

## Options

| Flag              | Default  | Meaning                                   |
| ----------------- | -------- | ----------------------------------------- |
| `--wall <id>`     | `186670` | walls.io wall id to subscribe to          |
| `--network <net>` | all      | only show one network (e.g. `instagram`)  |
| `--layout <name>` | `fluid`  | starting layout: `fluid`, `kiosk`, `map`  |

## How it works

| File               | Role                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `src/wall-client.ts` | Data layer: Socket.IO connection to the walls.io broadcaster, dedupe, sorting, pagination. The full protocol reference is in the file header. |
| `src/pixels.ts`    | Image → half-block pixels: two square-ish grayscale pixels per cell via `▀` (fg = top, bg = bottom), 64 shades, contrast-stretched. |
| `src/video.ts`     | Video → slideshow: ffmpeg frame extraction with an on-disk cache and a 2-process cap.  |
| `src/masonry.ts`   | Greedy shortest-column packing with card-height estimation, plus the JS word-wrapper. |
| `src/App.tsx`      | Shell: header/footer, layout switching, global keys, timestamp ticker.                |
| `src/FluidLayout.tsx` | Masonry feed: responsive columns, infinite scroll, keyboard link navigation.        |
| `src/KioskLayout.tsx` | Slideshow: one large post, 5 s auto-advance, Space/arrow navigation.                |
| `src/MapLayout.tsx` / `src/map.ts` | Geo slideshow: OSM tile fetch + compose + rasterize, marker, floating post card. |
| `src/PostCard.tsx` | One post: author, timestamp, body, image, video tag, CTA — all hyperlinked.           |

The feed loads 100 posts up front and pages in older ones as you scroll.
Live events (new posts, edits, pins, admin hide/unhide) apply in place.

### Video slideshows

When ffmpeg is installed, each video post is turned into a looping
slideshow: up to 10 frames are extracted directly from the source video
URL, spread evenly across the clip (`ffprobe` reads the duration), and
played at ~0.8 s per frame through the same pixel renderer as images.

Extracted frames are cached as JPEGs in `~/.cache/walls-tui/frames/<hash>/`,
so a wall full of videos only pays the extraction cost on first view —
delete that directory any time to reclaim space. At most two ffmpeg
processes run at once; until a video's frames are ready (or if extraction
fails) the card shows the regular poster image.

## Development

```sh
npm run typecheck      # tsc --noEmit
npm run smoke          # headless protocol + image-pipeline test against the live broadcaster
npm run test:render    # mounts the full app in OpenTUI's test renderer and checks frames
```
