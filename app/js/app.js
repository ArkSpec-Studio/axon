// AXON app shell: sidebar, classes, materials, tool tabs, background jobs and settings.
import { $, $$, esc, escBr, h, icon, LOGO, toast, modal, confirmBox, promptBox, ago, today, fmtBytes, plural, speech } from "./ui.js";
import { uid, wordCount } from "./engine.js";
import { ai, initAI, aiCleanOCR } from "./brain.js";
import { MAKE_TOOLS } from "./tools-make.js";
import { PRACTICE_TOOLS } from "./tools-practice.js";
import { STUDY_TOOLS, focusState, streak } from "./tools-study.js";
import { defaultTheme, setCurrent, themeStudio } from "./theme.js";

const api = window.axon;
const WEB = api.platform === "web"; // running as the browser version (see web/axon-web.js)
const TOOLS = [...MAKE_TOOLS, ...PRACTICE_TOOLS, ...STUDY_TOOLS];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
const GROUPS = [
  ["make", "Make study material", "Turn your materials into things to read and review."],
  ["practice", "Practice", "Questions and cards you answer. Mistakes go to Weak spots."],
  ["exam", "Exam prep", "Get ready for test day."],
  ["study", "Study tools", "Plan, focus, ask and track."],
];
const SUGGESTED = ["summary", "flashcards", "mcq", "short", "exam"];
// Class colours are theme colour slots (not fixed hex), so every class fits whatever theme is on.
const COLORS = [["u1", "Accent"], ["u2", "Secondary"], ["u3", "Highlight"], ["u4", "Green"], ["u5", "Alert"], ["u7", "Blend 1"], ["u8", "Blend 2"], ["u9", "Blend 3"], ["u10", "Soft accent"]];
const ICONS = ["book", "flask", "calc", "globe", "landmark", "dna", "laptop", "palette", "music", "scale", "chart", "steth", "speech", "pencil", "telescope", "brain"];
const OLD_EMOJI = { "📘": "book", "🧪": "flask", "🧮": "calc", "🌍": "globe", "🏛️": "landmark", "🧬": "dna", "💻": "laptop", "🎨": "palette", "🎵": "music", "⚖️": "scale", "📈": "chart", "🩺": "steth", "🗣️": "speech", "✏️": "pencil", "🔭": "telescope", "🧠": "brain" };
// Classes made before this change stored an emoji and a hex colour; read them as the matching icon and the accent.
const ccol = (c) => `var(--${COLORS.some(([k]) => k === c) ? c : "u1"})`;
const cicon = (i) => ICONS.includes(i) ? i : OLD_EMOJI[i] || "book";
const cic = (i) => icon("c-" + cicon(i));

const state = {
  settings: null,
  classes: [],          // metadata list for the sidebar
  cache: new Map(),     // id -> full class
  view: { name: "home" }, // { name: "home" } | { name: "class", id, tab }
  mem: new Map(),       // per class+tool UI memory for this session
  keyHandler: null,
};

/* ================================================================== */
/* persistence                                                         */
const saveTimers = new Map();
function saveClassSoon(cls, delay = 500) {
  clearTimeout(saveTimers.get(cls.id));
  saveTimers.set(cls.id, setTimeout(() => saveClassNow(cls), delay));
}
async function saveClassNow(cls) {
  clearTimeout(saveTimers.get(cls.id));
  await api.store.saveClass(cls);
  const meta = state.classes.find((c) => c.id === cls.id);
  const m = { id: cls.id, name: cls.name, color: cls.color, icon: cls.icon, order: cls.order, createdAt: cls.createdAt, updatedAt: Date.now(), materialCount: cls.materials.length, tools: cls.tools };
  if (meta) Object.assign(meta, m); else state.classes.push(m);
}
const saveSettings = () => api.store.saveSettings(state.settings);

async function getClass(id) {
  if (!state.cache.has(id)) {
    const c = await api.store.getClass(id);
    if (!c) return null;
    c.progress ||= {}; c.progress.items ||= {}; c.progress.days ||= {}; c.progress.srs ||= {}; c.progress.exams ||= [];
    c.outputs ||= {}; c.toolOpts ||= {}; c.tools ||= []; c.materials ||= [];
    state.cache.set(id, c);
  }
  return state.cache.get(id);
}

function newClass({ name, color, icon: ic }) {
  return {
    id: uid(), name, color, icon: ic, createdAt: Date.now(), order: Date.now(),
    tools: [], toolOpts: {}, materials: [], outputs: {},
    progress: { items: {}, days: {}, srs: {}, exams: [] }, planner: { exams: [], done: {} }, askHistory: [],
  };
}

const materialText = (mats) => mats.map((m) => `# ${m.name}\n${m.text}`).join("\n\n");

/* ================================================================== */
/* AI readiness                                                        */
function aiWhenReady(timeout = 180000) {
  if (!ai.settings.enabled || !ai.installed()) return Promise.resolve(false);
  if (ai.ready()) return Promise.resolve(true);
  if (ai.status.state !== "loading") api.ai.load(ai.settings.model);
  return new Promise((res) => {
    const fn = () => {
      if (ai.ready()) { done(true); } else if (ai.status.state === "error") done(false);
    };
    const done = (v) => { clearTimeout(t); ai.listeners.delete(fn); res(v); };
    const t = setTimeout(() => done(ai.ready()), timeout);
    ai.listeners.add(fn);
  });
}

/* ================================================================== */
/* background jobs (tool generation)                                   */
const jobs = [];
let jobChain = Promise.resolve();
function drawJobs() {
  const host = $("#jobs");
  const [j, ...rest] = jobs;
  host.innerHTML = j ? `<div class="job panel">
    <div class="job-top"><b>${esc(j.label)}</b><button class="btn icon sm" data-cancel title="Cancel this one">${icon("x")}</button></div>
    <div class="muted small">${esc(j.note)}</div><div class="progress"><i style="width:${Math.round(j.p * 100)}%"></i></div>
    ${rest.length ? `<div class="job-top"><span class="muted small">${plural(rest.length, "more tool")} waiting: ${esc(rest.slice(0, 3).map((x) => x.label.split(" · ")[0]).join(", "))}${rest.length > 3 ? "…" : ""}</span><button class="linkbtn small" data-cancelall>Cancel all</button></div>` : ""}</div>` : "";
  host.querySelector("[data-cancel]")?.addEventListener("click", () => j.ctrl.abort());
  host.querySelector("[data-cancelall]")?.addEventListener("click", () => jobs.forEach((x) => x.ctrl.abort()));
}
function enqueue(label, fn) {
  const j = { id: uid(), label, note: "Waiting…", p: 0, ctrl: new AbortController() };
  jobs.push(j); drawJobs();
  const run = async () => {
    if (j.ctrl.signal.aborted) return;
    j.note = "Starting…"; drawJobs();
    try { await fn({ signal: j.ctrl.signal, onProgress: (p, note) => { j.p = p; j.note = note || j.note; drawJobs(); } }); }
    catch (e) { if (e.name === "AbortError") toast(`Cancelled: ${label}`); else { console.error(e); toast(`${label} failed: ${e.message}`, "bad"); } }
    finally { jobs.splice(jobs.indexOf(j), 1); drawJobs(); }
  };
  const p = jobChain.then(run);
  jobChain = p.catch(() => {});
  return p;
}

