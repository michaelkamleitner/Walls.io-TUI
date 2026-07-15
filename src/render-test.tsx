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

const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
  width: 100,
  height: 44,
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
  const hasImage = /[@#%*+=:-]{12}/.test(frame);
  if (hasPosts && hasImage) break;
}

console.log("=== frame 1 (with data) ===");
console.log(frame);
renderer.destroy();
process.exit(0);
