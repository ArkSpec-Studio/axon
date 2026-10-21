// "Make" tools: turn materials into things to read (summaries, guides, maps...).
import { esc, escBr, md, icon } from "./ui.js";
import { gen, uid, datedEvents } from "./engine.js";
import { aiList, aiDoc, aiJSON, S } from "./brain.js";

const ul = (items) => items?.length ? `<ul>${items.map((x) => `<li>${escBr(x)}</li>`).join("")}</ul>` : "";
const plain = (s) => String(s || "").replace(/\s+/g, " ");

/* ------------------------------------------------------------------ */
const summary = {
  id: "summary", name: "Summary", group: "make", icon: "summary", kind: "doc",
  desc: "The whole thing condensed: an overview, key points and a short recap of every section.",
  defaults: { mode: "detailed" },
  options: [{ key: "mode", label: "Style", type: "select", choices: [["short", "Short"], ["detailed", "Detailed"], ["bullets", "Bullet points"]] }],
  engine: (text, o) => gen.summary(text, o.mode),
  async ai(text, o, cls, ctl) {
    const len = { short: "1-2 sentences", detailed: "3-5 sentences", bullets: "3-6 short bullet lines, each starting with '• ' and separated by newlines" }[o.mode];
    const parts = await aiDoc({
      text, ...ctl,
      build: () => ({
        prompt: `Summarize this course material section by section. For each major topic give a short heading and a summary of ${len}. Then list up to 8 key points a student must remember.`,
        schema: S.obj({ sections: S.arr(S.obj({ heading: S.str, text: S.str }), 10, 1), key_points: S.arr(S.str, 8) }),
      }),
    });
    const sections = parts.flatMap((p) => p.sections || []);
    const keys = parts.flatMap((p) => p.key_points || []);
    const top = await aiJSON({
      prompt: `Here are the key points of a student's course material:\n${keys.map((k) => "- " + k).join("\n")}\n\nWrite an "overview" (${o.mode === "short" ? "2-3" : "4-6"} sentences saying what the material covers and explaining its main ideas), the 8 most important "key_points", and a one-sentence "takeaway" stating the single most important idea. If the material covers more than one subject, give each subject its own sentence(s). Do not claim that different subjects are connected, related or "together" show anything unless the material itself says so.`,
      schema: S.obj({ overview: S.str, key_points: S.arr(S.str, 8, 3), takeaway: S.str }), maxTokens: 900, signal: ctl.signal,
    });
    return { overview: top.overview, key_points: top.key_points, takeaway: top.takeaway, sections };
  },
  render(el, { out }) {
    el.innerHTML = `<div class="doc">
      ${out.overview ? `<div class="callout"><span class="eyebrow">Overview</span>${md(out.overview)}</div>` : ""}
      ${out.key_points?.length ? `<h3>Key points</h3>${ul(out.key_points)}` : ""}
      ${out.sections?.length ? `<h3>Section by section</h3>${out.sections.map((s) => `<section class="docsec"><h4>${esc(s.heading)}</h4>${md(s.text)}</section>`).join("")}` : ""}
      ${out.takeaway ? `<div class="callout accent2"><span class="eyebrow">Takeaway</span><p>${escBr(out.takeaway)}</p></div>` : ""}
    </div>`;
  },
  speakText: (out) => [out.overview, ...(out.key_points || []), ...(out.sections || []).map((s) => `${s.heading}. ${s.text}`), out.takeaway].filter(Boolean).join(". "),
};

