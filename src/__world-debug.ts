import { clonePixelImage, paintMarker, renderMapImage, worldPixel } from "./map";
import { createWallClient, type Post } from "./wall-client";

const client = createWallClient({ wallId: 186670, initialCount: 100 });
const posts = await new Promise<Post[]>((resolve) => {
  let last: Post[] = [];
  client.on("change", (l) => { last = l; if (l.length >= 80) resolve(l); });
  client.start();
  setTimeout(() => resolve(last), 12000);
});
const geo = posts.filter((p) => Number(p.latitude) && Number(p.longitude))
  .map((p) => ({ lat: Number(p.latitude), lon: Number(p.longitude) }));
console.log("geo points:", geo.length, JSON.stringify(geo));

const cols = 160, rows = 40;
const lats = geo.map((g) => g.lat), lons = geo.map((g) => g.lon);
const center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
const world0 = geo.map((g) => worldPixel(g.lat, g.lon, 0));
const spanX = Math.max(...world0.map((w) => w.x)) - Math.min(...world0.map((w) => w.x));
const spanY = Math.max(...world0.map((w) => w.y)) - Math.min(...world0.map((w) => w.y));
const zoom = Math.max(2, Math.min(11, Math.floor(Math.min(
  spanX > 0 ? Math.log2((cols * 2 * 0.85) / spanX) : 11,
  spanY > 0 ? Math.log2((rows * 4 * 0.85) / spanY) : 11,
))));
console.log("center:", center, "zoom:", zoom, "span0:", spanX.toFixed(2), spanY.toFixed(2));

const base = await renderMapImage(center.lat, center.lon, zoom, cols, rows);
console.log("base map:", base ? `${base.length} lines` : "NULL");
if (!base) process.exit(1);
const image = clonePixelImage(base);
const cw = worldPixel(center.lat, center.lon, zoom);
for (const g of geo) {
  const wp = worldPixel(g.lat, g.lon, zoom);
  const x = Math.round(cols / 2 + (wp.x - cw.x) / 2);
  const y = Math.round(rows + (wp.y - cw.y) / 2);
  console.log(`marker grid px: (${x}, ${y})  [grid is ${cols} x ${rows * 2}]`);
  paintMarker(image, x, y);
}
let orange = 0;
image.forEach((line, r) => line.forEach((run) => {
  if (run.fg.startsWith("#ff") || run.bg.startsWith("#ff")) orange += run.text.length;
}));
console.log("cells with #ff.. colors after paint:", orange);
process.exit(0);
