/*
 * "Dashboard" layout — mission control for the wall: stat tiles, a
 * posts-per-network bar chart in brand colors, a 24-hour activity
 * sparkline, a top-authors leaderboard with pixel avatars, and the three
 * latest posts. Everything derives live from the post buffer.
 */
import { useMemo, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import { usePixelImage } from "./hooks";
import { networkBadge, networkColor, theme } from "./theme";
import { imageUrl, plainComment, relativeTime, truncateText, type Post } from "./wall-client";

const SPARK = "▁▂▃▄▅▆▇█";

function Panel({
  title,
  children,
  grow = 1,
}: {
  title: string;
  children: ReactNode;
  grow?: number;
}) {
  return (
    <box
      border
      style={{
        borderStyle: "single",
        borderColor: theme.border,
        backgroundColor: theme.panel,
        flexDirection: "column",
        flexGrow: grow,
        flexBasis: 0,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={` ${title} `}
      titleColor={theme.green}
    >
      {children}
    </box>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <box
      border
      style={{
        borderStyle: "single",
        borderColor: theme.border,
        backgroundColor: theme.panel,
        flexDirection: "column",
        alignItems: "center",
        flexGrow: 1,
        flexBasis: 0,
      }}
    >
      <text fg={color} attributes={TextAttributes.BOLD}>
        {String(value)}
      </text>
      <text fg={theme.dim}>{label}</text>
    </box>
  );
}

function AuthorRow({ post, count, rank }: { post: Post; count: number; rank: number }) {
  const avatarUrl = post.external_image_unique_id
    ? imageUrl(post, { field: "external_image", w: 32, h: 32, webp: 0 })
    : "";
  const avatar = usePixelImage(avatarUrl, 6, 3);
  const name = post.external_fullname || post.external_name || "anonymous";
  return (
    <box style={{ flexDirection: "row", marginBottom: 1, alignItems: "center" }}>
      <box style={{ flexDirection: "column", width: 6, flexShrink: 0, marginRight: 1 }}>
        {avatar ? (
          avatar.map((runs, y) => (
            <text key={y} style={{ wrapMode: "none" }}>
              {runs.map((run, i) => (
                <span key={i} fg={run.fg} bg={run.bg}>
                  {run.text}
                </span>
              ))}
            </text>
          ))
        ) : (
          <text fg={theme.dim}>({name[0] ?? "?"})</text>
        )}
      </box>
      <box style={{ flexDirection: "column", flexShrink: 1 }}>
        <text
          fg={rank === 0 ? theme.amber : theme.text}
          attributes={TextAttributes.BOLD}
          style={{ wrapMode: "none" }}
        >
          {rank + 1}. {name}
        </text>
        <text fg={theme.dim} style={{ wrapMode: "none" }}>
          {count} post{count === 1 ? "" : "s"} · {networkBadge(post.type)}
        </text>
      </box>
    </box>
  );
}

export interface DashboardLayoutProps {
  posts: Post[];
  now: number;
  width: number;
}

export function DashboardLayout({ posts, now, width }: DashboardLayoutProps) {
  const stats = useMemo(() => {
    const byNetwork = new Map<string, number>();
    const byAuthor = new Map<string, { post: Post; count: number }>();
    let images = 0;
    let videos = 0;
    let geo = 0;
    const hourBuckets = new Array<number>(24).fill(0);
    const nowSec = now / 1000;
    for (const post of posts) {
      byNetwork.set(post.type, (byNetwork.get(post.type) ?? 0) + 1);
      const author = post.external_fullname || post.external_name || "anonymous";
      const entry = byAuthor.get(author);
      if (entry) entry.count++;
      else byAuthor.set(author, { post, count: 1 });
      if (post.is_video) videos++;
      else if (post.post_image_unique_id || post.post_image) images++;
      if (Number(post.latitude) && Number(post.longitude)) geo++;
      const age = nowSec - (Number(post.external_created_timestamp) || 0);
      const hoursAgo = Math.floor(age / 3600);
      if (hoursAgo >= 0 && hoursAgo < 24) hourBuckets[23 - hoursAgo]++;
    }
    const networks = [...byNetwork.entries()].sort((a, b) => b[1] - a[1]);
    const authors = [...byAuthor.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    const latest = [...posts]
      .sort(
        (a, b) =>
          (Number(b.external_created_timestamp) || 0) -
          (Number(a.external_created_timestamp) || 0),
      )
      .slice(0, 3);
    return { networks, authors, latest, images, videos, geo, hourBuckets };
  }, [posts, now]);

  if (posts.length === 0) {
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={theme.greenDim} attributes={TextAttributes.BOLD}>
          ░▒▓ AWAITING TRANSMISSION ▓▒░
        </text>
      </box>
    );
  }

  const maxNet = Math.max(1, ...stats.networks.map(([, n]) => n));
  const barWidth = Math.max(10, Math.floor(width / 2) - 26);
  const maxBucket = Math.max(1, ...stats.hourBuckets);
  const sparkline = stats.hourBuckets
    .map((n) => SPARK[Math.min(SPARK.length - 1, Math.round((n / maxBucket) * (SPARK.length - 1)))])
    .join("");

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingRight: 1, gap: 0 }}>
      <box style={{ flexDirection: "row", gap: 1, flexShrink: 0 }}>
        <StatTile label="POSTS" value={posts.length} color={theme.green} />
        <StatTile label="IMAGES" value={stats.images} color={theme.text} />
        <StatTile label="VIDEOS" value={stats.videos} color={theme.text} />
        <StatTile label="GEOTAGGED" value={stats.geo} color={theme.amber} />
      </box>

      <box style={{ flexDirection: "row", gap: 1, flexShrink: 0 }}>
        <Panel title="NETWORKS">
          {stats.networks.slice(0, 6).map(([type, n]) => (
            <text key={type} style={{ wrapMode: "none" }}>
              <span fg={networkColor(type)}>
                {networkBadge(type).padEnd(12).slice(0, 12)}
              </span>
              <span fg={networkColor(type)}>
                {"█".repeat(Math.max(1, Math.round((n / maxNet) * barWidth)))}
              </span>
              <span fg={theme.dim}> {n}</span>
            </text>
          ))}
        </Panel>
        <Panel title="ACTIVITY · LAST 24H">
          <text fg={theme.green} style={{ wrapMode: "none" }}>
            {sparkline}
          </text>
          <text fg={theme.dim} style={{ wrapMode: "none" }}>
            {"-24h".padEnd(sparkline.length - 3)}now
          </text>
          <text fg={theme.dim} style={{ marginTop: 1 }}>
            peak {maxBucket}/h
          </text>
        </Panel>
      </box>

      <box style={{ flexDirection: "row", gap: 1, flexGrow: 1 }}>
        <Panel title="TOP AUTHORS">
          {stats.authors.map(({ post, count }, i) => (
            <AuthorRow key={i} post={post} count={count} rank={i} />
          ))}
        </Panel>
        <Panel title="LATEST">
          {stats.latest.map((post) => (
            <box key={String(post.id)} style={{ flexDirection: "column", marginBottom: 1 }}>
              <text style={{ wrapMode: "none" }}>
                <span fg={networkColor(post.type)} attributes={TextAttributes.BOLD}>
                  ▌{post.external_fullname || post.external_name || "anonymous"}
                </span>
                <span fg={theme.dim}> · {relativeTime(post.external_created, now)}</span>
              </text>
              <text fg={theme.text} style={{ wrapMode: "none" }}>
                {truncateText(plainComment(post).replace(/\s*\n\s*/g, " "), Math.max(20, Math.floor(width / 2) - 8)) || " "}
              </text>
            </box>
          ))}
        </Panel>
      </box>
    </box>
  );
}
