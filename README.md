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

## Install

```sh
npm install
```

## Run

```sh
npm start                        # default wall
npm start -- --wall 139355       # any other wall id
npm start -- --network twitter   # restrict to one network
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

## Keyboard

| Key           | Action                                    |
| ------------- | ----------------------------------------- |
| `←` / `→`     | select previous / next link in the feed   |
| `Enter`       | open the selected link in your browser    |
| `Esc`         | clear link selection (quit when none)     |
| `j` / `k`     | scroll down / up                          |
| `d` / `u`     | page down / up (PgDn / PgUp work too)     |
| `↑` / `↓` / mouse wheel | scroll                          |
| `r`           | reconnect and reload the wall             |
| `q`           | quit                                      |

Author names, timestamps, URLs in post text, and CTA buttons are all
links — `←`/`→` walks through every one of them in reading order and
scrolls its card into view.

## Options

| Flag              | Default  | Meaning                                   |
| ----------------- | -------- | ----------------------------------------- |
| `--wall <id>`     | `186670` | walls.io wall id to subscribe to          |
| `--network <net>` | all      | only show one network (e.g. `instagram`)  |

## How it works

| File               | Role                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `src/wall-client.ts` | Data layer: Socket.IO connection to the walls.io broadcaster, dedupe, sorting, pagination. The full protocol reference is in the file header. |
| `src/pixels.ts`    | Image → half-block pixels: two square-ish grayscale pixels per cell via `▀` (fg = top, bg = bottom), 64 shades, contrast-stretched. |
| `src/masonry.ts`   | Greedy shortest-column packing with card-height estimation, plus the JS word-wrapper. |
| `src/App.tsx`      | Feed shell: responsive columns, infinite scroll, keyboard handling, link registry.    |
| `src/PostCard.tsx` | One post: author, timestamp, body, image, video tag, CTA — all hyperlinked.           |

The feed loads 100 posts up front and pages in older ones as you scroll.
Live events (new posts, edits, pins, admin hide/unhide) apply in place.

## Development

```sh
npm run typecheck      # tsc --noEmit
npm run smoke          # headless protocol + image-pipeline test against the live broadcaster
npm run test:render    # mounts the full app in OpenTUI's test renderer and checks frames
```
