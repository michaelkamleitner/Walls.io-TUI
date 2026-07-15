/* Walls.TUI marketing page — hero terminal, half-block demo, and toys. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));

  /* ── half-block image demo ─────────────────────────────────────────
     The same trick the app uses: draw an image (here: a canvas we paint
     ourselves), read pixels, emit one ▀ per cell — foreground = upper
     pixel, background = lower pixel, phosphor-tinted. */
  function buildHalfblockImage(cols, rows) {
    const w = cols;
    const h = rows * 2;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");

    // backdrop: diagonal fade + a hot spot, like a stage shot
    const grad = g.createLinearGradient(0, h, w, 0);
    grad.addColorStop(0, "#101010");
    grad.addColorStop(0.55, "#3c3c3c");
    grad.addColorStop(1, "#0c0c0c");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const spot = g.createRadialGradient(w * 0.72, h * 0.3, 1, w * 0.72, h * 0.3, w * 0.42);
    spot.addColorStop(0, "rgba(255,255,255,0.95)");
    spot.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spot;
    g.fillRect(0, 0, w, h);

    // crowd noise along the bottom
    for (let i = 0; i < w * 3; i++) {
      const x = Math.random() * w;
      const y = h * 0.62 + Math.random() * h * 0.38;
      const v = Math.floor(Math.random() * 110);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1.2, 1.2);
    }

    // the wordmark
    g.font = `bold ${Math.floor(h * 0.28)}px "IBM Plex Mono", monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.fillText("WALLS.TUI", w / 2, h * 0.38);

    const data = g.getImageData(0, 0, w, h).data;
    const lum = (x, y) => {
      const o = (y * w + x) * 4;
      return (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    };
    // phosphor tint, 64 levels
    const tint = (v) => {
      const q = Math.round(v * 63) / 63;
      return `rgb(${Math.round(q * 90)},${Math.round(60 + q * 195)},${Math.round(q * 130)})`;
    };

    const lines = [];
    for (let row = 0; row < rows; row++) {
      let html = "";
      for (let x = 0; x < w; x++) {
        html += `<span style="color:${tint(lum(x, row * 2))};background:${tint(lum(x, row * 2 + 1))}">▀</span>`;
      }
      lines.push(html);
    }
    return lines;
  }

  /* ── hero terminal session ─────────────────────────────────────────── */
  const screen = document.getElementById("term-screen");

  function line(html = "") {
    const el = document.createElement("div");
    el.innerHTML = html;
    screen.appendChild(el);
    return el;
  }

  async function typeInto(el, text, prefixHtml) {
    if (reduceMotion) {
      el.innerHTML = `${prefixHtml}${text}`;
      return;
    }
    for (let i = 1; i <= text.length; i++) {
      el.innerHTML = `${prefixHtml}${text.slice(0, i)}<span class="cursor"></span>`;
      await sleep(34 + Math.random() * 40);
    }
    el.innerHTML = `${prefixHtml}${text}`;
  }

  async function runTerminal() {
    if (!screen) return;
    const prompt = '<span class="t-prompt">wall@localhost $ </span>';

    const cmd = line();
    await sleep(600);
    await typeInto(cmd, "walls-tui --wall 186670", prompt);
    await sleep(350);

    const status = line('<span class="t-dim">⣾ connecting to broadcaster.walls.io …</span>');
    await sleep(900);
    status.innerHTML =
      '<span class="t-accent">● LIVE</span><span class="t-dim"> — buffered </span>' +
      '<span class="t-accent">100</span><span class="t-dim"> posts · layout: fluid</span>';
    await sleep(420);

    line("");
    line('<span class="t-dim">┌─ TWITTER ──────────────────────────────────────────────┐</span>');
    line(
      '<span class="t-dim">│</span> <span class="t-accent t-bold">▌jess @ the show</span>' +
      '                              <span class="t-dim">2 min ago │</span>',
    );
    line('<span class="t-dim">│</span>                                                        <span class="t-dim">│</span>');
    line(
      '<span class="t-dim">│</span> front row. terminal crowd goes wild.' +
      ' <span class="t-accent">#wallstui</span>        <span class="t-dim">│</span>',
    );
    line('<span class="t-dim">│</span>                                                        <span class="t-dim">│</span>');
    await sleep(500);

    const imgStatus = line('<span class="t-dim">│ ░▒▓ receiving image…                                   │</span>');
    await sleep(850);

    const cols = 56;
    const rows = 13;
    const img = buildHalfblockImage(cols, rows);
    imgStatus.remove();
    for (const rowHtml of img) {
      line(`<span class="t-dim">│ </span>${rowHtml}<span class="t-dim"> │</span>`);
      await sleep(52);
    }
    line('<span class="t-dim">└────────────────────────────────────────────────────────┘</span>');
    await sleep(300);
    line("");
    line(
      '<span class="t-dim">⇥ posts · ←/→ links · ↵ open · l layout ·' +
      ' </span><span class="t-amber">▲ 1 pinned</span>',
    );
    line(`${prompt}<span class="cursor"></span>`);
  }

  runTerminal();

  /* ── ticker: duplicate content for a seamless loop ─────────────────── */
  const track = document.getElementById("ticker-track");
  if (track) track.innerHTML += track.innerHTML;

  /* ── reveal on scroll ──────────────────────────────────────────────── */
  const revealables = document.querySelectorAll(".reveal");
  if (reduceMotion) {
    revealables.forEach((el) => el.classList.add("visible"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    revealables.forEach((el) => io.observe(el));
  }

  /* ── copy buttons ──────────────────────────────────────────────────── */
  for (const btn of document.querySelectorAll(".copy-btn")) {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy.replace(/\\n/g, "\n"));
        btn.textContent = "copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "copy";
          btn.classList.remove("copied");
        }, 1400);
      } catch {
        btn.textContent = "ctrl+c?";
      }
    });
  }

  /* ── the 'l' easter egg: cycle the page theme like layouts ─────────── */
  const toast = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  }

  const themes = [
    { name: "fluid", accent: "#33ff66", dim: "#1e9c46", glowRgb: "51,255,102" },
    { name: "kiosk", accent: "#ffb000", dim: "#a06e00", glowRgb: "255,176,0" },
    { name: "map", accent: "#3ad6ff", dim: "#1f7f99", glowRgb: "58,214,255" },
    { name: "world", accent: "#ff6ad5", dim: "#a33f87", glowRgb: "255,106,213" },
    { name: "ticker", accent: "#c6ff4d", dim: "#7a9c2e", glowRgb: "198,255,77" },
  ];
  let themeIndex = 0;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "l" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.matches?.("input, textarea, [contenteditable]") ?? false)) return;
    themeIndex = (themeIndex + 1) % themes.length;
    const theme = themes[themeIndex];
    const root = document.documentElement.style;
    root.setProperty("--accent", theme.accent);
    root.setProperty("--accent-dim", theme.dim);
    root.setProperty("--glow", `0 0 6px rgba(${theme.glowRgb},0.55), 0 0 24px rgba(${theme.glowRgb},0.18)`);
    showToast(`layout → ${theme.name}`);
  });
})();