const busy = new Set(); // "classId:toolId" currently generating
function runTool(cls, toolId, { materialIds = null, append = false } = {}) {
  const tool = TOOL[toolId];
  if (!tool || tool.kind === "live") return Promise.resolve();
  const key = cls.id + ":" + toolId;
  busy.add(key);
  if (isShowing(cls.id, toolId)) renderMain();
  return enqueue(`${tool.name} · ${cls.name}`, async (ctl) => {
    const mats = cls.materials.filter((m) => !materialIds || materialIds.includes(m.id));
    if (!mats.length) throw new Error("Add some materials first.");
    const text = materialText(mats);
    const opts = { ...(tool.defaults || {}), ...(cls.toolOpts[toolId] || {}) };
    ctl.onProgress(0.02, ai.settings.enabled && ai.installed() && !ai.ready() ? "Waking up the AI…" : "Reading your materials…");
    // Failsafe: tools the Lite model can't do reliably use the built-in engine instead.
    const useAI = !!tool.ai && (await aiWhenReady()) && !(tool.engineOnLite && ai.status.loaded === "lite");
    let data = null, by = "engine";
    if (useAI) {
      data = await tool.ai(text, opts, cls, ctl);
      by = ai.status.loaded;
      const empty = tool.kind === "list" ? !(Array.isArray(data) ? data : data?.items)?.length : !data;
      if (empty) { data = null; by = "engine"; }
    }
    if (!data) data = tool.engine(text, opts, cls);
    if (tool.kind === "list") {
      let items = (Array.isArray(data) ? data : data.items || []).map((x) => ({ ...x, id: x.id || uid() }));
      if (append && cls.outputs[toolId]?.items) items = cls.outputs[toolId].items.concat(items);
      if (tool.postprocess) items = tool.postprocess(items);
      data = { items };
    }
    const prevIds = append ? cls.outputs[toolId]?.materialIds || [] : [];
    cls.outputs[toolId] = { ...data, generatedAt: Date.now(), by, materialIds: [...new Set([...prevIds, ...mats.map((m) => m.id)])] };
    state.mem.delete(cls.id + ":" + toolId); // old card order / positions point at replaced items
    await saveClassNow(cls);
    const n = tool.kind === "list" ? data.items.length : null;
    if (jobs.length <= 1) toast(`${tool.name} ready${n != null ? ` · ${n} items` : ""}${by === "engine" && tool.ai ? " (built-in engine)" : ""}`, "good");
  }).finally(() => { busy.delete(key); if (isShowing(cls.id)) renderMain(); });
}
const isShowing = (cid, tid) => state.view.name === "class" && state.view.id === cid && (!tid || state.view.tab === tid);

/* ================================================================== */
/* sidebar                                                             */
function renderSidebar() {
  const sb = $("#sidebar");
  const v = state.view;
  const aiChip = aiChipHTML();
  sb.innerHTML = `<div class="brand">${LOGO}<div><div class="brand-name">AXON</div><div class="brand-sub">study engine</div></div></div>
    <nav class="side-nav">
      <button class="side-item ${v.name === "home" ? "on" : ""}" data-home>${icon("home")} Home</button>
      <div class="side-label">Classes</div>
      <div class="side-classes">${state.classes.map((c) => `<button class="side-item cls ${v.name === "class" && v.id === c.id ? "on" : ""}" data-cls="${c.id}" style="--cc:${ccol(c.color)}"><span class="cdot">${cic(c.icon)}</span><span class="cname">${esc(c.name)}</span></button>`).join("")}</div>
      <button class="side-item add" data-new>${icon("plus")} New class</button>
    </nav>
    <div class="side-bottom">
      ${focusState.running ? `<button class="side-item focuschip" data-focus>${icon("focus")} <span class="ftime">${Math.floor(focusState.left / 60)}:${String(focusState.left % 60).padStart(2, "0")}</span> ${focusState.mode === "focus" ? "focus" : "break"}</button>` : ""}
      <button class="side-item aichip" data-ai>${aiChip}</button>
      <button class="side-item" data-theme>${icon("palette")} Appearance</button>
      <button class="side-item" data-settings>${icon("gear")} Settings</button>
    </div>`;
  sb.querySelectorAll(".side-item").forEach((b) => b.addEventListener("click", closeNav));
  sb.querySelector("[data-home]").onclick = () => go({ name: "home" });
  sb.querySelectorAll("[data-cls]").forEach((b) => b.onclick = () => go({ name: "class", id: b.dataset.cls }));
  sb.querySelector("[data-new]").onclick = newClassWizard;
  sb.querySelector("[data-ai]").onclick = () => openSettings("ai");
  sb.querySelector("[data-theme]").onclick = openTheme;
  sb.querySelector("[data-settings]").onclick = () => openSettings();
  sb.querySelector("[data-focus]")?.addEventListener("click", () => { if (focusState.classId) go({ name: "class", id: focusState.classId, tab: "focus" }); });
}
function aiChipHTML() {
  const s = ai.status;
  const dl = s.downloads?.[0];
  let dot = "off", txt = "AI: set up";
  if (!ai.settings.enabled) { txt = "AI: off"; }
  else if (dl) { dot = "load"; txt = `Downloading ${Math.round((dl.downloaded / (dl.total || 1)) * 100)}%`; }
  else if (s.state === "loading") { dot = "load"; txt = "AI: starting…"; }
  else if (s.state === "busy") { dot = "busy"; txt = "AI: working…"; }
  else if (s.state === "ready") { dot = "on"; txt = `AI: ${ai.catalog.find((m) => m.id === s.loaded)?.name || "ready"}`; }
  else if (s.state === "error") { dot = "err"; txt = "AI: error"; }
  else if (ai.installed()) { txt = "AI: idle"; }
  return `<span class="aidot ${dot}"></span> ${esc(txt)}`;
}
focusState.listeners.add(() => {
  const ft = $(".ftime");
  if (ft) ft.textContent = `${Math.floor(focusState.left / 60)}:${String(focusState.left % 60).padStart(2, "0")}`;
  if (!!ft !== focusState.running) renderSidebar();
});

/* phone menu (the sidebar slides in on small screens) */
function closeNav() { document.documentElement.classList.remove("nav-open"); $("#menuBtn")?.setAttribute("aria-expanded", "false"); }
$("#menuBtn")?.addEventListener("click", () => {
  const open = document.documentElement.classList.toggle("nav-open");
  $("#menuBtn").setAttribute("aria-expanded", String(open));
});
$("#navScrim")?.addEventListener("click", closeNav);

/* ================================================================== */
/* routing                                                             */
async function go(view) {
  speech.stop();
  if (view.name === "class") {
    const cls = await getClass(view.id);
    if (!cls) { toast("That class couldn't be opened.", "bad"); return go({ name: "home" }); }
    view.tab ||= state.mem.get("lastTab:" + cls.id) || (cls.tools[0] || "materials");
    if (view.tab !== "materials" && !cls.tools.includes(view.tab)) view.tab = cls.tools[0] || "materials";
    state.mem.set("lastTab:" + cls.id, view.tab);
  }
  state.view = view;
  const title = $("#mbTitle");
  if (title) title.textContent = view.name === "class" ? state.cache.get(view.id)?.name || "AXON" : "AXON";
  renderSidebar();
  renderMain();
}

