// Themes: base light/dark/auto, HUD or Clean style, built-in presets and user-made custom themes.
import { esc, toast } from "./ui.js";
import { iconSVG } from "./logo.js";

export const KEYS = [
  ["bg", "Background"], ["panel", "Panels"], ["line", "Borders"], ["text", "Text"], ["muted", "Soft text"],
  ["accent", "Accent"], ["c2", "Highlight"], ["c3", "Secondary"], ["good", "Correct"], ["alert", "Wrong"],
];

// AXON's default look is blue. "Wrong answer" uses orange in the red themes so it doesn't blend into the accent.
const DARK = { bg: "#050b12", panel: "#0a1622", line: "#1d5468", text: "#d8f3ff", muted: "#6f97a8", accent: "#33e1ff", c2: "#ffb547", c3: "#8aa9ff", good: "#3ee0a0", alert: "#ff4d5e" };
const LIGHT = { bg: "#f3f6f9", panel: "#ffffff", line: "#c6d5e0", text: "#0f2230", muted: "#587080", accent: "#0a7fc0", c2: "#b86e00", c3: "#4b5fd6", good: "#138a5b", alert: "#d33246" };
const RED_DARK = { bg: "#0e0708", panel: "#1a0d10", line: "#5e2229", text: "#ffe9eb", muted: "#b48a8f", accent: "#ff3b4e", c2: "#ffb547", c3: "#8aa9ff", good: "#3ee0a0", alert: "#ff8a3d" };
const RED_LIGHT = { bg: "#faf4f4", panel: "#ffffff", line: "#ebcdd0", text: "#2a1013", muted: "#7d5a5e", accent: "#d0202f", c2: "#b86e00", c3: "#4b5fd6", good: "#138a5b", alert: "#d9620f" };

export const PRESETS = [
  { id: "axon-dark", name: "AXON Dark", base: "dark", colors: DARK },
  { id: "axon-light", name: "AXON Light", base: "light", colors: LIGHT },
  { id: "red-dark", name: "AXON Red Dark", base: "dark", colors: RED_DARK },
  { id: "red-light", name: "AXON Red Light", base: "light", colors: RED_LIGHT },
  { id: "violet", name: "Midnight Violet", base: "dark", colors: { bg: "#0d0a1a", panel: "#161129", line: "#3b2f6b", text: "#ece6ff", muted: "#9a8fc2", accent: "#a78bfa", c2: "#f472b6", c3: "#60a5fa", good: "#34d399", alert: "#fb7185" } },
  { id: "forest", name: "Forest", base: "dark", colors: { bg: "#0b130e", panel: "#121e16", line: "#2c4a36", text: "#e3f1e7", muted: "#8aa894", accent: "#4ade80", c2: "#facc15", c3: "#38bdf8", good: "#86efac", alert: "#f87171" } },
  { id: "ember", name: "Ember", base: "dark", colors: { bg: "#140c08", panel: "#1f140e", line: "#5a3420", text: "#fbe9dd", muted: "#b8917b", accent: "#ff8a3d", c2: "#ffd166", c3: "#f472b6", good: "#7bd88f", alert: "#ff5c5c" } },
  { id: "mono", name: "Graphite", base: "dark", colors: { bg: "#0e0e0f", panel: "#18181a", line: "#36363a", text: "#ededed", muted: "#9a9a9e", accent: "#f2f2f2", c2: "#c9c9c9", c3: "#8f8f95", good: "#a3e635", alert: "#f87171" } },
  { id: "paper", name: "Paper", base: "light", colors: { bg: "#f6f1e7", panel: "#fffaf0", line: "#dccfb6", text: "#2f2618", muted: "#7b6a50", accent: "#9a5b13", c2: "#2f6f8f", c3: "#7a4ea3", good: "#3d7d3a", alert: "#b23a3a" } },
  { id: "ocean", name: "Ocean", base: "light", colors: { bg: "#eef6fb", panel: "#ffffff", line: "#c2dbe9", text: "#0d2a3a", muted: "#4f6e80", accent: "#0077b6", c2: "#e76f51", c3: "#6a4c93", good: "#2a9d8f", alert: "#d62828" } },
  { id: "rose", name: "Rose", base: "light", colors: { bg: "#fdf2f5", panel: "#ffffff", line: "#f1c9d5", text: "#3a1622", muted: "#8d5a69", accent: "#d6336c", c2: "#7048e8", c3: "#1c7ed6", good: "#2b8a3e", alert: "#c92a2a" } },
  { id: "contrast", name: "High contrast", base: "dark", colors: { bg: "#000000", panel: "#000000", line: "#ffffff", text: "#ffffff", muted: "#e0e0e0", accent: "#ffde00", c2: "#00e5ff", c3: "#ff80ff", good: "#00ff7f", alert: "#ff5050" } },
];

