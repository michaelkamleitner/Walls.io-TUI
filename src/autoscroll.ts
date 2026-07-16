/*
 * Auto-scroll ("s" to toggle, on by default): slowly drives one or more
 * scrollboxes down for AUTOSCROLL_PAGES viewport-heights, then back up,
 * ping-ponging while enabled. The on/off state lives in App (it feeds the
 * footer hint); layouts pass the scrollboxes to drive. A box that runs out
 * of content early just waits at its edge until the direction flips.
 */
import { useEffect, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

const AUTOSCROLL_TICK_MS = 200;
const AUTOSCROLL_STEP = 1; // rows per tick
const AUTOSCROLL_PAGES = 10; // viewport-heights per leg

export function useAutoScroll(
  enabled: boolean,
  getTargets: () => Array<ScrollBoxRenderable | null | undefined>,
) {
  const dirRef = useRef<1 | -1>(1);
  const traveledRef = useRef(0);
  // Always read the latest closure without re-arming the interval.
  const getTargetsRef = useRef(getTargets);
  getTargetsRef.current = getTargets;

  useEffect(() => {
    if (!enabled) return;
    dirRef.current = 1;
    traveledRef.current = 0;
    const t = setInterval(() => {
      const targets = getTargetsRef
        .current()
        .filter((sb): sb is ScrollBoxRenderable => Boolean(sb));
      if (!targets.length) return;
      const dir = dirRef.current;
      const atEdge = (sb: ScrollBoxRenderable) =>
        dir === 1
          ? sb.scrollTop + (sb.viewport?.height ?? 0) >= sb.scrollHeight
          : sb.scrollTop <= 0;
      const pageHeight = Math.max(4, ...targets.map((sb) => sb.viewport?.height ?? 0));
      if (targets.every(atEdge) || traveledRef.current >= AUTOSCROLL_PAGES * pageHeight) {
        dirRef.current = dir === 1 ? -1 : 1;
        traveledRef.current = 0;
        return;
      }
      for (const sb of targets) sb.scrollBy(dir * AUTOSCROLL_STEP);
      traveledRef.current += AUTOSCROLL_STEP;
    }, AUTOSCROLL_TICK_MS);
    return () => clearInterval(t);
  }, [enabled]);
}
