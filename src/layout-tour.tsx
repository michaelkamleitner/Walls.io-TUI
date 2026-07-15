/*
 * Layout tour: mounts the app against the live broadcaster, cycles
 * through every layout with 'l', and probes each frame for
 * layout-specific content.
 *
 *   npm run test:tour
 */
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { App, LAYOUTS } from "./App";

const PROBES: Record<string, (frame: string) => boolean> = {
  fluid: (f) => f.includes("┌─") && f.includes("SCROLL FOR MORE"),
  kiosk: (f) => /\d+ \/ \d+/.test(f),
  map: (f) => f.includes("geotagged") || f.includes("NO GEOTAGGED"),
  world: (f) => f.includes("geotagged") || f.includes("NO GEOTAGGED"),
  ticker: (f) => /\[\d+:\d+[^\]]*\]/.test(f) && f.includes("LIVE TAIL"),
  theater: (f) => f.includes("AUTO-ADVANCE 6s") && (f.match(/▀/g)?.length ?? 0) > 500,
  dashboard: (f) => f.includes("NETWORKS") && f.includes("TOP AUTHORS"),
  channels: (f) => f.includes("column") && f.includes("▌"),
  screensaver: (f) => f.includes("BOUNCING") && f.includes("┌"),
};

const { renderer, renderOnce, captureCharFrame, mockInput } = await createTestRenderer({
  width: 160,
  height: 46,
});
createRoot(renderer).render(<App wallId={186670} />);

// Wait for posts.
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  await renderOnce();
  if (captureCharFrame().includes("▌")) break;
}

let failures = 0;
for (let i = 0; i < LAYOUTS.length; i++) {
  const layout = LAYOUTS[i];
  if (i > 0) await mockInput.pressKeys(["l"]);
  // Give slow layouts (tiles, images, extraction) time to settle; pass as
  // soon as the probe matches.
  const until = Date.now() + 12000;
  let ok = false;
  let frame = "";
  while (Date.now() < until && !ok) {
    await new Promise((r) => setTimeout(r, 600));
    await renderOnce();
    frame = captureCharFrame();
    ok = frame.includes(layout.toUpperCase()) && PROBES[layout](frame);
  }
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${layout}`);
  if (!ok) {
    console.log(frame.split("\n").slice(0, 14).join("\n"));
  }
}

renderer.destroy();
process.exit(failures ? 1 : 0);