/* ------------------------------------------------------------------ */
const guide = {
  id: "guide", name: "Study guide", group: "make", icon: "guide", kind: "doc",
  desc: "An organized outline of every topic with the points and terms to know. Check off topics as you learn them.",
  engine: (text) => gen.guide(text),
  async ai(text, o, cls, ctl) {
    const parts = await aiDoc({
      text, ...ctl,
      build: () => ({
        prompt: "Turn this course material into a study guide outline. Group it into topics in the order they appear. For each topic: a clear heading, 3-7 bullet points of what a student must know (specific facts, explanations, cause and effect, examples), and the key terms used.",
        schema: S.obj({ sections: S.arr(S.obj({ heading: S.str, points: S.arr(S.str, 7, 1), terms: S.arr(S.str, 8) }), 10, 1) }),
      }),
    });
    return { sections: parts.flatMap((p) => p.sections || []) };
  },
  render(el, ctx) {
    const done = ctx.cls.progress.guide ||= {};
    const secs = ctx.out.sections || [];
    const n = secs.filter((s, i) => done[i]).length;
    el.innerHTML = `<div class="doc">
      <p class="muted">${n} of ${secs.length} topics checked off</p>
      <div class="bar"><i style="width:${secs.length ? (n / secs.length) * 100 : 0}%"></i></div>
      ${secs.map((s, i) => `<section class="docsec guide ${done[i] ? "done" : ""}">
        <label class="check big"><input type="checkbox" data-i="${i}" ${done[i] ? "checked" : ""}><h4>${esc(s.heading)}</h4></label>
        ${ul(s.points)}
        ${s.terms?.length ? `<div class="chips">${s.terms.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
      </section>`).join("")}
    </div>`;
    el.querySelectorAll("input[data-i]").forEach((cb) => cb.onchange = () => {
      done[cb.dataset.i] = cb.checked; if (cb.checked) ctx.activity("guide"); ctx.save(); this.render(el, ctx);
    });
  },
  speakText: (out) => (out.sections || []).map((s) => `${s.heading}. ${(s.points || []).join(". ")}`).join(". "),
};

/* ------------------------------------------------------------------ */
const cheatsheet = {
  id: "cheatsheet", name: "Cheat sheet", group: "make", icon: "cheatsheet", kind: "doc",
  desc: "One dense, printable page with only the must-know facts, formulas, terms and dates.",
  engine: (text) => gen.cheatsheet(text),
  async ai(text, o, cls, ctl) {
    const parts = await aiDoc({
      text, ...ctl,
      build: () => ({
        prompt: "Make a dense one-page cheat sheet from this course material: only the must-know facts, definitions, formulas, lists, dates and distinctions. Group items under short headings. Each item must be very short (under 20 words) and specific.",
        schema: S.obj({ sections: S.arr(S.obj({ heading: S.str, items: S.arr(S.str, 10, 1) }), 6, 1) }),
      }),
    });
    const map = new Map();
    for (const s of parts.flatMap((p) => p.sections || [])) {
      const k = s.heading.trim().toLowerCase();
      if (map.has(k)) map.get(k).items.push(...s.items); else map.set(k, { heading: s.heading, items: [...s.items] });
    }
    return { sections: [...map.values()] };
  },
  render(el, { out }) {
    el.innerHTML = `<div class="cheat">${(out.sections || []).map((s) => `<div class="cheatbox"><h4>${esc(s.heading)}</h4>${ul(s.items)}</div>`).join("")}</div>`;
  },
  speakText: (out) => (out.sections || []).map((s) => `${s.heading}. ${s.items.join(". ")}`).join(". "),
};

/* ------------------------------------------------------------------ */
const glossary = {
  id: "glossary", name: "Key terms", group: "make", icon: "glossary", kind: "list",
  desc: "A searchable glossary of every important term with a definition and example.",
  defaults: { count: 40 }, options: [{ key: "count", label: "About how many terms", type: "number", min: 5, max: 200 }],
  engine: (text) => gen.glossary(text),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "terms", perChunkMax: 15, tokensPerItem: 80, ...ctl,
    build: (n) => ({
      prompt: `List the ${n} most important terms, names and concepts in this course material. For each: the term, a clear 1-2 sentence definition based on the material, and a short example or context from the material (or "" if none).`,
      schema: S.obj({ terms: S.arr(S.obj({ term: S.str, definition: S.str, example: S.str }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    const items = (ctx.out.items || []).slice().sort((a, b) => a.term.localeCompare(b.term));
    el.innerHTML = `<div class="toolbar"><div class="searchbox">${icon("search")}<input type="search" placeholder="Search ${items.length} terms" aria-label="Search terms"></div></div><div class="gl"></div>`;
    const grid = el.querySelector(".gl");
    const draw = (q = "") => {
      q = q.toLowerCase();
      const list = items.filter((t) => !q || (t.term + " " + t.definition).toLowerCase().includes(q));
      grid.innerHTML = list.map((t) => `<div class="glc"><h4>${esc(t.term)}</h4><p>${escBr(t.definition)}</p>${t.example ? `<p class="muted small">e.g. ${esc(t.example)}</p>` : ""}</div>`).join("") || `<div class="empty">No terms match.</div>`;
    };
    el.querySelector("input").oninput = (e) => draw(e.target.value);
    draw();
  },
  speakText: (out) => (out.items || []).map((t) => `${t.term}. ${t.definition}`).join(". "),
};

/* ------------------------------------------------------------------ */
const conceptmap = {
  id: "conceptmap", name: "Concept map", group: "make", icon: "conceptmap", kind: "doc", weakOnLite: true,
  desc: "A visual map of how the big ideas connect, with the details branching off each one.",
  engine: (text, o, cls) => gen.conceptmap(text, cls.name),
  async ai(text, o, cls, ctl) {
    const parts = await aiDoc({
      text, ...ctl,
      build: () => ({
        prompt: "Build a concept map of this course material. Pick the 3-6 big ideas as branches. For each branch give 2-5 child concepts, each with a very short label (1-4 words) and a one-sentence note explaining how it connects to the branch.",
        schema: S.obj({ branches: S.arr(S.obj({ label: S.str, children: S.arr(S.obj({ label: S.str, note: S.str }), 5, 1) }), 6, 1) }),
      }),
    });
    return { center: cls.name, branches: parts.flatMap((p) => p.branches || []).slice(0, 10) };
  },
  render(el, { out }) {
    const B = (out.branches || []).slice(0, 10);
    const W = 1100, H = 760, cx = W / 2, cy = H / 2;
    const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    let svg = "";
    B.forEach((b, i) => {
      const a = (i / B.length) * Math.PI * 2 - Math.PI / 2;
      const bx = cx + Math.cos(a) * 230, by = cy + Math.sin(a) * 200;
      svg += `<line x1="${cx}" y1="${cy}" x2="${bx}" y2="${by}" class="cm-l1"/>`;
      const kids = (b.children || []).slice(0, 5);
      kids.forEach((k, j) => {
        const spread = 0.62;
        const ka = a + (kids.length > 1 ? (j / (kids.length - 1) - 0.5) * spread * 2 : 0);
        const rr = j % 2 ? 1.12 : 1; // alternate distance so neighbouring labels don't overlap
        const kx = cx + Math.cos(ka) * 370 * rr, ky = cy + Math.sin(ka) * 300 * rr;
        svg += `<line x1="${bx}" y1="${by}" x2="${kx}" y2="${ky}" class="cm-l2"/>
          <g class="cm-kid"><title>${esc(k.label)}${k.note ? " — " + esc(k.note) : ""}</title>
          <rect x="${kx - 70}" y="${ky - 15}" width="140" height="30" rx="8"/><text x="${kx}" y="${ky + 5}">${esc(trunc(k.label, 20))}</text></g>`;
      });
      svg += `<g class="cm-branch" style="--uc:var(--u${(i % 10) + 1})"><title>${esc(b.label)}</title><rect x="${bx - 88}" y="${by - 20}" width="176" height="40" rx="10"/><text x="${bx}" y="${by + 6}">${esc(trunc(b.label, 22))}</text></g>`;
    });
    svg += `<g class="cm-center"><circle cx="${cx}" cy="${cy}" r="62"/><text x="${cx}" y="${cy + 6}">${esc(trunc(out.center || "Course", 16))}</text></g>`;
    el.innerHTML = `<div class="cm-wrap"><svg viewBox="0 0 ${W} ${H}" class="cmap" role="img" aria-label="Concept map">${svg}</svg></div>
      <h3>Outline</h3><div class="doc">${B.map((b) => `<section class="docsec"><h4>${esc(b.label)}</h4>${ul((b.children || []).map((k) => k.note ? `${k.label}: ${k.note}` : k.label))}</section>`).join("")}</div>`;
  },
  speakText: (out) => (out.branches || []).map((b) => `${b.label}: ${(b.children || []).map((k) => k.label).join(", ")}`).join(". "),
};

/* ------------------------------------------------------------------ */
const timeline = {
  id: "timeline", name: "Timeline", group: "make", icon: "timeline", kind: "list",
  desc: "Every dated event in order, so you can see what happened when.",
  defaults: { count: 40 }, options: [{ key: "count", label: "Up to how many events", type: "number", min: 5, max: 150 }],
  engine: (text) => gen.timeline(text).events,
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "events", perChunkMax: 15, tokensPerItem: 70, ...ctl,
    // The date must appear in the notes on a line that also mentions the event, which catches wrong years.
    verify: (e, chunk) => {
      const year = String(e.date).match(/\d{3,4}/)?.[0];
      if (!year) return true;
      const words = String(e.event).toLowerCase().match(/[a-z]{4,}/g) || [];
      return chunk.split(/\n|(?<=[.!?])\s+/).some((line) => line.includes(year) && (!words.length || words.some((w) => line.toLowerCase().includes(w))));
    },
    build: (n, chunk) => ({
      prompt: `List up to ${n} dated events, periods or milestones that appear in this course material. Only include items with a date, year or period stated in the material. "date" is the date as written; "event" is a short title; "detail" is one sentence of context. If there are none, return an empty list.`,
      schema: S.obj({ events: S.arr(S.obj({ date: S.str, event: S.str, detail: S.str }), n, datedEvents(chunk).length ? 1 : 0) }),
    }),
  }),
  postprocess(items) {
    const yr = (d) => { const m = String(d).match(/-?\d{3,4}/); return m ? parseInt(m[0], 10) * (/BC/i.test(d) ? -1 : 1) : 99999; };
    return items.sort((a, b) => yr(a.date) - yr(b.date));
  },
  render(el, { out }) {
    const ev = out.items || [];
    el.innerHTML = ev.length ? `<ol class="tl">${ev.map((e) => `<li><span class="tl-date">${esc(e.date)}</span><div><b>${esc(e.event)}</b>${e.detail ? `<p>${escBr(e.detail)}</p>` : ""}</div></li>`).join("")}</ol>`
      : `<div class="empty">No dates were found in these materials. This tool works best with history, timelines and processes.</div>`;
  },
  speakText: (out) => (out.items || []).map((e) => `${e.date}. ${e.event}. ${e.detail || ""}`).join(". "),
};

/* ------------------------------------------------------------------ */
const compare = {
  id: "compare", name: "Compare & contrast", group: "make", icon: "compare", kind: "doc", aiBest: true, weakOnLite: true,
  desc: "Side-by-side tables for ideas that are easy to mix up.",
  engine: (text) => gen.compare(text),
  async ai(text, o, cls, ctl) {
    const parts = await aiDoc({
      text, ...ctl,
      build: () => ({
        prompt: "Find 1-3 pairs or groups of concepts in this material that students commonly confuse or are asked to compare. For each, make a comparison table: a title, the 2-3 items being compared, and 3-6 rows. Each row has an aspect (e.g. definition, cause, example, pros, cons) and one short value per item, in the same order as the items.",
        schema: S.obj({ tables: S.arr(S.obj({ title: S.str, items: S.arr(S.str, 3, 2), rows: S.arr(S.obj({ aspect: S.str, values: S.arr(S.str, 3, 2) }), 6, 2) }), 3, 1) }),
      }),
    });
    const seen = new Set();
    const key = (t) => (t.items || []).map((x) => String(x).toLowerCase().replace(/\(.*?\)|[^a-z ]/g, "").trim()).sort().join("|");
    return { tables: parts.flatMap((p) => p.tables || []).filter((t) => !seen.has(key(t)) && seen.add(key(t))) };
  },
  render(el, { out }) {
    const T = out.tables || [];
    el.innerHTML = T.length ? T.map((t) => `<div class="tbl panel"><h4>${esc(t.title)}</h4><table><thead><tr><th></th>${t.items.map((i) => `<th>${esc(i)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr><th>${esc(r.aspect)}</th>${t.items.map((_, k) => `<td>${escBr(r.values[k] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("")
      : `<div class="empty">Nothing to compare was found. Try regenerating with the AI turned on.</div>`;
  },
};

/* ------------------------------------------------------------------ */
const simplify = {
  id: "simplify", name: "Explain it simply", group: "make", icon: "simplify", kind: "doc", aiBest: true,
  desc: "Rewrites hard material in plain, everyday language with analogies.",
  defaults: { level: "plain" },
  options: [{ key: "level", label: "Level", type: "select", choices: [["kid", "Like I'm 12"], ["plain", "Plain English"], ["review", "Quick review"]] }],
  engine: (text) => gen.simplify(text),
  async ai(text, o, cls, ctl) {
    const how = { kid: "as if explaining to a curious 12-year-old, with an everyday analogy for each idea", plain: "in plain everyday English a first-year student would understand, with an analogy where it helps", review: "as a very quick plain-language refresher, 2-3 sentences per topic" }[o.level];
    const parts = await aiDoc({
      text, ...ctl, maxTokens: 3500,
      build: () => ({
        prompt: `Rewrite this course material ${how}. Keep every important idea and stay accurate; just make it easier to understand. Organize by topic with a heading each, and keep each topic under 120 words.`,
        schema: S.obj({ sections: S.arr(S.obj({ heading: S.str, simple: S.str }), 8, 1) }),
      }),
    });
    return { sections: parts.flatMap((p) => p.sections || []) };
  },
  render(el, { out }) {
    el.innerHTML = `<div class="doc">${(out.sections || []).map((s) => `<section class="docsec"><h4>${esc(s.heading)}</h4>${md(s.simple)}</section>`).join("")}</div>`;
  },
  speakText: (out) => (out.sections || []).map((s) => `${s.heading}. ${s.simple}`).join(". "),
};

/* ------------------------------------------------------------------ */
const mnemonics = {
  id: "mnemonics", name: "Memory tricks", group: "make", icon: "mnemonics", kind: "list", aiBest: true, engineOnLite: true,
  desc: "Acronyms, rhymes and memorable phrases for lists and facts that are hard to remember.",
  defaults: { count: 10 }, options: [{ key: "count", label: "How many", type: "number", min: 3, max: 40 }],
  engine: (text) => gen.mnemonics(text).mnemonics,
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "mnemonics", perChunkMax: 5, tokensPerItem: 150, ...ctl,
    // A memory trick has to actually work: an acronym must spell the items' first letters, and a
    // "first letter" sentence must contain them in order. Lists of dates and two-item lists are skipped.
    clean: (m) => {
      const items = (m.items || []).map(String).filter(Boolean);
      // Strip Markdown (**U**nconditioned) and a phrase repeated after a dash before checking.
      let dev = String(m.device).replace(/[*_`]/g, "").trim();
      const halves = dev.split(/\s+[—–-]\s+/);
      if (halves.length === 2 && halves[0].trim().toLowerCase() === halves[1].trim().toLowerCase()) dev = halves[0].trim();
      m = { ...m, device: dev };
      if (items.length < 3 || items.filter((x) => /^\s*\d/.test(x)).length >= items.length / 2) return null;
      // A "trick" that just repeats the items (or abbreviates them) isn't a memory aid.
      const itemWords = new Set(items.join(" ").toLowerCase().match(/[a-z]{3,}/g) || []);
      const devWords = String(m.device).toLowerCase().match(/[a-z]{3,}/g) || [];
      if (devWords.length && devWords.filter((w) => itemWords.has(w)).length / devWords.length > 0.6) return null;
      if ((String(m.device).match(/\b[A-Z]{2,3}\b/g) || []).length >= 3) return null;
      const initials = items.map((x) => (x.match(/[A-Za-z]/) || [""])[0].toUpperCase());
      const device = String(m.device).replace(/^[^:]{0,40}:\s*/, (h) => (/acronym|sentence|phrase|mnemonic/i.test(h) ? "" : h)).trim();
      const acro = device.match(/^[A-Z](?:[ .\-–]?[A-Z]){1,11}$/);
      if (acro) return acro[0].replace(/[^A-Z]/g, "") === initials.join("") ? m : null;
      const words = device.split(/[^A-Za-z']+/).filter(Boolean);
      const looksLikeLetterSentence = words.length >= initials.length && words.length <= initials.length + 4;
      if (!looksLikeLetterSentence) return m; // a rhyme or an image: can't be checked letter by letter
      let k = 0;
      for (const wd of words) if (k < initials.length && wd[0].toUpperCase() === initials[k]) k++;
      return k === initials.length ? m : null;
    },
    build: (n) => ({
      prompt: `Create ${n} memory devices for the hardest-to-remember lists, sequences or facts in this material. For each: the "topic", the "items" being remembered (in order), the "device" (an acronym, a memorable sentence where each word starts with the item's first letter, a rhyme, or a vivid image), and an "explanation" of how the device maps to the items.`,
      schema: S.obj({ mnemonics: S.arr(S.obj({ topic: S.str, items: S.arr(S.str, 10, 1), device: S.str, explanation: S.str }), n, 1) }),
    }),
  }),
  render(el, { out }) {
    const M = out.items || [];
    el.innerHTML = M.length ? `<div class="gl">${M.map((m) => `<div class="glc mn"><span class="eyebrow">${esc(m.topic)}</span><h4>${esc(m.device)}</h4><p>${escBr(m.explanation)}</p>${ul(m.items)}</div>`).join("")}</div>`
      : `<div class="empty">No lists were found to make memory tricks from. Turn on the AI for better results.</div>`;
  },
};

export const MAKE_TOOLS = [summary, guide, cheatsheet, glossary, conceptmap, timeline, compare, simplify, mnemonics];
export { plain, uid };