function renderMain() {
  state.keyHandler = null;
  const main = $("#main");
  if (state.view.name === "home") return renderHome(main);
  renderClass(main, state.cache.get(state.view.id));
}

/* ================================================================== */
/* home                                                                */
function renderHome(main) {
  const hr = new Date().getHours();
  const hello = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const needAI = ai.settings.enabled && !ai.status.installed?.length && !ai.status.downloads?.length;
  if (needAI) api.ai.status().then((st) => { ai.status = st; if (st.installed?.length && state.view.name === "home") renderMain(); });
  main.innerHTML = `<div class="wrap">
    <div class="hero"><span class="eyebrow">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span><h1>${hello}.</h1>
      <p class="muted">${state.classes.length ? `You have ${plural(state.classes.length, "class", "classes")}. Pick one to keep studying.` : "Create your first class, add your course materials, and choose what AXON should make from them."}</p></div>
    ${needAI ? `<div class="banner panel"><div>${icon("chip")}</div><div><b>Set up your private AI</b><p class="muted small">${WEB
        ? "One-time download (about 1 GB) into this browser. It runs on your device: no account, no cost, and your notes never leave it. Needs a recent phone or computer; AXON also works without it, using its built-in engine."
        : "One-time download (about 2.5 GB). After that it runs on this PC: no account, no API key, no cost, and your notes never leave your computer. AXON also works without it, using its built-in engine."}</p></div><button class="btn primary" data-setup>Set up AI</button></div>` : ""}
    <div class="cards">
      ${state.classes.map((c) => `<button class="ccard panel" data-cls="${c.id}" style="--cc:${ccol(c.color)}"><span class="ccard-ic">${cic(c.icon)}</span><b>${esc(c.name)}</b>
        <span class="muted small">${plural(c.materialCount, "material")} · ${plural(c.tools.length, "tool")}</span><span class="muted small">Updated ${ago(c.updatedAt)}</span></button>`).join("")}
      <button class="ccard panel newcard" data-new>${icon("plus")}<b>New class</b><span class="muted small">Add materials from any course</span></button>
    </div></div>`;
  main.querySelector("[data-setup]")?.addEventListener("click", () => openSettings("ai"));
  main.querySelectorAll("[data-cls]").forEach((b) => b.onclick = () => go({ name: "class", id: b.dataset.cls }));
  main.querySelector("[data-new]").onclick = newClassWizard;
}

/* ================================================================== */
/* class view                                                          */
function renderClass(main, cls) {
  const tab = state.view.tab;
  const tabs = [["materials", "Materials", "materials"], ...cls.tools.map((t) => [t, TOOL[t].name, TOOL[t].icon])];
  main.innerHTML = `<div class="classhead" style="--cc:${ccol(cls.color)}">
      <div class="ctitle"><span class="cbig">${cic(cls.icon)}</span><div><h1>${esc(cls.name)}</h1><span class="muted small">${plural(cls.materials.length, "material")} · ${plural(cls.tools.length, "tool")}</span></div></div>
      <div class="row"><button class="btn sm" data-edit>${icon("edit")} Edit class</button></div></div>
    <nav class="tabs" role="tablist">${tabs.map(([id, name, ic]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${tab === id}">${icon(ic)}<span>${esc(name)}</span>${busy.has(cls.id + ":" + id) ? `<span class="spinner"></span>` : ""}</button>`).join("")}
      <button class="tab addtab" data-addtool title="Add more tools to this class">${icon("plus")}<span>Add tool</span></button></nav>
    <div class="wrap view" id="view"></div>`;
  main.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { state.view.tab = b.dataset.tab; state.mem.set("lastTab:" + cls.id, b.dataset.tab); speech.stop(); renderMain(); });
  main.querySelector("[data-addtool]").onclick = () => addToolsDialog(cls);
  main.querySelector("[data-edit]").onclick = () => editClassDialog(cls);
  const view = $("#view");
  if (tab === "materials") renderMaterials(view, cls);
  else renderTool(view, cls, TOOL[tab]);
  main.querySelector(`[data-tab="${tab}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function ctxFor(cls, tool) {
  const memKey = cls.id + ":" + tool.id;
  if (!state.mem.has(memKey)) state.mem.set(memKey, {});
  return {
    cls, tool, toolId: tool.id, out: cls.outputs[tool.id] || {}, mem: state.mem.get(memKey), allTools: TOOLS,
    opts: { ...(tool.defaults || {}), ...(cls.toolOpts[tool.id] || {}) },
    save: () => saveClassSoon(cls, 150), saveSoon: () => saveClassSoon(cls, 1200),
    aiReady: () => ai.ready(), aiInstalled: () => ai.installed(),
    text: () => materialText(cls.materials),
    record(id, ok, toolId = tool.id) {
      const k = `${toolId}:${id}`, r = cls.progress.items[k] ||= { r: 0, w: 0 };
      if (ok) r.r++; else r.w++;
      r.last = ok; r.at = Date.now();
      this.activity("answer");
    },
    activity(kind, minutes = 0) {
      const d = cls.progress.days[today()] ||= { n: 0, min: 0 };
      d.n++; d.min += minutes;
      saveClassSoon(cls);
    },
    speak: (text) => speech.speak(text),
    keys: (fn) => { state.keyHandler = fn; },
    openTool: (id) => { if (cls.tools.includes(id)) { state.view.tab = id; renderMain(); } else toast(`Add “${TOOL[id]?.name}” with + Add tool first.`); },
    confirm: (t, b) => confirmBox(t, b, { ok: "Reset", danger: true }),
  };
}

