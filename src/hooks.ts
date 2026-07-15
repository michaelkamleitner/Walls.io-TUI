/*
 * Shared media hooks — used by the Fluid cards and the Kiosk slideshow,
 * which render the same pixel images/video frames at different sizes.
 */
import { useEffect, useState } from "react";
import { IMAGE_MAX_ROWS, imageToPixels, type PixelImage } from "./pixels";
import { videoToPixelFrames } from "./video";

const SLIDESHOW_INTERVAL_MS = 800;

export function usePixelImage(
  url: string,
  cols: number,
  maxRows = IMAGE_MAX_ROWS,
): PixelImage | null {
  const [pixels, setPixels] = useState<PixelImage | null>(null);
  useEffect(() => {
    let alive = true;
    setPixels(null);
    if (!url || cols < 4) return;
    imageToPixels(url, cols, maxRows).then((result) => {
      if (alive) setPixels(result);
    });
    return () => {
      alive = false;
    };
  }, [url, cols, maxRows]);
  return pixels;
}

// ffmpeg-extracted frames playing as a looping slideshow. `slideshow` is
// null while extraction runs or after it fails — callers fall back to the
// poster image; `pending` distinguishes "still extracting" from "gave up".
export function useVideoSlideshow(
  url: string,
  cols: number,
  maxRows = IMAGE_MAX_ROWS,
): {
  slideshow: { frame: PixelImage; index: number; count: number } | null;
  pending: boolean;
} {
  const [frames, setFrames] = useState<PixelImage[] | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let alive = true;
    setFrames(null);
    setIndex(0);
    if (!url || cols < 4) return;
    videoToPixelFrames(url, cols, maxRows).then((result) => {
      if (alive) setFrames(result ?? []); // [] = extraction failed
    });
    return () => {
      alive = false;
    };
  }, [url, cols, maxRows]);
  useEffect(() => {
    if (!frames || frames.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % frames.length),
      SLIDESHOW_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [frames]);
  if (!frames?.length) return { slideshow: null, pending: !!url && frames === null };
  return {
    slideshow: { frame: frames[index % frames.length], index, count: frames.length },
    pending: false,
  };
}