export const FONTS = [
  ["tech", "Tech (Chakra Petch)"], ["clean", "Clean (Figtree)"], ["mono", "Code (JetBrains Mono)"],
  ["serif", "Bookish (Merriweather)"], ["lexend", "Easy reading (Lexend)"], ["dyslexic", "Dyslexia-friendly (OpenDyslexic)"],
];

export const defaultTheme = () => ({ base: "auto", style: "hud", preset: null, font: "tech", size: 100, glow: true, motion: true, custom: [] });

const dark = matchMedia("(prefers-color-scheme: dark)");
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

export function resolve(t) {
  const all = [...PRESETS, ...(t.custom || [])];
  const p = t.preset && all.find((x) => x.id === t.preset);
  if (p) return { base: p.base, colors: { ...(p.base === "light" ? LIGHT : DARK), ...p.colors } };
  const base = t.base === "auto" ? (dark.matches ? "dark" : "light") : t.base;
  return { base, colors: base === "light" ? LIGHT : DARK };
}

export function applyTheme(t, override) {
  const { base, colors } = override || resolve(t);
  const r = document.documentElement;
  for (const [k] of KEYS) r.style.setProperty("--" + k, colors[k]);
  r.style.setProperty("--accent-ink", lum(colors.accent) > 0.35 ? "#081018" : "#ffffff");
  r.style.colorScheme = base;
  r.dataset.base = base;
  r.dataset.style = t.style;
  r.dataset.font = t.font;
  r.dataset.glow = t.glow && t.style === "hud" ? "on" : "off";
  r.dataset.motion = t.motion ? "on" : "off";
  r.style.fontSize = (t.size || 100) + "%";
  updateWindowIcon(colors);
}

/* ---------- window / taskbar icon in the theme's colours ---------- */
let iconTimer, lastIcon = "";
function updateWindowIcon(colors) {
  const key = colors.bg + colors.accent;
  if (key === lastIcon) return;
  clearTimeout(iconTimer);
  // Debounced: live colour editing would otherwise redraw the taskbar icon on every drag.
  iconTimer = setTimeout(() => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, 0, 0, 256, 256);
      window.axon.app.setIcon(c.toDataURL("image/png"));
      lastIcon = key;
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(iconSVG(colors.bg, colors.accent));
  }, 250);
}
let currentTheme = null;
dark.addEventListener("change", () => { if (currentTheme?.base === "auto" && !currentTheme.preset) applyTheme(currentTheme); });
export const setCurrent = (t) => { currentTheme = t; applyTheme(t); };