function renderTool(view, cls, tool) {
  const out = cls.outputs[tool.id];
  const generating = busy.has(cls.id + ":" + tool.id);
  const ctx = ctxFor(cls, tool);
  if (tool.id === "focus") focusState.classId = cls.id;
  const by = out?.by === "engine" ? "built-in engine" : out?.by ? `AI (${ai.catalog.find((m) => m.id === out.by)?.name || out.by})` : "";
  const fromN = out?.materialIds?.length;
  view.innerHTML = `<div class="toolhead">
      <div><h2>${icon(tool.icon)} ${esc(tool.name)}</h2><p class="muted small">${esc(tool.desc)}${out?.generatedAt ? `<br>Made ${ago(out.generatedAt)} by the ${esc(by)} from ${plural(fromN || 0, "material")}.` : ""}</p></div>
      <div class="row toolacts">
        ${out && tool.speakText ? `<button class="btn sm" data-say>${icon(speech.speaking ? "stop" : "sound")} Read aloud</button>` : ""}
        ${out && tool.kind !== "live" ? `<button class="btn sm" data-pdf>${icon("download")} PDF</button>` : ""}
        ${out && tool.exportAnki ? `<button class="btn sm" data-anki>${icon("download")} Anki</button>` : ""}
        ${tool.options?.length ? `<button class="btn sm" data-opts>${icon("sliders")} Options</button>` : ""}
        ${out && tool.kind !== "live" ? `<button class="btn sm" data-regen ${generating ? "disabled" : ""}>${icon("refresh")} Regenerate</button>` : ""}
        <button class="btn sm ghost" data-remove title="Remove this tab">${icon("x")}</button>
      </div></div>
    ${out && out.by === "lite" && tool.weakOnLite ? `<div class="notice">${icon("chip")} Made by the Lite AI, which is weaker at this tool. For better results, switch to Standard or Pro in <button class="linkbtn" data-setup>Settings → AI model</button>, then press Regenerate.</div>` : ""}
    ${out && out.by === "engine" && tool.aiBest ? (tool.engineOnLite && ai.status.loaded === "lite"
      ? `<div class="notice">${icon("chip")} The Lite AI isn't reliable at this tool, so AXON used its built-in engine. For AI-made results, switch to Standard or Pro in <button class="linkbtn" data-setup>Settings → AI model</button>, then press Regenerate.</div>`
      : `<div class="notice">${icon("chip")} This tool works much better with the AI. <button class="linkbtn" data-setup>Set up the AI</button> then press Regenerate.</div>`) : ""}
    <div class="toolbody" id="toolbody"></div>`;
  const body = $("#toolbody");
  view.querySelector("[data-remove]").onclick = async () => {
    if (!(await confirmBox(`Remove ${tool.name}?`, "The tab is removed. What it made is kept, so adding it back later restores it instantly.", { ok: "Remove" }))) return;
    cls.tools = cls.tools.filter((t) => t !== tool.id);
    state.view.tab = cls.tools[0] || "materials";
    await saveClassNow(cls); renderSidebar(); renderMain();
  };
  view.querySelector("[data-opts]")?.addEventListener("click", () => toolOptionsDialog(cls, tool));
  view.querySelector("[data-regen]")?.addEventListener("click", () => runTool(cls, tool.id));
  view.querySelector("[data-setup]")?.addEventListener("click", () => openSettings("ai"));
  view.querySelector("[data-pdf]")?.addEventListener("click", async () => {
    document.body.classList.add("printing");
    if (tool.printHTML) body.innerHTML = tool.printHTML(out); // a full printable list instead of the interactive view
    try { const p = await api.exporter.pdf({ defaultName: `${cls.name} - ${tool.name}.pdf` }); if (p) toast("PDF saved."); }
    finally { document.body.classList.remove("printing"); if (tool.printHTML) renderMain(); }
  });
  view.querySelector("[data-anki]")?.addEventListener("click", async () => {
    const p = await api.exporter.save({ defaultName: `${cls.name} flashcards.txt`, content: tool.exportAnki(out), filters: [{ name: "Anki import (tab-separated)", extensions: ["txt"] }] });
    if (p) toast("Saved. In Anki: File → Import, and pick this file.");
  });
  const say = view.querySelector("[data-say]");
  say?.addEventListener("click", () => {
    if (speech.speaking) { speech.stop(); say.innerHTML = `${icon("sound")} Read aloud`; return; }
    speech.speak(tool.speakText(out), () => { if (say.isConnected) say.innerHTML = `${icon("sound")} Read aloud`; });
    say.innerHTML = `${icon("stop")} Stop`;
  });

  if (tool.kind === "live") return tool.render(body, ctx);
  if (generating && !out) {
    body.innerHTML = `<div class="empty"><span class="spinner big"></span><p><b>Making your ${esc(tool.name.toLowerCase())}…</b></p><p class="muted small">You can keep using the rest of the app. Progress is shown in the corner.</p></div>`;
    return;
  }
  if (!out) {
    body.innerHTML = cls.materials.length
      ? `<div class="empty"><p>Nothing here yet.</p><button class="btn primary" data-make>Make ${esc(tool.name.toLowerCase())}</button></div>`
      : `<div class="empty"><p>Add materials to this class first.</p><button class="btn primary" data-mats>Go to materials</button></div>`;
    body.querySelector("[data-make]")?.addEventListener("click", () => runTool(cls, tool.id));
    body.querySelector("[data-mats]")?.addEventListener("click", () => { state.view.tab = "materials"; renderMain(); });
    return;
  }
  const isEmpty = tool.kind === "list" ? !out.items?.length : false;
  if (isEmpty) {
    body.innerHTML = `<div class="empty"><p>AXON couldn't find enough in these materials for this tool.</p><p class="muted small">${ai.ready() ? "Try adding more materials." : "Setting up the AI usually fixes this."}</p><button class="btn" data-regen2>Try again</button></div>`;
    body.querySelector("[data-regen2]").onclick = () => runTool(cls, tool.id);
    return;
  }
  tool.render(body, ctx);
}

/* ================================================================== */
/* materials                                                           */
const KIND_ICON = { pdf: "📄", docx: "📝", pptx: "📊", xlsx: "📊", csv: "📊", tsv: "📊", image: "🖼️", web: "🔗", paste: "📋", txt: "📃", md: "📃", rtf: "📝", html: "🔗", htm: "🔗" };

function materialAdder(onAdd) {
  // Returns a drop zone + buttons that call onAdd(results[]) with imported materials.
  const el = h(`<div class="adder">
    <div class="drop" tabindex="0">${icon("upload")}<b>${WEB ? "Tap to add files or take a photo" : "Drop files here"}</b><span class="muted small">${WEB ? "PDF, Word, PowerPoint, Excel, text, or photos of notes" : "PDF, Word, PowerPoint, text, web pages, or photos of notes"}</span></div>
    <div class="row center wrap">
      <button class="btn primary" data-files>${icon("file")} Choose files</button>
      ${WEB ? "" : `<button class="btn" data-link>${icon("link")} Add a web link</button>`}
      <button class="btn" data-paste>${icon("text")} Paste text</button>
    </div><div class="addstatus muted small"></div></div>`);
  const status = el.querySelector(".addstatus");
  const handle = async (promise, label) => {
    status.innerHTML = `<span class="spinner"></span> ${esc(label)}`;
    try {
      const res = await promise;
      const ok = res.filter((r) => r.ok), bad = res.filter((r) => !r.ok);
      bad.forEach((b) => toast(`${b.name}: ${b.error}`, "bad"));
      // Text read from photos/scans: let the AI fix recognition mistakes when it's available.
      const fromPhotos = ok.filter((r) => r.ocr);
      if (fromPhotos.length && ai.ready()) {
        status.innerHTML = `<span class="spinner"></span> Fixing text read from ${plural(fromPhotos.length, "photo")}…`;
        for (const r of fromPhotos) { r.text = await aiCleanOCR(r.text).catch(() => r.text); r.words = wordCount(r.text); }
      }
      status.textContent = ok.length ? `Added ${plural(ok.length, "file")} (${ok.reduce((a, r) => a + r.words, 0).toLocaleString()} words).` : "";
      if (fromPhotos.length) toast("Text read from photos or scans can contain mistakes. Check it with “View / fix text”.");
      if (ok.length) onAdd(ok.map((r) => ({ id: uid(), name: r.name, kind: r.kind, text: r.text, words: r.words, source: r.source, ocr: !!r.ocr, addedAt: Date.now() })));
    } catch (e) { status.textContent = ""; toast(e.message, "bad"); }
  };
  el.querySelector("[data-files]").onclick = () => handle(api.importer.pick(), "Reading files… (photos take a few seconds each)");
  if (el.querySelector("[data-link]")) el.querySelector("[data-link]").onclick = async () => {
    const url = await promptBox("Add a web page", { label: "Paste the address of an article, notes page, Wikipedia page, or online PDF.", placeholder: "https://…", ok: "Add" });
    if (url?.trim()) handle(api.importer.url(url.trim()).then((r) => [r]), "Downloading page…");
  };
  el.querySelector("[data-paste]").onclick = async () => {
    const text = await promptBox("Paste text", { label: "Paste notes, a reading, lecture transcript, or anything else.", multiline: true, ok: "Add" });
    if (!text?.trim()) return;
    const name = (await promptBox("Name this material", { value: text.trim().split("\n")[0].slice(0, 60), ok: "Add" })) || "Pasted notes";
    onAdd([{ id: uid(), name, kind: "paste", text: text.trim(), words: wordCount(text), addedAt: Date.now() }]);
  };
  const drop = el.querySelector(".drop");
  drop.onclick = () => el.querySelector("[data-files]").click();
  drop.onkeydown = (e) => { if (e.key === "Enter") el.querySelector("[data-files]").click(); };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const paths = [...e.dataTransfer.files].map((f) => api.importer.pathFor(f)).filter(Boolean);
    if (paths.length) handle(api.importer.paths(paths), `Reading ${plural(paths.length, "file")}…`);
  };
  return el;
}

