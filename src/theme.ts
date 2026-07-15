/*
 * Retro terminal theme: dark CRT background, phosphor-green primary, amber
 * for pinned/emphasis, per-network brand colors for badges and borders.
 */
export const theme = {
  bg: "#0b0f0c",
  panel: "#101511",
  border: "#2c3a2e",
  text: "#d8e3d8",
  dim: "#7a8a7c",
  green: "#33ff66",
  greenDim: "#1e9c46",
  amber: "#ffb000",
  red: "#ff5555",
};

const NETWORK_COLORS: Record<string, string> = {
  twitter: "#1d9bf0",
  facebook: "#4d8ef7",
  instagram: "#e1306c",
  linkedin: "#3b82f6",
  tiktok: "#69c9d0",
  youtube: "#ff4444",
  mastodon: "#8b8bff",
  bluesky: "#3399ff",
  reddit: "#ff5722",
  pinterest: "#e64a5f",
  tumblr: "#7c94b5",
  vimeo: "#1ab7ea",
  flickr: "#ff4da6",
  rss: "#f28c38",
  direct_post: "#33ff66",
  wallsio: "#33ff66",
  poll: "#c39bd3",
};

export function networkColor(type: string): string {
  return NETWORK_COLORS[type] || theme.green;
}

export function networkBadge(type: string): string {
  return (type || "post").replace(/_/g, " ").toUpperCase();
}
