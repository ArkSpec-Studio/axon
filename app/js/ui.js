// Small DOM helpers shared by the whole UI.
import { LOGO_INNER } from "./logo.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
// Escapes text and keeps line breaks.
// AI text sometimes contains Markdown; show **bold** as bold instead of literal asterisks.
const bold = (html) => html.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+?)__/g, "<b>$1</b>");
export const escBr = (s) => bold(esc(s)).replace(/\n/g, "<br>");
// Escapes text and renders light Markdown (bold, headings, "- " bullet lists) as HTML.
export function md(s) {
  const lines = String(s ?? "").replace(/\r/g, "").split("\n");
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${bold(esc(item[1]))}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (!line) continue;
    const head = line.match(/^#{1,6}\s+(.*)$/);
    html += head ? `<p><b>${bold(esc(head[1]))}</b></p>` : `<p>${bold(esc(line))}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function ago(ts) {
  if (!ts) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(ts).toLocaleDateString();
}

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fmtBytes = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : Math.round(n / 1e3) + " KB";
export const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;

let toastHost;
export function toast(msg, kind = "") {
  toastHost ??= document.body.appendChild(h(`<div class="toasts" role="status" aria-live="polite"></div>`));
  const t = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  toastHost.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "bad" ? 6000 : 3200);
}

// Opens a modal. `build(card, close)` fills the card. Returns a promise resolved by close(value).
export function modal(build, { wide = false, dismissable = true } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = h(`<div class="modal" role="dialog" aria-modal="true"><div class="modal-card panel ${wide ? "wide" : ""}"></div></div>`);
    const card = wrap.firstElementChild;
    const close = (v) => { wrap.remove(); document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape" && dismissable) close(undefined); };
    if (dismissable) wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(undefined); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    build(card, close);
    (card.querySelector("[autofocus]") || card.querySelector("input,textarea,button"))?.focus();
  });
}

export function confirmBox(title, body, { ok = "OK", danger = false, cancel = "Cancel" } = {}) {
  return modal((card, close) => {
    card.innerHTML = `<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="row end"><button class="btn" data-x>${esc(cancel)}</button><button class="btn ${danger ? "bad" : "primary"}" data-ok autofocus>${esc(ok)}</button></div>`;
    card.querySelector("[data-x]").onclick = () => close(false);
    card.querySelector("[data-ok]").onclick = () => close(true);
  });
}

export function promptBox(title, { label = "", value = "", placeholder = "", ok = "Save", multiline = false } = {}) {
  return modal((card, close) => {
    card.innerHTML = `<h2>${esc(title)}</h2>${label ? `<p class="muted">${esc(label)}</p>` : ""}
      ${multiline ? `<textarea class="field" rows="10" placeholder="${esc(placeholder)}" autofocus></textarea>` : `<input class="field" placeholder="${esc(placeholder)}" autofocus>`}
      <div class="row end"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button></div>`;
    const f = card.querySelector(".field");
    f.value = value;
    card.querySelector("[data-x]").onclick = () => close(null);
    card.querySelector("[data-ok]").onclick = () => close(f.value);
    if (!multiline) f.addEventListener("keydown", (e) => { if (e.key === "Enter") close(f.value); });
  });
}

/* ---------- read aloud (uses Windows' built-in voices, works offline) ---------- */
export const speech = {
  speaking: false,
  speak(text, onEnd) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, " "));
    const pref = localStorage.getItem("axon.voice");
    const v = speechSynthesis.getVoices().find((x) => x.name === pref);
    if (v) u.voice = v;
    u.rate = parseFloat(localStorage.getItem("axon.rate") || "1");
    u.onend = u.onerror = () => { this.speaking = false; onEnd?.(); };
    this.speaking = true;
    speechSynthesis.speak(u);
  },
  stop() { speechSynthesis.cancel(); this.speaking = false; },
};

/* ---------- icons ---------- */
const P = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  plus: "M12 5v14M5 12h14",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  palette: "M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15.5 15H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  chip: "M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9h6v6H9z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  text: "M4 6h16M4 12h16M4 18h10",
  x: "M6 6l12 12M18 6L6 18",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  sound: "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  stop: "M7 7h10v10H7z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  edit: "M4 20h4l10-10-4-4L4 16v4zM14 6l4 4",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  check: "M5 12l5 5 9-10",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  play: "M7 5l12 7-12 7z",
  pause: "M7 5h4v14H7zM13 5h4v14h-4z",
  menu: "M4 6h16M4 12h16M4 18h16",
  // tools
  summary: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  guide: "M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14",
  cheatsheet: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  glossary: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6",
  conceptmap: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6.5 7.5l3.2 3M17.5 7.5l-3.2 3M6.5 16.5l3.2-3M17.5 16.5l-3.2-3",
  timeline: "M12 3v18M12 6h6M12 12H6M12 18h6",
  compare: "M4 5h7v14H4zM13 5h7v14h-7zM6 9h3M15 9h3M6 13h3M15 13h3",
  simplify: "M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z",
  mnemonics: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  flashcards: "M3 6h14v14H3zM7 3h13a1 1 0 0 1 1 1v13",
  cloze: "M4 12h4M16 12h4M10 12h4M4 17h16M4 7h16",
  truefalse: "M4 12l4 4 6-8M14 14l6 6M20 14l-6 6",
  matching: "M5 6h4M5 12h4M5 18h4M15 6h4M15 12h4M15 18h4M9 6l6 6M9 12l6 6M9 18l6-12",
  ordering: "M8 6h12M8 12h12M8 18h12M4 5v2M3.5 11h1.5l-1.5 2h1.5M3.5 17h1.5v2h-1.5",
  mcq: "M5 7.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM5 13.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM5 19.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM10 6h11M10 12h11M10 18h11",
  short: "M4 20h4l10-10-4-4L4 16zM13.5 6.5l4 4",
  essay: "M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 15h7M9 19h4",
  analysis: "M4 20h4l11-11-4-4L4 16zM4 4h7M4 8h4",
  exam: "M9 4h6l1 2h3v15H5V6h3zM9 13l2 2 4-4",
  predict: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2",
  weak: "M12 3l9 16H3zM12 10v4M12 17h.01",
  explain: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  ask: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M9 9a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.3",
  planner: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0",
  focus: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M10 2h4",
  progress: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  materials: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  // class icons (drawn in the theme's colours, unlike emoji)
  "c-book": "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h13v-4M8 7h7M8 10.5h5",
  "c-flask": "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9",
  "c-calc": "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 6.5h8v3.5H8zM8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01",
  "c-globe": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9M12 3c-2.5 2.7-3.8 5.7-3.8 9s1.3 6.3 3.8 9",
  "c-landmark": "M3 21h18M4 9.5h16M12 3l8 4.5H4zM6.5 9.5V18M10.2 9.5V18M13.8 9.5V18M17.5 9.5V18M4 18h16",
  "c-dna": "M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9M8.5 6h7M8.5 18h7M10 12h4",
  "c-laptop": "M5 5h14v10H5zM2.5 19h19M10 8.5 8 10.5l2 2M14 8.5l2 2-2 2",
  "c-palette": "M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15.5 15H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  "c-music": "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  "c-scale": "M12 3v18M8 21h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  "c-chart": "M4 4v16h16M7.5 15l4-4.5 3 3 5-6",
  "c-steth": "M6 3H5v6a4 4 0 0 0 8 0V3h-1M9 13v2a5 5 0 0 0 10 0v-2M19 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  "c-speech": "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  "c-pencil": "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  "c-telescope": "M3 14l13-6 2 4-13 6zM9 16l-2 5M12 14.5l2 6.5M16 8l2.5-1.2 2 4L18 12",
  "c-brain": "M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1.5V6a2 2 0 0 0-3-1.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1.5V6a2 2 0 0 1 3-1.5z",
};
export const icon = (name, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.file}"/></svg>`;

export const LOGO = `<svg class="logo" viewBox="0 0 40 40" aria-hidden="true">${LOGO_INNER}</svg>`;