function renderMaterials(view, cls) {
  view.innerHTML = `<div class="toolhead"><div><h2>${icon("materials")} Materials</h2><p class="muted small">Everything AXON studies from. Add more any time; you'll be asked which tools to update.</p></div></div>
    <div class="adderhost"></div>
    <div class="mats">${cls.materials.map((m) => `<div class="mat panel" data-id="${m.id}"><span class="mk">${KIND_ICON[m.kind] || "📃"}</span>
      <div class="mname"><b>${esc(m.name)}</b><span class="muted small">${m.words.toLocaleString()} words · added ${ago(m.addedAt)}${m.ocr ? ` · <span class="warn">read from a photo or scan: check the text</span>` : ""}</span></div>
      <div class="row"><button class="btn sm" data-view>View / fix text</button><button class="btn sm" data-rename>Rename</button><button class="btn icon sm bad" data-del title="Delete">${icon("trash")}</button></div></div>`).join("")
      || `<div class="empty">No materials yet. Add your syllabus, notes, slides, readings or study guides.</div>`}</div>`;
  view.querySelector(".adderhost").appendChild(materialAdder((mats) => addMaterials(cls, mats)));
  view.querySelectorAll(".mat").forEach((row) => {
    const m = cls.materials.find((x) => x.id === row.dataset.id);
    row.querySelector("[data-view]").onclick = () => viewMaterial(cls, m);
    row.querySelector("[data-rename]").onclick = async () => { const n = await promptBox("Rename material", { value: m.name }); if (n?.trim()) { m.name = n.trim(); await saveClassNow(cls); renderMain(); } };
    row.querySelector("[data-del]").onclick = async () => {
      if (!(await confirmBox(`Delete “${m.name}”?`, "It's removed from this class. Tools made from it keep their current content until you regenerate them.", { ok: "Delete", danger: true }))) return;
      cls.materials = cls.materials.filter((x) => x !== m); await saveClassNow(cls); renderMain();
    };
  });
}

function viewMaterial(cls, m) {
  modal((card, close) => {
    card.innerHTML = `<div class="mhead"><h2>${esc(m.name)}</h2><button class="btn icon" data-x>✕</button></div>
      <p class="muted small">Fix any text that came out wrong (for example from a photo). Changes are used next time you regenerate a tool.</p>
      <textarea class="field mono" rows="22">${esc(m.text)}</textarea>
      <div class="row end"><button class="btn" data-x2>Close</button><button class="btn primary" data-save>Save changes</button></div>`;
    card.querySelector("[data-x]").onclick = card.querySelector("[data-x2]").onclick = () => close();
    card.querySelector("[data-save]").onclick = async () => {
      m.text = card.querySelector("textarea").value; m.words = wordCount(m.text);
      await saveClassNow(cls); close(); toast("Saved."); renderMain();
    };
  }, { wide: true });
}

async function addMaterials(cls, mats) {
  cls.materials.push(...mats);
  await saveClassNow(cls);
  renderSidebar(); renderMain();
  const made = cls.tools.filter((t) => TOOL[t].kind !== "live" && cls.outputs[t]);
  const never = cls.tools.filter((t) => TOOL[t].kind !== "live" && !cls.outputs[t]);
  never.forEach((t) => runTool(cls, t));
  if (!made.length) return;
  const pickTools = await modal((card, close) => {
    card.innerHTML = `<h2>Update your tools?</h2><p class="muted">You added ${plural(mats.length, "new material")}. Choose which tools should include ${mats.length === 1 ? "it" : "them"}:</p>
      <div class="checklist">${made.map((t) => `<label class="check big"><input type="checkbox" value="${t}" checked> ${icon(TOOL[t].icon)} ${esc(TOOL[t].name)} <span class="muted small">${TOOL[t].kind === "list" ? "adds new items, keeps your progress" : "rebuilds with everything"}</span></label>`).join("")}</div>
      <div class="row end"><button class="btn" data-no>Not now</button><button class="btn primary" data-yes>Update selected</button></div>`;
    card.querySelector("[data-no]").onclick = () => close([]);
    card.querySelector("[data-yes]").onclick = () => close($$("input:checked", card).map((i) => i.value));
  });
  for (const t of pickTools || []) {
    if (TOOL[t].kind === "list") runTool(cls, t, { materialIds: mats.map((m) => m.id), append: true });
    else runTool(cls, t);
  }
}

/* ================================================================== */
/* tool picker                                                         */
function toolPicker(selected, already = new Set()) {
  const el = h(`<div class="picker">${GROUPS.map(([g, name, sub]) => `<div class="pgroup"><h3>${esc(name)}</h3><p class="muted small">${esc(sub)}</p>
    <div class="pgrid">${TOOLS.filter((t) => t.group === g).map((t) => `<label class="pcard ${already.has(t.id) ? "have" : ""}">
      <input type="checkbox" value="${t.id}" ${selected.has(t.id) || already.has(t.id) ? "checked" : ""} ${already.has(t.id) ? "disabled" : ""}>
      <span class="pic">${icon(t.icon)}</span><span class="ptxt"><b>${esc(t.name)}</b><span class="muted small">${already.has(t.id) ? "Already added" : esc(t.desc)}</span></span></label>`).join("")}</div></div>`).join("")}</div>`);
  el.querySelectorAll("input").forEach((i) => i.onchange = () => { if (i.checked) selected.add(i.value); else selected.delete(i.value); el.dispatchEvent(new Event("pick")); });
  return el;
}

function aiLine() {
  if (ai.ready()) return `${icon("chip")} Your AI (${esc(ai.catalog.find((m) => m.id === ai.status.loaded)?.name)}) will make these.`;
  if (ai.settings.enabled && ai.installed()) return `${icon("chip")} Your AI is starting up and will make these.`;
  return `${icon("chip")} The built-in engine will make these now. <button class="linkbtn" data-setup>Set up the AI</button> for much smarter results.`;
}

