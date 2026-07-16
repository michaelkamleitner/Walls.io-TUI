---
name: verify
description: How to verify changes to this TUI at runtime — build/launch/drive recipe.
---

# Verifying tui.walls.io changes

This is a Bun + OpenTUI terminal app that connects to a live walls.io
social wall over socket.io. `bun` is NOT on PATH — use
`./node_modules/.bin/bun`.

## Drive the running app headlessly

Do not bother with tmux (not installed) or GNU `screen` (its hardcopy
captures nothing from the OpenTUI renderer). The reliable handle is the
repo's own harness, `createTestRenderer` from `@opentui/core/testing` —
it mounts the real `App` against the live broadcaster, sends real key
events, and captures character frames. `src/layout-tour.tsx` is the
reference example.

Recipe: write a throwaway `src/verify-<feature>.tsx` (must live in
`src/` so imports resolve), run it with
`./node_modules/.bin/bun run src/verify-<feature>.tsx`, delete it after.

```tsx
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { App } from "./App";

const { renderer, renderOnce, captureCharFrame, mockInput } =
  await createTestRenderer({ width: 160, height: 16 });
createRoot(renderer).render(<App wallId={186670} initialLayout="fluid" />);
// wait ~5-20s until captureCharFrame() includes "┌" (posts arrived)
// drive: mockInput.pressKeys(["s"]); await renderOnce(); captureCharFrame()
```

Gotchas:
- Wall 186670 is the default live wall; posts need up to 20 s to arrive.
  Poll every 500 ms for `"┌"` (fluid cards) or `"▌"` (network badges).
- Always `await renderOnce()` before `captureCharFrame()` — frames only
  paint on demand.
- Small heights (e.g. 16) make scroll-related behavior fast to observe
  (viewport ≈ 10 rows).
- Layout order for cycling with "l": fluid, kiosk, map, world, ticker,
  theater, dashboard, channels, screensaver.
- To track scrolling, grab a distinctive text line from an early frame
  and follow its row index across frames; live posts arriving can shift
  content, so prefer trends over exact rows.
- `bun run typecheck` for types; `test:tour` / `test:render` exist but
  are CI checks, not verification.
