/*
 * Headless render test: mounts the full App against the live broadcaster
 * inside OpenTUI's test renderer and prints two char frames — one right
 * after mount, one after posts (and at least one ASCII image) arrived.
 *
 *   npm run test:render
 */
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { theme } from "./theme";

// Wide enough for a four-column layout (~38-col cards).
const { renderer, renderOnce, captureCharFrame, captureSpans, mockInput } = await createTestRenderer({
  width: 160,
  height: 46,
});

createRoot(renderer).render(<App wallId={186670} />);

await renderOnce();
console.log("=== frame 0 (just mounted) ===");
console.log(captureCharFrame());

// Give the socket + image pipeline time to deliver, re-rendering as we go.
const deadline = Date.now() + 20000;
let frame = "";
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  await renderOnce();
  frame = captureCharFrame();
  const hasPosts = frame.includes("▌");
  const hasImage = frame.includes("▀▀▀▀▀▀");
  if (hasPosts && hasImage) break;
}

console.log("=== frame 1 (with data) ===");
console.log(frame);

// Link navigation: three →-presses should select the third link without
// crashing, and something on screen must carry the amber selection
// background.
await mockInput.pressKeys(["ARROW_RIGHT", "ARROW_RIGHT", "ARROW_RIGHT"]);
await new Promise((r) => setTimeout(r, 300)); // let React flush the state update
await renderOnce();
const afterNav = captureCharFrame();
const amber = theme.amber.toLowerCase();
const hexOf = (c: { r: number; g: number; b: number }) =>
  "#" +
  [c.r, c.g, c.b]
    .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
    .join("");
const highlighted = captureSpans()
  .lines.flatMap((l) => l.spans)
  .filter((s) => hexOf(s.bg) === amber)
  .map((s) => s.text.trim())
  .filter(Boolean);
console.log(
  `=== after 3x right: renders=${afterNav.length > 0}, posts header intact=${afterNav.includes("POSTS")}, amber-highlighted=${JSON.stringify(highlighted.slice(0, 3))} ===`,
);

// Post focus: Esc clears the link-driven focus, Tab focuses the first
// post — its border turns theme-green.
const greenBorders = () =>
  captureSpans()
    .lines.flatMap((l) => l.spans)
    .filter((s) => hexOf(s.fg) === theme.green.toLowerCase() && /[┌┐└┘─│]/.test(s.text)).length;
await mockInput.pressKeys(["ESCAPE"]);
await new Promise((r) => setTimeout(r, 300));
await renderOnce();
const bordersAfterEsc = greenBorders();
await mockInput.pressKeys(["TAB"]);
await new Promise((r) => setTimeout(r, 300));
await renderOnce();
console.log(`=== tab focus: green borders after esc=${bordersAfterEsc}, after tab=${greenBorders()} ===`);

// Layout switch: 'l' flips to kiosk (one large post + counter), space
// advances the slideshow, 'l' flips back to fluid.
await mockInput.pressKeys(["l"]);
await new Promise((r) => setTimeout(r, 300));
await renderOnce();
const kiosk = captureCharFrame();
const counter = kiosk.match(/(\d+) \/ (\d+)/);
await mockInput.pressKeys([" "]);
await new Promise((r) => setTimeout(r, 300));
await renderOnce();
const afterSpace = captureCharFrame().match(/(\d+) \/ (\d+)/);
console.log(
  `=== kiosk: header=${kiosk.includes("KIOSK")}, autoadvance=${kiosk.includes("AUTO-ADVANCE")}, counter=${counter?.[0]}, after space=${afterSpace?.[0]} ===`,
);
console.log(kiosk.split("\n").slice(4, 30).join("\n"));

renderer.destroy();
process.exit(0);