async function addToolsDialog(cls) {
  const selected = new Set();
  const picked = await modal((card, close) => {
    card.innerHTML = `<div class="mhead"><h2>Add tools to ${esc(cls.name)}</h2><button class="btn icon" data-x>✕</button></div>
      <p class="muted">Pick what you want. Each one becomes a new tab.</p><div class="ph"></div>
      <div class="mfoot"><span class="muted small ailine">${aiLine()}</span><button class="btn primary" data-ok disabled>Add tools</button></div>`;
    const pk = toolPicker(selected, new Set(cls.tools));
    card.querySelector(".ph").appendChild(pk);
    const ok = card.querySelector("[data-ok]");
    pk.addEventListener("pick", () => { ok.disabled = !selected.size; ok.textContent = selected.size ? `Add ${plural(selected.size, "tool")}` : "Add tools"; });
    card.querySelector("[data-x]").onclick = () => close(null);
    card.querySelector("[data-setup]")?.addEventListener("click", () => { close(null); openSettings("ai"); });
    ok.onclick = () => close([...selected]);
  }, { wide: true });
  if (!picked?.length) return;
  const order = TOOLS.map((t) => t.id);
  cls.tools = [...cls.tools, ...picked].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  await saveClassNow(cls);
  state.view.tab = picked[0];
  renderSidebar(); renderMain();
  for (const t of picked) if (TOOL[t].kind !== "live" && !cls.outputs[t] && cls.materials.length) runTool(cls, t);
}

