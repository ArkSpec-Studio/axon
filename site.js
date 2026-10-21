// AXON website script. Served as its own file so the page's security policy can forbid inline scripts.
"use strict";
// Refuse to be shown inside another site's frame (protects visitors from "clickjacking" tricks).
if (window.top !== window.self) { try { window.top.location = window.self.location.href; } catch { document.documentElement.hidden = true; } }
// Same themes as the app. Clicking one restyles the whole page; the choice is remembered on this device.
const THEMES = [
  { id: "axon-dark", name: "AXON Dark", c: { bg: "#050b12", panel: "#0a1622", line: "#1d5468", text: "#d8f3ff", muted: "#7fa3b3", accent: "#33e1ff", c2: "#ffb547", good: "#3ee0a0" } },
  { id: "axon-light", name: "AXON Light", c: { bg: "#f3f6f9", panel: "#ffffff", line: "#c6d5e0", text: "#0f2230", muted: "#557080", accent: "#0a7fc0", c2: "#b86e00", good: "#138a5b" } },
  { id: "red-dark", name: "AXON Red Dark", c: { bg: "#0e0708", panel: "#1a0d10", line: "#5e2229", text: "#ffe9eb", muted: "#c09499", accent: "#ff3b4e", c2: "#ffb547", good: "#3ee0a0" } },
  { id: "red-light", name: "AXON Red Light", c: { bg: "#faf4f4", panel: "#ffffff", line: "#ebcdd0", text: "#2a1013", muted: "#7d5a5e", accent: "#d0202f", c2: "#b86e00", good: "#138a5b" } },
  { id: "violet", name: "Midnight Violet", c: { bg: "#0d0a1a", panel: "#161129", line: "#3b2f6b", text: "#ece6ff", muted: "#9a8fc2", accent: "#a78bfa", c2: "#f472b6", good: "#34d399" } },
  { id: "forest", name: "Forest", c: { bg: "#0b130e", panel: "#121e16", line: "#2c4a36", text: "#e3f1e7", muted: "#8aa894", accent: "#4ade80", c2: "#facc15", good: "#86efac" } },
  { id: "ember", name: "Ember", c: { bg: "#140c08", panel: "#1f140e", line: "#5a3420", text: "#fbe9dd", muted: "#b8917b", accent: "#ff8a3d", c2: "#ffd166", good: "#7bd88f" } },
  { id: "mono", name: "Graphite", c: { bg: "#0e0e0f", panel: "#18181a", line: "#36363a", text: "#ededed", muted: "#9a9a9e", accent: "#f2f2f2", c2: "#c9c9c9", good: "#a3e635" } },
  { id: "paper", name: "Paper", c: { bg: "#f6f1e7", panel: "#fffaf0", line: "#dccfb6", text: "#2f2618", muted: "#7b6a50", accent: "#9a5b13", c2: "#2f6f8f", good: "#3d7d3a" } },
  { id: "ocean", name: "Ocean", c: { bg: "#eef6fb", panel: "#ffffff", line: "#c2dbe9", text: "#0d2a3a", muted: "#4f6e80", accent: "#0077b6", c2: "#e76f51", good: "#2a9d8f" } },
  { id: "rose", name: "Rose", c: { bg: "#fdf2f5", panel: "#ffffff", line: "#f1c9d5", text: "#3a1622", muted: "#8d5a69", accent: "#d6336c", c2: "#7048e8", good: "#2b8a3e" } },
  { id: "contrast", name: "High contrast", c: { bg: "#000000", panel: "#000000", line: "#ffffff", text: "#ffffff", muted: "#e0e0e0", accent: "#ffde00", c2: "#00e5ff", good: "#00ff7f" } },
];
const root = document.documentElement, host = document.getElementById("themes");
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

// Swatches are built with DOM calls (no HTML strings, no inline style attributes) so the page can run
// under a strict Content-Security-Policy that blocks injected markup and inline styles.
for (const t of THEMES) {
  const b = document.createElement("button");
  b.className = "sw"; b.dataset.id = t.id; b.setAttribute("aria-pressed", "false");
  const chips = document.createElement("span"); chips.className = "chipset";
  for (const c of [t.c.bg, t.c.accent, t.c.c2]) { const i = document.createElement("i"); i.style.background = c; chips.appendChild(i); }
  b.append(chips, document.createTextNode(t.name));
  host.appendChild(b);
}

function clearInline() { for (const k of ["bg", "panel", "line", "text", "muted", "accent", "c2", "good", "ink"]) root.style.removeProperty("--" + k); root.style.removeProperty("color-scheme"); }
function apply(sel) {
  clearInline(); root.removeAttribute("data-theme");
  const t = THEMES.find((x) => x.id === sel);
  if (t) {
    for (const [k, v] of Object.entries(t.c)) root.style.setProperty("--" + k, v);
    root.style.setProperty("--ink", lum(t.c.accent) > 0.35 ? "#0b0b0b" : "#ffffff");
    root.style.setProperty("color-scheme", lum(t.c.bg) > 0.4 ? "light" : "dark");
  } else if (sel === "dark" || sel === "light") root.setAttribute("data-theme", sel);
  const light = sel === "light" || (sel === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
  showShots(t ? t.id : light ? "axon-light" : "axon-dark");
  setFavicon();
  host.querySelectorAll(".sw").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === sel)));
  document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === (t ? "" : sel || "auto"))));
  store.set("axon.site.theme", sel === "auto" ? null : sel);
}
// The browser-tab icon is the logo SVG drawn in the current theme's colours.
function setFavicon() {
  const cs = getComputedStyle(root), bg = cs.getPropertyValue("--bg").trim(), fg = cs.getPropertyValue("--accent").trim();
  const svg = document.querySelector(".brand-ic").outerHTML
    .replace('class="brand-ic"', 'xmlns="http://www.w3.org/2000/svg"')
    .replace('class="tile"', `fill="${bg}"`)
    .replace("<g ", `<g color="${fg}" `);
  document.getElementById("favicon").href = "data:image/svg+xml," + encodeURIComponent(svg);
}
// App screenshots exist for every theme (shots/<theme>/<name>.jpg); fade to the matching set once it has loaded.
function showShots(themeId) {
  document.querySelectorAll("img[data-shot]").forEach((img) => {
    const src = `shots/${themeId}/${img.dataset.shot}.jpg`;
    if (img.getAttribute("src") === src) return;
    img.classList.add("swapping");
    const pre = new Image();
    pre.onload = () => { img.src = src; img.classList.remove("swapping"); };
    pre.onerror = () => img.classList.remove("swapping");
    pre.src = src;
  });
}
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!store.get("axon.site.theme")) apply("auto"); });
host.addEventListener("click", (e) => { const b = e.target.closest(".sw"); if (b) apply(b.dataset.id); });
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => apply(b.dataset.mode)));
// Only known theme names are accepted from storage; anything else falls back to the default.
const saved = store.get("axon.site.theme");
apply(THEMES.some((t) => t.id === saved) || saved === "dark" || saved === "light" ? saved : "auto");
