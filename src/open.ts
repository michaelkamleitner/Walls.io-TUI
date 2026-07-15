import { spawn } from "node:child_process";

export function openInBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // last resort: nothing sensible to do in a TUI
  }
}