function toolOptionsDialog(cls, tool) {
  const cur = { ...(tool.defaults || {}), ...(cls.toolOpts[tool.id] || {}) };
  modal((card, close) => {
    card.innerHTML = `<h2>${esc(tool.name)} options</h2>
      ${tool.options.map((o) => `<label class="flabel">${esc(o.label)}${o.type === "number" ? `<input class="field" type="number" data-k="${o.key}" min="${o.min}" max="${o.max}" value="${cur[o.key]}">` : `<select class="sel" data-k="${o.key}">${o.choices.map(([v, n]) => `<option value="${v}" ${cur[o.key] === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`}</label>`).join("")}
      <p class="muted small">Regenerating replaces what's there now (your progress on old items is kept).</p>
      <div class="row end"><button class="btn" data-x>Cancel</button><button class="btn" data-save>Save</button>${cls.materials.length ? `<button class="btn primary" data-regen>Save & regenerate</button>` : ""}</div>`;
    const read = () => {
      const o = {};
      card.querySelectorAll("[data-k]").forEach((f) => {
        const spec = tool.options.find((x) => x.key === f.dataset.k);
        o[f.dataset.k] = spec.type === "number" ? Math.max(spec.min, Math.min(spec.max, parseInt(f.value, 10) || spec.min)) : f.value;
      });
      cls.toolOpts[tool.id] = o;
    };
    card.querySelector("[data-x]").onclick = () => close();
    card.querySelector("[data-save]").onclick = async () => { read(); await saveClassNow(cls); close(); };
    card.querySelector("[data-regen]")?.addEventListener("click", async () => { read(); await saveClassNow(cls); close(); runTool(cls, tool.id); });
  });
}

/* ================================================================== */
/* new class wizard                                                    */
function newClassWizard() {
  const draft = { name: "", color: COLORS[state.classes.length % COLORS.length][0], icon: ICONS[state.classes.length % ICONS.length], materials: [] };
  const selected = new Set();
  let step = 1;
  modal((card, close) => {
    const draw = () => {
      card.innerHTML = `<div class="mhead"><div><span class="eyebrow">New class · step ${step} of 3</span><h2>${["Name your class", "Add your materials", "What should AXON make?"][step - 1]}</h2></div><button class="btn icon" data-x aria-label="Close">✕</button></div>
        <div class="steps3">${[1, 2, 3].map((n) => `<i class="${n <= step ? "on" : ""}"></i>`).join("")}</div><div class="wbody"></div><div class="mfoot"></div>`;
      card.querySelector("[data-x]").onclick = () => close();
      const body = card.querySelector(".wbody"), foot = card.querySelector(".mfoot");
      if (step === 1) {
        body.innerHTML = `<label class="flabel">Class name<input class="field big" data-name placeholder="e.g. Biology 101, AP US History, Intro to Psychology" value="${esc(draft.name)}" autofocus maxlength="60"></label>
          <div class="flabel">Icon<div class="iconpick">${ICONS.map((i) => `<button class="ipick ${i === draft.icon ? "on" : ""}" data-i="${i}" aria-label="${i}">${cic(i)}</button>`).join("")}</div></div>
          <div class="flabel">Color<div class="iconpick">${COLORS.map(([c, n]) => `<button class="cpick ${c === draft.color ? "on" : ""}" data-c="${c}" style="background:${ccol(c)}" aria-label="${n}" title="${n}"></button>`).join("")}</div></div>`;
        foot.innerHTML = `<span></span><button class="btn primary" data-next>Next</button>`;
        const name = body.querySelector("[data-name]");
        name.oninput = () => draft.name = name.value;
        name.onkeydown = (e) => { if (e.key === "Enter") foot.querySelector("[data-next]").click(); };
        body.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => { draft.icon = b.dataset.i; draw(); });
        body.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => { draft.color = b.dataset.c; draw(); });
        foot.querySelector("[data-next]").onclick = () => { if (!draft.name.trim()) { name.focus(); toast("Give your class a name."); return; } step = 2; draw(); };
        setTimeout(() => name.focus(), 30);
      } else if (step === 2) {
        body.appendChild(materialAdder((mats) => { draft.materials.push(...mats); draw(); }));
        body.insertAdjacentHTML("beforeend", `<div class="mats compact">${draft.materials.map((m, i) => `<div class="mat"><span class="mk">${KIND_ICON[m.kind] || "📃"}</span><div class="mname"><b>${esc(m.name)}</b><span class="muted small">${m.words.toLocaleString()} words</span></div><button class="btn icon sm" data-rm="${i}" title="Remove">${icon("x")}</button></div>`).join("")}</div>`);
        body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { draft.materials.splice(+b.dataset.rm, 1); draw(); });
        foot.innerHTML = `<button class="btn" data-back>Back</button><span class="grow"></span>${draft.materials.length ? "" : `<button class="btn ghost" data-skip>Skip for now</button>`}<button class="btn primary" data-next ${draft.materials.length ? "" : "disabled"}>Next</button>`;
        foot.querySelector("[data-back]").onclick = () => { step = 1; draw(); };
        foot.querySelector("[data-skip]")?.addEventListener("click", () => { step = 3; draw(); });
        foot.querySelector("[data-next]").onclick = () => { step = 3; draw(); };
      } else {
        body.innerHTML = `<p class="muted">Nothing is selected yet. Pick only what you want; you can add more tools later from the <b>+ Add tool</b> tab.</p>
          <div class="row"><button class="btn sm" data-sugg>Pick a good starter set</button><button class="btn sm ghost" data-none>Clear</button></div>`;
        const pk = toolPicker(selected);
        body.appendChild(pk);
        foot.innerHTML = `<button class="btn" data-back>Back</button><span class="muted small ailine grow">${aiLine()}</span><button class="btn primary" data-create>Create class</button>`;
        const create = foot.querySelector("[data-create]");
        const upd = () => create.textContent = selected.size ? `Create class with ${plural(selected.size, "tool")}` : "Create class";
        pk.addEventListener("pick", upd); upd();
        body.querySelector("[data-sugg]").onclick = () => { SUGGESTED.forEach((s) => selected.add(s)); pk.querySelectorAll("input").forEach((i) => i.checked = selected.has(i.value)); upd(); };
        body.querySelector("[data-none]").onclick = () => { selected.clear(); pk.querySelectorAll("input").forEach((i) => i.checked = false); upd(); };
        foot.querySelector("[data-setup]")?.addEventListener("click", () => openSettings("ai"));
        foot.querySelector("[data-back]").onclick = () => { step = 2; draw(); };
        create.onclick = async () => {
          const cls = newClass({ name: draft.name.trim(), color: draft.color, icon: draft.icon });
          cls.materials = draft.materials;
          const order = TOOLS.map((t) => t.id);
          cls.tools = [...selected].sort((a, b) => order.indexOf(a) - order.indexOf(b));
          state.cache.set(cls.id, cls);
          await saveClassNow(cls);
          close();
          await go({ name: "class", id: cls.id, tab: cls.tools[0] || "materials" });
          for (const t of cls.tools) if (TOOL[t].kind !== "live" && cls.materials.length) runTool(cls, t);
        };
      }
    };
    draw();
  }, { wide: true, dismissable: false });
}

function editClassDialog(cls) {
  modal((card, close) => {
    card.innerHTML = `<div class="mhead"><h2>Edit class</h2><button class="btn icon" data-x>✕</button></div>
      <label class="flabel">Name<input class="field" data-name value="${esc(cls.name)}" maxlength="60"></label>
      <div class="flabel">Icon<div class="iconpick">${ICONS.map((i) => `<button class="ipick ${i === cicon(cls.icon) ? "on" : ""}" data-i="${i}" aria-label="${i}">${cic(i)}</button>`).join("")}</div></div>
      <div class="flabel">Color<div class="iconpick">${COLORS.map(([c, n]) => `<button class="cpick ${`var(--${c})` === ccol(cls.color) ? "on" : ""}" data-c="${c}" style="background:${ccol(c)}" aria-label="${n}" title="${n}"></button>`).join("")}</div></div>
      <div class="row between"><button class="btn bad" data-del>${icon("trash")} Delete class</button><button class="btn primary" data-save>Save</button></div>`;
    let ic = cicon(cls.icon), col = COLORS.some(([k]) => k === cls.color) ? cls.color : "u1";
    card.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => { ic = b.dataset.i; card.querySelectorAll("[data-i]").forEach((x) => x.classList.toggle("on", x === b)); });
    card.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => { col = b.dataset.c; card.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); });
    card.querySelector("[data-x]").onclick = () => close();
    card.querySelector("[data-save]").onclick = async () => {
      cls.name = card.querySelector("[data-name]").value.trim() || cls.name; cls.icon = ic; cls.color = col;
      await saveClassNow(cls); close(); renderSidebar(); renderMain();
    };
    card.querySelector("[data-del]").onclick = async () => {
      close();
      if (!(await confirmBox(`Delete ${cls.name}?`, "This permanently deletes the class, its materials, everything AXON made, and your progress. Make a backup first if you might want it back (Settings → Data).", { ok: "Delete forever", danger: true }))) return;
      await api.store.deleteClass(cls.id);
      state.cache.delete(cls.id);
      state.classes = state.classes.filter((c) => c.id !== cls.id);
      go({ name: "home" });
    };
  });
}

/* ================================================================== */
/* appearance & settings                                               */
function openTheme() {
  modal((card, close) => themeStudio(card, close, state.settings.theme, saveSettings), { wide: true });
}

function openSettings(tab = "ai") {
  modal((card, close) => {
    let cur = tab;
    const unsub = () => ai.listeners.delete(onAI);
    const onAI = () => { if (!card.isConnected) return unsub(); if (cur === "ai") draw(); };
    ai.listeners.add(onAI);
    const draw = () => {
      card.innerHTML = `<div class="mhead"><h2>Settings</h2><button class="btn icon" data-x>✕</button></div>
        <div class="seg">${[["ai", "AI model"], ["voice", "Read aloud"], ["data", "Your data"], ["about", "About"]].map(([k, n]) => `<button data-t="${k}" aria-pressed="${cur === k}">${n}</button>`).join("")}</div>
        <div class="sbody"></div>`;
      card.querySelector("[data-x]").onclick = () => { unsub(); close(); };
      card.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { cur = b.dataset.t; draw(); });
      const body = card.querySelector(".sbody");
      ({ ai: settingsAI, voice: settingsVoice, data: settingsData, about: settingsAbout })[cur](body, draw);
    };
    draw();
    // Re-check which models are on disk before trusting the buttons (Download vs Use this).
    api.ai.status().then((st) => { ai.status = st; if (card.isConnected && cur === "ai") draw(); });
  }, { wide: true });
}

function settingsAI(body, redraw) {
  const s = ai.status, set = ai.settings;
  const gpu = { cuda: "NVIDIA GPU (CUDA)", vulkan: "GPU (Vulkan)", metal: "GPU (Metal)", cpu: "CPU only", false: "CPU only" }[String(s.gpu)] || "";
  body.innerHTML = `<div class="notice">${icon("chip")} <div>The AI downloads <b>once</b> (needs internet). After that it runs entirely on ${WEB ? "this device, inside your browser" : "this PC"}: <b>no account, no API key, no cost per use</b>, and your materials never leave ${WEB ? "your device" : "your computer"}.${WEB && s.gpu === false ? "<br><b>This browser or device can't run the AI</b> (it needs WebGPU: try a recent version of Chrome, Edge or Safari, or a newer device). Every tool still works with AXON's built-in engine." : ""}</div></div>
    <label class="check big"><input type="checkbox" data-en ${set.enabled ? "checked" : ""}> Use the AI to make tools and grade answers</label>
    <p class="muted small">Status: <b>${esc(aiChipHTML().replace(/<[^>]+>/g, "").trim())}</b>${gpu ? ` · running on ${esc(gpu)}` : ""}${s.error ? `<br><span class="badc">${esc(s.error)}</span>` : ""}</p>
    <div class="models">${ai.catalog.map((m) => {
      const inst = s.installed?.includes(m.id), dl = s.downloads?.find((d) => d.id === m.id), active = set.model === m.id;
      return `<div class="model panel ${active ? "on" : ""}"><div class="mtop"><b>${esc(m.name)}</b>${m.recommended ? `<span class="tag">Recommended</span>` : ""}${active && inst ? `<span class="tag good">In use</span>` : ""}</div>
        <span class="muted small">${esc(m.model)} · ${esc(m.size)} · ${esc(m.needs)}</span><p class="small">${esc(m.blurb)}</p>
        ${dl ? `<div class="progress"><i style="width:${Math.round((dl.downloaded / (dl.total || 1)) * 100)}%"></i></div><div class="row"><span class="small">${fmtBytes(dl.downloaded)} of ${fmtBytes(dl.total)}</span><button class="btn sm" data-cancel="${m.id}">Cancel</button></div>`
          : inst ? `<div class="row">${active ? "" : `<button class="btn sm primary" data-use="${m.id}">Use this</button>`}<button class="btn sm ghost" data-del="${m.id}">Delete</button></div>`
          : `<button class="btn sm ${m.recommended ? "primary" : ""}" data-dl="${m.id}">${icon("download")} Download ${esc(m.size)}</button>`}</div>`;
    }).join("")}</div>
    <p class="muted small">${WEB
        ? "Models are open-source Qwen3 (Apache 2.0 license), run in your browser with WebLLM. On a phone pick Phone; on a computer with a graphics card, Computer is smarter. The download stays in this browser."
        : "Models are open-source Qwen3 (Apache 2.0 license) from Hugging Face, run with llama.cpp. Your PC: pick Standard, or Pro if you have a good graphics card."}</p>`;
  body.querySelector("[data-en]").onchange = async (e) => {
    set.enabled = e.target.checked; await saveSettings();
    if (set.enabled && ai.installed()) api.ai.load(set.model); else if (!set.enabled) api.ai.unload();
    renderSidebar(); redraw();
  };
  body.querySelectorAll("[data-dl]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.dl;
    if (!ai.installed(set.model)) { set.model = id; await saveSettings(); }
    api.ai.download(id).then((st) => { if (st) ai.status = st; if (body.isConnected) redraw(); });
    setTimeout(redraw, 300);
  });
  body.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = () => api.ai.cancelDownload(b.dataset.cancel));
  body.querySelectorAll("[data-use]").forEach((b) => b.onclick = async () => { set.model = b.dataset.use; await saveSettings(); if (set.enabled) api.ai.load(set.model); redraw(); });
  body.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("Delete this model?", "It frees up disk space. You can download it again any time.", { ok: "Delete", danger: true }))) return;
    await api.ai.remove(b.dataset.del); ai.status = await api.ai.status(); redraw(); renderSidebar();
  });
}

function settingsVoice(body) {
  const voices = speechSynthesis.getVoices();
  const cur = localStorage.getItem("axon.voice") || "", rate = localStorage.getItem("axon.rate") || "1";
  body.innerHTML = `<p class="muted">Read aloud uses the voices built into Windows, so it works offline.</p>
    <label class="flabel">Voice<select class="sel" data-v><option value="">Default</option>${voices.map((v) => `<option ${v.name === cur ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
    <label class="flabel">Speed <span class="small" data-rl>${rate}×</span><input type="range" min="0.6" max="1.8" step="0.1" value="${rate}" data-r></label>
    <div class="row"><button class="btn" data-test>${icon("sound")} Test voice</button></div>`;
  body.querySelector("[data-v]").onchange = (e) => localStorage.setItem("axon.voice", e.target.value);
  body.querySelector("[data-r]").oninput = (e) => { localStorage.setItem("axon.rate", e.target.value); body.querySelector("[data-rl]").textContent = e.target.value + "×"; };
  body.querySelector("[data-test]").onclick = () => speech.speak("This is how AXON will read your study material.");
  if (!voices.length) speechSynthesis.onvoiceschanged = () => settingsVoice(body);
}

function settingsData(body) {
  body.innerHTML = `<p class="muted">${WEB
        ? "Everything is saved in this browser on this device. Clearing your browser's site data deletes it, so back up anything important. Backups also move your classes to another device, or to the Windows app."
        : "Everything is saved on this PC automatically. Back up to move your classes to another computer or keep a safe copy."}</p>
    <div class="row wrap"><button class="btn primary" data-bk>${icon("download")} Back up all classes</button><button class="btn" data-rs>${icon("upload")} Restore from backup</button>${WEB ? "" : `<button class="btn ghost" data-open>${icon("folder")} Open data folder</button>`}</div>`;
  body.querySelector("[data-bk]").onclick = async () => { await Promise.all([...state.cache.values()].map(saveClassNow)); const p = await api.exporter.backup(); if (p) toast("Backup saved."); };
  body.querySelector("[data-rs]").onclick = async () => {
    try { const n = await api.exporter.restore(); if (n == null) return; state.cache.clear(); state.classes = await api.store.listClasses(); toast(`Restored ${plural(n, "class", "classes")}.`, "good"); go({ name: "home" }); }
    catch (e) { toast(e.message, "bad"); }
  };
  body.querySelector("[data-open]")?.addEventListener("click", () => api.app.openDataFolder());
}

async function settingsAbout(body) {
  const info = await api.app.info();
  body.innerHTML = `<div class="about">${LOGO}<div><b>AXON</b> version ${esc(info.version)}<br><span class="muted small">by ArkSpec Studio</span><p class="muted small">${WEB
        ? "Web version. Your materials and progress are stored only in this browser on this device. The AI runs on your device; AXON only uses the internet to load the app and to download the AI model once."
        : "Your materials and progress are stored only on this computer. The AI runs locally; AXON only uses the internet to download AI models, to read web links you add, and to fetch the text-recognition data the first time you add a photo."}</p>
    <p class="muted small">Built with ${WEB ? "WebLLM" : "Electron, llama.cpp (node-llama-cpp)"}, Qwen3 models (Apache 2.0), Tesseract.js, pdf.js, Mammoth and JSZip.</p></div></div>`;
}

/* ================================================================== */
/* boot                                                                */
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal")) return;
  state.keyHandler?.(e);
});
ai.listeners.add((evt) => {
  if (["status", "download", "downloaded", "downloadError"].includes(evt.type)) {
    const chip = $(".aichip"); if (chip) chip.innerHTML = aiChipHTML();
  }
  if (evt.type === "downloaded") {
    toast("AI model downloaded. Starting it up…", "good");
    // Start a model only if none is running: never swap out a model the student is using.
    if (ai.settings.enabled && !ai.status.loaded) api.ai.load(ai.settings.model);
    if (state.view.name === "home") renderMain();
  }
  if (evt.type === "downloadError") toast("Download failed: " + evt.error, "bad");
  if (evt.type === "status" && evt.state === "ready" && evt.prev !== "ready" && state.view.name === "home") renderMain();
});

(async function boot() {
  const s = await api.store.getSettings();
  s.theme = { ...defaultTheme(), ...(s.theme || {}) };
  s.ai = { enabled: true, model: WEB ? "lite" : "standard", ...(s.ai || {}) };
  state.settings = s;
  setCurrent(s.theme);
  await initAI(s.ai);
  state.classes = await api.store.listClasses();
  const last = localStorage.getItem("axon.lastClass");
  if (last && state.classes.some((c) => c.id === last)) await go({ name: "class", id: last });
  else await go({ name: "home" });
  window.addEventListener("beforeunload", () => {
    if (state.view.name === "class") localStorage.setItem("axon.lastClass", state.view.id); else localStorage.removeItem("axon.lastClass");
    for (const c of state.cache.values()) api.store.saveClass(c);
  });
})();
