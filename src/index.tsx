/*
 * tui.walls.io — a retro terminal client for a walls.io social wall.
 *
 *   npm start                  # default wall
 *   npm start -- --wall 139355 # another wall (same idea as ?id= on the web)
 *   npm start -- --network twitter
 *   npm start -- --layout kiosk|map|fluid
 */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App, LAYOUTS, type LayoutName } from "./App";

// Mirrors DEFAULT_WALL_ID + the ?id= override from the web layout: the CLI
// flag is the single override surface, anything non-numeric falls back.
const DEFAULT_WALL_ID = 186670;

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.split("=").slice(1).join("=") : undefined;
}

const wallId = Number(argValue("wall")) || DEFAULT_WALL_ID;
const network = argValue("network");
const layoutArg = (argValue("layout") || "fluid").toLowerCase() as LayoutName;
const initialLayout: LayoutName = LAYOUTS.includes(layoutArg) ? layoutArg : "fluid";

const renderer = await createCliRenderer({ targetFps: 30 });
createRoot(renderer).render(
  <App wallId={wallId} network={network} initialLayout={initialLayout} />,
);