/* ---------- theme studio ---------- */
export function themeStudio(card, close, t, save) {
  let draft = null; // colors being edited in the custom editor
  const draw = () => {
    const all = [...PRESETS, ...(t.custom || [])];
    const active = t.preset || "";
    card.innerHTML = `<div class="mhead"><h2>Appearance</h2><button class="btn icon" data-x aria-label="Close">✕</button></div>
      <div class="optrow"><span class="lab">Mode</span><div class="seg">${[["auto", "Match Windows"], ["light", "Light"], ["dark", "Dark"]].map(([k, n]) => `<button data-base="${k}" aria-pressed="${!t.preset && t.base === k}">${n}</button>`).join("")}</div></div>
      <div class="optrow"><span class="lab">Style</span><div class="seg">${[["hud", "HUD"], ["clean", "Clean"]].map(([k, n]) => `<button data-style="${k}" aria-pressed="${t.style === k}">${n}</button>`).join("")}</div>
        <label class="check"><input type="checkbox" data-glow ${t.glow ? "checked" : ""} ${t.style !== "hud" ? "disabled" : ""}> Glow</label>
        <label class="check"><input type="checkbox" data-motion ${t.motion ? "checked" : ""}> Animations</label></div>
      <div class="optrow"><span class="lab">Font</span><select class="sel" data-font>${FONTS.map(([k, n]) => `<option value="${k}" ${t.font === k ? "selected" : ""}>${n}</option>`).join("")}</select>
        <span class="lab">Text size</span><input type="range" min="85" max="135" step="5" value="${t.size}" data-size aria-label="Text size"><span class="small">${t.size}%</span></div>
      <h3>Themes</h3>
      <div class="presets">${all.map((p) => `<div class="preset" role="button" tabindex="0" data-preset="${p.id}" aria-pressed="${active === p.id}">
          <div class="sw">${["bg", "panel", "accent", "c2", "good"].map((k) => `<i style="background:${p.colors[k]}"></i>`).join("")}</div><b>${esc(p.name)}</b>
          ${p.custom ? `<span class="pacts"><button class="linkbtn" data-edit="${p.id}">edit</button><button class="linkbtn" data-share="${p.id}">share</button><button class="linkbtn badc" data-del="${p.id}">delete</button></span>` : ""}</div>`).join("")}</div>
      <div class="row"><button class="btn primary" data-new>+ Create custom theme</button><button class="btn" data-import>Import theme code</button></div>
      <div class="editor"></div>`;
    card.querySelector("[data-x]").onclick = () => close();
    card.querySelectorAll("[data-base]").forEach((b) => b.onclick = () => { t.base = b.dataset.base; t.preset = null; commit(); });
    card.querySelectorAll("[data-style]").forEach((b) => b.onclick = () => { t.style = b.dataset.style; commit(); });
    card.querySelector("[data-glow]").onchange = (e) => { t.glow = e.target.checked; commit(); };
    card.querySelector("[data-motion]").onchange = (e) => { t.motion = e.target.checked; commit(); };
    card.querySelector("[data-font]").onchange = (e) => { t.font = e.target.value; commit(); };
    const sz = card.querySelector("[data-size]");
    sz.oninput = () => { t.size = +sz.value; sz.nextElementSibling.textContent = t.size + "%"; applyTheme(t); };
    sz.onchange = () => commit();
    card.querySelectorAll("[data-preset]").forEach((b) => {
      const pickIt = (e) => { if (e.target.closest(".pacts")) return; t.preset = b.dataset.preset; commit(); };
      b.onclick = pickIt; b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickIt(e); } };
    });
    card.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openEditor(t.custom.find((c) => c.id === b.dataset.edit)));
    card.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { t.custom = t.custom.filter((c) => c.id !== b.dataset.del); if (t.preset === b.dataset.del) t.preset = null; commit(); });
    card.querySelectorAll("[data-share]").forEach((b) => b.onclick = async () => {
      const c = t.custom.find((x) => x.id === b.dataset.share);
      const code = "AXON-THEME:" + btoa(unescape(encodeURIComponent(JSON.stringify({ name: c.name, base: c.base, colors: c.colors }))));
      await navigator.clipboard.writeText(code); toast("Theme code copied. Send it to a friend!");
    });
    card.querySelector("[data-new]").onclick = () => openEditor(null);
    card.querySelector("[data-import]").onclick = () => {
      const ed = card.querySelector(".editor");
      ed.innerHTML = `<div class="panel pad"><p class="muted">Paste a theme code someone shared with you:</p><input class="field" placeholder="AXON-THEME:…"><div class="row"><button class="btn primary">Add theme</button></div></div>`;
      ed.querySelector("button").onclick = () => {
        try {
          const raw = ed.querySelector("input").value.trim().replace(/^AXON-THEME:/, "");
          const d = JSON.parse(decodeURIComponent(escape(atob(raw))));
          const colors = {};
          for (const [k] of KEYS) if (/^#[0-9a-f]{6}$/i.test(d.colors?.[k])) colors[k] = d.colors[k];
          if (Object.keys(colors).length < 5) throw 0;
          const nt = { id: "c" + Date.now().toString(36), name: String(d.name || "Shared theme").slice(0, 40), base: d.base === "light" ? "light" : "dark", colors, custom: true };
          t.custom.push(nt); t.preset = nt.id; commit();
        } catch { toast("That code isn't a valid AXON theme.", "bad"); }
      };
    };
  };
  const openEditor = (existing) => {
    const start = existing || { id: null, name: "My theme", ...resolve(t) };
    draft = { id: existing?.id, name: start.name, base: start.base, colors: { ...start.colors } };
    const ed = card.querySelector(".editor");
    ed.innerHTML = `<div class="panel pad"><h3>${existing ? "Edit theme" : "New custom theme"}</h3>
      <div class="optrow"><input class="field" data-name value="${esc(draft.name)}" aria-label="Theme name" maxlength="40">
        <div class="seg">${["dark", "light"].map((b) => `<button data-db="${b}" aria-pressed="${draft.base === b}">${b === "dark" ? "Dark" : "Light"} base</button>`).join("")}</div></div>
      <div class="colors">${KEYS.map(([k, n]) => `<label><input type="color" data-k="${k}" value="${draft.colors[k]}"> ${n}</label>`).join("")}</div>
      <p class="muted small">Changes preview live across the whole app.</p>
      <div class="row"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>Save theme</button></div></div>`;
    const preview = () => applyTheme(t, { base: draft.base, colors: draft.colors });
    ed.querySelectorAll("[data-k]").forEach((i) => i.oninput = () => { draft.colors[i.dataset.k] = i.value; preview(); });
    ed.querySelectorAll("[data-db]").forEach((b) => b.onclick = () => { draft.base = b.dataset.db; ed.querySelectorAll("[data-db]").forEach((x) => x.setAttribute("aria-pressed", x === b)); preview(); });
    ed.querySelector("[data-cancel]").onclick = () => { draft = null; applyTheme(t); ed.innerHTML = ""; };
    ed.querySelector("[data-save]").onclick = () => {
      draft.name = ed.querySelector("[data-name]").value.trim() || "My theme";
      if (draft.id) Object.assign(t.custom.find((c) => c.id === draft.id), draft);
      else { draft.id = "c" + Date.now().toString(36); t.custom.push({ ...draft, custom: true }); }
      t.preset = draft.id; draft = null; commit(); toast("Theme saved.");
    };
    preview();
    ed.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const commit = () => { applyTheme(t); save(); draw(); };
  draw();
}
