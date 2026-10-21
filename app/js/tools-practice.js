// "Practice" tools: everything you answer. Each records right/wrong so Weak spots and Progress work.
import { esc, escBr, icon, toast } from "./ui.js";
import { gen, shuffle, keywordGrade, closeEnough, wordCount, groundScore, falsify, swappedDefinitions, DEFAULT_RUBRIC } from "./engine.js";
import { ai, aiList, aiJSON, aiGrade, checkMCQ, checkTF, S } from "./brain.js";

// Small models sometimes write "A. ..." inside options or "1. ..." inside steps; that breaks shuffling or gives the answer away.
const stripLabel = (s) => String(s).replace(/^\s*(?:\(?[A-Da-d][.)]|\d+[.)])\s+/, "").trim();

const L = "ABCDEFGH";

/* ---------- written-answer grading (AI if loaded, otherwise key-point matching) ---------- */
export async function gradeWritten(ctx, { question, answer, reference, points, kind }) {
  if (ctx.aiReady()) {
    try {
      const g = await aiGrade({ question, answer, reference, points, kind });
      return { score: g.score / 10, feedback: g.feedback, got: g.got, missed: g.missed, by: ai.status.loaded === "lite" ? "the Lite AI (approximate: switch to Standard or Pro for precise grading)" : "AI" };
    } catch (e) { console.warn(e); }
  }
  const k = keywordGrade(answer, points?.length ? points : [reference]);
  return {
    score: k.score, by: "key-word check",
    got: k.points.filter((p) => p.hit).map((p) => p.point),
    missed: k.points.filter((p) => !p.hit).map((p) => p.point),
    feedback: k.score >= 0.75 ? "You covered most of the key ideas." : k.score >= 0.4 ? "You're partly there. Add the missing ideas below." : "Review the model answer and try again.",
  };
}
export const gradeHTML = (g) => `<div class="grade">
  <div><span class="gs">${Math.round(g.score * 100)}%</span><span class="muted small">graded by ${esc(g.by)}</span></div>
  <p>${escBr(g.feedback)}</p>
  ${g.got?.length ? `<div class="gh">You got</div><div class="chips">${g.got.map((x) => `<span class="chip y">${esc(x)}</span>`).join("")}</div>` : ""}
  ${g.missed?.length ? `<div class="gh">Missing</div><div class="chips">${g.missed.map((x) => `<span class="chip n">${esc(x)}</span>`).join("")}</div>` : ""}
</div>`;

/* ---------- spaced repetition (SM-2 style) ---------- */
const DAY = 86400000;
export function srsUpdate(st = { reps: 0, ef: 2.5, ivl: 0, due: 0 }, r) {
  st = { ...st };
  if (r === 1) { st.reps = 0; st.ivl = 0; st.due = Date.now() + 10 * 60000; st.ef = Math.max(1.3, st.ef - 0.2); return st; }
  st.reps += 1;
  st.ivl = st.reps === 1 ? (r === 4 ? 3 : 1) : st.reps === 2 ? (r === 2 ? 3 : r === 4 ? 7 : 4) : Math.round(st.ivl * st.ef * (r === 2 ? 0.8 : r === 4 ? 1.3 : 1));
  st.ef = Math.max(1.3, st.ef + (r === 2 ? -0.15 : r === 4 ? 0.15 : 0));
  st.due = Date.now() + st.ivl * DAY;
  return st;
}
const ivlLabel = (st, r) => { const n = srsUpdate(st, r); return r === 1 ? "10 min" : n.ivl === 1 ? "1 day" : `${n.ivl} days`; };

/* ================================================================== */
const flashcards = {
  id: "flashcards", name: "Flashcards", group: "practice", icon: "flashcards", kind: "list",
  desc: "Cards with spaced repetition: AXON schedules each card right before you'd forget it.",
  defaults: { count: 30 }, options: [{ key: "count", label: "How many cards", type: "number", min: 5, max: 300 }],
  engine: (text, o) => gen.flashcards(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "cards", perChunkMax: 14, tokensPerItem: 95, ...ctl,
    build: (n) => ({
      prompt: `Create exactly ${n} flashcards from this course material. "front": a term, concept or question. "back": a complete, accurate answer in 1-3 sentences using the material's wording where possible. "keywords": 2-5 words or short phrases that a correct answer must mention. Cover the most important, testable ideas; no duplicates; nothing about the document itself.`,
      schema: S.obj({ cards: S.arr(S.obj({ front: S.str, back: S.str, keywords: S.arr(S.str, 5, 1) }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    const cards = ctx.out.items || [];
    const srs = ctx.cls.progress.srs ||= {};
    const m = ctx.mem;
    m.mode ??= "review";
    const due = cards.filter((c) => (srs[c.id]?.due || 0) <= Date.now());
    const mastered = cards.filter((c) => (srs[c.id]?.ivl || 0) >= 21).length;
    const deck = m.mode === "review" ? due : m.order ? m.order.map((id) => cards.find((c) => c.id === id)).filter(Boolean) : cards;
    m.i = Math.min(m.i || 0, Math.max(0, deck.length - 1));

    el.innerHTML = `<div class="toolbar">
        <div class="seg" role="group" aria-label="Mode">
          <button data-mode="review" aria-pressed="${m.mode === "review"}">Review due <span class="count">${due.length}</span></button>
          <button data-mode="learn" aria-pressed="${m.mode === "learn"}">Browse all</button>
          <button data-mode="test" aria-pressed="${m.mode === "test"}">Type answers</button>
          <button data-mode="edit" aria-pressed="${m.mode === "edit"}">Edit cards</button>
        </div>
        ${m.mode !== "review" && m.mode !== "edit" ? `<button class="btn sm" data-shuffle>Shuffle</button>` : ""}
        <span class="muted small">${cards.length} cards · ${mastered} mastered</span>
      </div><div class="fc-host"></div>`;
    el.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { m.mode = b.dataset.mode; m.i = 0; m.flip = false; this.render(el, ctx); });
    el.querySelector("[data-shuffle]")?.addEventListener("click", () => { m.order = shuffle(cards).map((c) => c.id); m.i = 0; this.render(el, ctx); });
    const host = el.querySelector(".fc-host");

    if (m.mode === "edit") return this.renderEdit(host, ctx, el);
    if (!deck.length) {
      const next = cards.map((c) => srs[c.id]?.due || 0).filter((d) => d > Date.now()).sort()[0];
      host.innerHTML = `<div class="empty"><b>All caught up!</b><br>${next ? `Next card is due ${new Date(next).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : ""}<br><br><button class="btn" data-learn>Browse all cards anyway</button></div>`;
      host.querySelector("[data-learn]").onclick = () => { m.mode = "learn"; this.render(el, ctx); };
      return;
    }
    const c = deck[m.i];
    const st = srs[c.id];
    host.innerHTML = `<div class="progress"><i style="width:${((m.i) / deck.length) * 100}%"></i></div>
      <div class="fc panel">
        <div class="fc-meta"><span>${m.i + 1} / ${deck.length}</span>${st ? `<span class="muted small">${st.ivl >= 21 ? "Mastered" : st.reps ? `Seen ${st.reps}×` : "Learning"}</span>` : `<span class="muted small">New</span>`}
          <button class="btn icon sm" data-say title="Read aloud">${icon("sound")}</button></div>
        <h2 class="q">${escBr(c.front)}</h2>
        ${m.mode === "test" ? `<textarea class="ruled" placeholder="Type your answer, then press Check (Ctrl+Enter)"></textarea>` : ""}
        <div class="ans" ${m.flip ? "" : "hidden"}><span class="lab">Answer</span><div class="txt">${escBr(c.back)}</div></div>
        <div class="fb"></div>
        <div class="fc-acts"></div>
      </div>
      <p class="muted small">Space flips the card. In review, 1–4 rate it. Arrow keys move between cards.</p>`;
    const acts = host.querySelector(".fc-acts");
    host.querySelector("[data-say]").onclick = () => ctx.speak(m.flip ? `${c.front}. ${c.back}` : c.front);
    const go = (d) => { m.i = Math.max(0, Math.min(deck.length - 1, m.i + d)); m.flip = false; this.render(el, ctx); };

    const showRate = () => {
      acts.innerHTML = [1, 2, 3, 4].map((r) => `<button class="btn rate r${r}" data-r="${r}"><b>${["Again", "Hard", "Good", "Easy"][r - 1]}</b><span>${ivlLabel(st, r)}</span></button>`).join("");
      acts.querySelectorAll("[data-r]").forEach((b) => b.onclick = () => rate(+b.dataset.r));
    };
    const rate = (r) => {
      srs[c.id] = srsUpdate(st, r);
      ctx.record(c.id, r >= 3);
      m.flip = false;
      if (m.mode === "review") { /* deck shrinks as due cards are rated */ } else m.i = Math.min(deck.length - 1, m.i + 1);
      ctx.save(); this.render(el, ctx);
    };
    const flip = () => { m.flip = true; host.querySelector(".ans").hidden = false; if (m.mode === "review") showRate(); else navBtns(); };
    const navBtns = () => {
      acts.innerHTML = `<button class="btn" data-prev ${m.i === 0 ? "disabled" : ""}>Previous</button>
        ${!m.flip ? `<button class="btn primary" data-flip>${m.mode === "test" ? "Check" : "Show answer"}</button>` : ""}
        <button class="btn ${m.flip ? "primary" : ""}" data-next ${m.i >= deck.length - 1 ? "disabled" : ""}>Next</button>`;
      acts.querySelector("[data-prev]").onclick = () => go(-1);
      acts.querySelector("[data-next]").onclick = () => go(1);
      acts.querySelector("[data-flip]")?.addEventListener("click", () => m.mode === "test" ? check() : flip());
    };
    const check = async () => {
      const ta = host.querySelector("textarea");
      if (!ta.value.trim()) { ta.focus(); return; }
      flip();
      const fb = host.querySelector(".fb");
      fb.innerHTML = `<p class="thinking">Checking…</p>`;
      const g = await gradeWritten(ctx, { question: c.front, answer: ta.value, reference: c.back, points: c.keywords, kind: "answer" });
      fb.innerHTML = gradeHTML(g);
      ctx.record(c.id, g.score >= 0.6);
      srs[c.id] = srsUpdate(st, g.score >= 0.85 ? 4 : g.score >= 0.6 ? 3 : g.score >= 0.35 ? 2 : 1);
      ctx.save();
    };
    if (m.flip) { if (m.mode === "review") showRate(); else navBtns(); } else if (m.mode === "review") {
      acts.innerHTML = `<button class="btn primary wide" data-flip>Show answer</button>`;
      acts.querySelector("[data-flip]").onclick = flip;
    } else navBtns();
    host.querySelector("textarea")?.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) check(); });
    ctx.keys((e) => {
      if (e.target.closest("textarea,input")) return;
      if (e.key === " ") { e.preventDefault(); if (!m.flip) (m.mode === "test" ? host.querySelector("textarea").focus() : flip()); }
      else if (m.mode === "review" && m.flip && /^[1-4]$/.test(e.key)) rate(+e.key);
      else if (e.key === "ArrowRight" && m.mode !== "review") go(1);
      else if (e.key === "ArrowLeft" && m.mode !== "review") go(-1);
    });
  },
  renderEdit(host, ctx, el) {
    const cards = ctx.out.items;
    host.innerHTML = `<div class="row"><button class="btn primary" data-add>${icon("plus")} Add a card</button></div>
      <div class="editlist">${cards.map((c, i) => `<div class="editrow panel" data-i="${i}">
        <textarea class="field" data-f="front" rows="2" aria-label="Front">${esc(c.front)}</textarea>
        <textarea class="field" data-f="back" rows="2" aria-label="Back">${esc(c.back)}</textarea>
        <button class="btn icon bad" data-del title="Delete card">${icon("trash")}</button></div>`).join("")}</div>`;
    host.querySelectorAll(".editrow").forEach((row) => {
      const c = cards[+row.dataset.i];
      row.querySelectorAll("textarea").forEach((t) => t.onchange = () => { c[t.dataset.f] = t.value; if (t.dataset.f === "back") c.keywords = []; ctx.save(); });
      row.querySelector("[data-del]").onclick = () => { cards.splice(+row.dataset.i, 1); ctx.save(); this.render(el, ctx); };
    });
    host.querySelector("[data-add]").onclick = () => { cards.unshift({ id: crypto.randomUUID().slice(0, 12), front: "New card", back: "Answer", keywords: [] }); ctx.save(); this.render(el, ctx); };
  },
  printHTML: (out) => `<div class="printlist">${(out.items || []).map((c, i) => `<div class="pcardp"><b>${i + 1}. ${escBr(c.front)}</b><p>${escBr(c.back)}</p></div>`).join("")}</div>`,
  exportAnki: (out) => (out.items || []).map((c) => `${c.front.replace(/\t|\n/g, " ")}\t${c.back.replace(/\t/g, " ").replace(/\n/g, "<br>")}`).join("\n"),
};

/* ================================================================== */
// Single-question renderers, reused by the tools, Weak spots and the Practice exam.
export const ITEM = {
  mcq(item, onAnswer) {
    const el = document.createElement("div");
    el.className = "qbox";
    el.innerHTML = `<p class="qt">${escBr(item.question)}</p><div class="opts">${item.options.map((o, i) => `<button class="opt" data-i="${i}"><span class="L">${L[i]}</span><span>${escBr(o)}</span></button>`).join("")}</div><div class="exp" hidden></div>`;
    el.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
      const pick = +b.dataset.i, ok = pick === item.answer;
      el.querySelectorAll(".opt").forEach((x, i) => { x.disabled = true; if (i === item.answer) x.classList.add("correct"); else if (i === pick) x.classList.add("wrong"); });
      const ex = el.querySelector(".exp"); ex.hidden = false;
      ex.innerHTML = `<b class="${ok ? "good" : "badc"}">${ok ? "Correct." : `Not quite. The answer is ${L[item.answer]}.`}</b> ${escBr(item.explanation || "")}`;
      onAnswer?.(ok);
    });
    return el;
  },
  truefalse(item, onAnswer) {
    const el = document.createElement("div");
    el.className = "qbox";
    el.innerHTML = `<p class="qt">${escBr(item.statement)}</p><div class="row"><button class="opt tf" data-v="1">True</button><button class="opt tf" data-v="0">False</button></div><div class="exp" hidden></div>`;
    el.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
      const v = b.dataset.v === "1", ok = v === !!item.isTrue;
      el.querySelectorAll(".opt").forEach((x) => { x.disabled = true; const xv = x.dataset.v === "1"; if (xv === !!item.isTrue) x.classList.add("correct"); else if (x === b) x.classList.add("wrong"); });
      const ex = el.querySelector(".exp"); ex.hidden = false;
      ex.innerHTML = `<b class="${ok ? "good" : "badc"}">${ok ? "Correct." : `It's ${item.isTrue ? "true" : "false"}.`}</b> ${escBr(item.explanation || "")}`;
      onAnswer?.(ok);
    });
    return el;
  },
  cloze(item, onAnswer) {
    const el = document.createElement("div");
    el.className = "qbox";
    const parts = String(item.text).split(/_{3,}/);
    el.innerHTML = `<p class="qt cloze">${esc(parts[0])}<input class="blank" aria-label="Blank" spellcheck="false">${esc(parts.slice(1).join("_____"))}</p>
      <div class="row"><button class="btn sm primary" data-c>Check</button><button class="btn sm" data-h>Hint</button><button class="btn sm" data-s>Show answer</button></div><div class="exp" hidden></div>`;
    const inp = el.querySelector("input"), ex = el.querySelector(".exp");
    let done = false;
    const finish = (ok, shown) => {
      if (done) return; done = true;
      inp.disabled = true; inp.classList.add(ok ? "correct" : "wrong");
      ex.hidden = false; ex.innerHTML = `<b class="${ok ? "good" : "badc"}">${ok ? "Correct." : `Answer: ${esc(item.answer)}`}</b>`;
      el.querySelectorAll("button").forEach((b) => b.disabled = true);
      onAnswer?.(ok && !shown);
    };
    el.querySelector("[data-c]").onclick = () => inp.value.trim() ? finish(closeEnough(inp.value, item.answer)) : inp.focus();
    el.querySelector("[data-h]").onclick = () => { ex.hidden = false; ex.textContent = "Hint: " + (item.hint || `starts with “${item.answer[0]}”`); };
    el.querySelector("[data-s]").onclick = () => finish(false, true);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") el.querySelector("[data-c]").click(); });
    inp.style.width = Math.max(6, String(item.answer).length + 2) + "ch";
    return el;
  },
  short(item, onAnswer, ctx) {
    const el = document.createElement("div");
    el.className = "qbox";
    el.innerHTML = `<p class="qt">${escBr(item.question)}</p><textarea class="ruled" placeholder="Write your answer…"></textarea>
      <div class="row"><button class="btn primary sm" data-g>Grade my answer</button><button class="btn sm" data-m>Show model answer</button><span class="muted small wc"></span></div>
      <div class="fb"></div><div class="ans" hidden><span class="lab">Model answer</span><div class="txt">${escBr(item.model_answer)}</div></div>`;
    const ta = el.querySelector("textarea");
    ta.oninput = () => el.querySelector(".wc").textContent = wordCount(ta.value) + " words";
    el.querySelector("[data-m]").onclick = () => el.querySelector(".ans").hidden = false;
    el.querySelector("[data-g]").onclick = async (e) => {
      if (!ta.value.trim()) return ta.focus();
      e.target.disabled = true;
      el.querySelector(".fb").innerHTML = `<p class="thinking">Grading…</p>`;
      const g = await gradeWritten(ctx, { question: item.question, answer: ta.value, reference: item.model_answer, points: item.key_points, kind: "short answer" });
      el.querySelector(".fb").innerHTML = gradeHTML(g);
      el.querySelector(".ans").hidden = false;
      e.target.disabled = false;
      onAnswer?.(g.score >= 0.6);
    };
    return el;
  },
  flashcards(item, onAnswer) {
    const el = document.createElement("div");
    el.className = "qbox";
    el.innerHTML = `<p class="qt">${escBr(item.front)}</p><div class="ans" hidden><span class="lab">Answer</span><div class="txt">${escBr(item.back)}</div></div>
      <div class="row"><button class="btn primary sm" data-f>Show answer</button></div>`;
    const row = el.querySelector(".row");
    row.querySelector("[data-f]").onclick = () => {
      el.querySelector(".ans").hidden = false;
      row.innerHTML = `<span class="muted small">Did you know it?</span><button class="btn sm good" data-y>Got it</button><button class="btn sm bad" data-n>Missed it</button>`;
      row.querySelector("[data-y]").onclick = () => { row.innerHTML = `<b class="good">Marked as known.</b>`; onAnswer?.(true); };
      row.querySelector("[data-n]").onclick = () => { row.innerHTML = `<b class="badc">Marked to review.</b>`; onAnswer?.(false); };
    };
    return el;
  },
};

// Shared list view: Practice mode (instant feedback) for question tools.
function questionList(toolId) {
  return function render(el, ctx) {
    const items = ctx.out.items || [];
    const m = ctx.mem;
    m.order ??= items.map((x) => x.id);
    m.score ??= { right: 0, done: 0 };
    const list = m.order.map((id) => items.find((x) => x.id === id)).filter(Boolean);
    el.innerHTML = `<div class="scorebar"><span class="sc">${m.score.right} / ${m.score.done} correct</span><span class="muted small">${items.length} questions</span>
      <span class="grow"></span><button class="btn sm" data-shuffle>Shuffle</button><button class="btn sm" data-reset>Start over</button></div><div class="qlist"></div>`;
    el.querySelector("[data-shuffle]").onclick = () => { m.order = shuffle(items).map((x) => x.id); m.score = { right: 0, done: 0 }; render(el, ctx); };
    el.querySelector("[data-reset]").onclick = () => { m.score = { right: 0, done: 0 }; render(el, ctx); };
    const host = el.querySelector(".qlist");
    list.forEach((it, n) => {
      const box = ITEM[toolId](it, (ok) => {
        m.score.done++; if (ok) m.score.right++;
        el.querySelector(".sc").textContent = `${m.score.right} / ${m.score.done} correct`;
        ctx.record(it.id, ok); ctx.save();
      }, ctx);
      box.insertAdjacentHTML("afterbegin", `<div class="qm">Question ${n + 1}</div>`);
      host.appendChild(box);
    });
  };
}

/* ================================================================== */
const mcq = {
  id: "mcq", name: "Multiple choice", group: "practice", icon: "mcq", kind: "list",
  desc: "Four-option questions with an explanation for every answer.",
  defaults: { count: 25 }, options: [{ key: "count", label: "How many questions", type: "number", min: 5, max: 200 }],
  engine: (text, o) => gen.mcq(text, o.count),
  ai: async (text, o, cls, ctl) => (await aiList({
    text, count: o.count, key: "questions", perChunkMax: 10, tokensPerItem: 150, ...ctl, verify: checkMCQ,
    clean: (q) => { const options = q.options.map(stripLabel); return new Set(options.map((o) => o.toLowerCase())).size === 4 ? { ...q, options } : null; },
    build: (n) => ({
      prompt: `Write exactly ${n} multiple-choice exam questions that test understanding of this course material (not trivia about the document). Each has 4 options: one clearly correct answer and 3 plausible but wrong distractors of similar length. "answer" is the index (0-3) of the correct option. "explanation" says in 1-2 sentences why it's right. Mix recall, application and "which is NOT" questions.`,
      schema: S.obj({ questions: S.arr(S.obj({ question: S.str, options: S.arr(S.str, 4, 4), answer: S.int(0, 3), explanation: S.str }), n, 1) }),
    }),
  })).map((q) => { // models favour "A"; shuffle the options
    const correct = q.options[q.answer];
    const options = shuffle(q.options);
    return { ...q, options, answer: options.indexOf(correct) };
  }),
  render: questionList("mcq"),
  printHTML: (out) => worksheet(out.items, (q) => `${escBr(q.question)}<ol class="popts">${q.options.map((o) => `<li>${escBr(o)}</li>`).join("")}</ol>`, (q) => `${L[q.answer]}. ${esc(q.options[q.answer])}`),
};

// Small models write mostly true statements, which makes the quiz trivial. Bring false ones up to about
// 40%: first by changing a year or person in a true statement, then by swapping in "term: wrong
// definition" statements built from the notes. Both kinds are reliably false.
function balanceTF(items, text) {
  // Too many false ones: drop the surplus beyond 60% (a "guess false" strategy shouldn't pay off).
  const maxFalse = Math.max(1, Math.round(items.filter((s) => s.isTrue).length * 1.5));
  let seenFalse = 0;
  items = items.filter((s) => s.isTrue || ++seenFalse <= maxFalse);
  const want = Math.round(items.length * 0.4);
  let falses = items.filter((s) => !s.isTrue).length;
  for (const s of shuffle(items.filter((x) => x.isTrue))) {
    if (falses >= want) break;
    const f = falsify(s.statement, text);
    if (!f) continue;
    s.explanation = `False. Your notes say: “${s.statement}”`;
    s.statement = f; s.isTrue = false; falses++;
  }
  if (falses < want) {
    const extra = swappedDefinitions(text, want - falses);
    const trues = shuffle(items.filter((x) => x.isTrue));
    for (const e of extra) { const t = trues.pop(); if (!t) break; items[items.indexOf(t)] = e; }
  }
  return shuffle(items);
}

// Printable question sheet with an answer key on a new page.
function worksheet(items = [], q, a) {
  return `<ol class="worksheet">${items.map((it) => `<li>${q(it)}</li>`).join("")}</ol>
    <h3 class="anskey">Answer key</h3><ol class="keylist">${items.map((it) => `<li>${a(it)}</li>`).join("")}</ol>`;
}

const truefalse = {
  id: "truefalse", name: "True or false", group: "practice", icon: "truefalse", kind: "list",
  desc: "Quick statements to judge. False ones contain subtle, realistic mistakes.",
  defaults: { count: 25 }, options: [{ key: "count", label: "How many statements", type: "number", min: 5, max: 200 }],
  engine: (text, o) => gen.truefalse(text, o.count),
  ai: async (text, o, cls, ctl) => balanceTF(await aiList({
    text, count: o.count, key: "items", perChunkMax: 14, tokensPerItem: 85, ...ctl,
    // A "true" statement must be backed by the notes; a "false" one can't be a fact copied straight from them.
    // The model then re-judges the statement, except on Lite, which is too small to judge itself reliably.
    verify: async (s, chunk, signal) => {
      const g = groundScore(s.statement, chunk);
      if (s.isTrue ? g < 0.5 : g >= 0.999) return false;
      return ai.status.loaded === "lite" ? true : checkTF(s, chunk, signal);
    },
    // Small models sometimes append "This statement is true." to the statement, which gives the answer away.
    clean: (s) => {
      const statement = String(s.statement).replace(/\s*(?:\(?\b(?:this (?:statement )?is (?:true|false|correct|incorrect))\b\.?\)?|\((?:true|false)\))\s*$/i, "").trim();
      return statement.length > 8 ? { ...s, statement } : null;
    },
    build: (n) => ({
      prompt: `Write exactly ${n} true/false statements about the important ideas in this course material: ${Math.ceil(n / 2)} TRUE statements that state a fact from the material accurately, and ${Math.floor(n / 2)} FALSE statements made by changing one key detail (a term, cause, number, date or relationship) so the error is subtle but clearly wrong. "explanation" gives the correct fact in one sentence.`,
      schema: S.obj({ items: S.arr(S.obj({ statement: S.str, isTrue: S.bool, explanation: S.str }), n, 1) }),
    }),
  }), text),
  render: questionList("truefalse"),
  printHTML: (out) => worksheet(out.items, (s) => `${escBr(s.statement)}<div class="tfline">True / False</div>`, (s) => `${s.isTrue ? "True" : "False"}. ${esc(s.explanation || "")}`),
};

const cloze = {
  id: "cloze", name: "Fill in the blank", group: "practice", icon: "cloze", kind: "list",
  desc: "Key sentences with the important word removed. Type the missing word.",
  defaults: { count: 25 }, options: [{ key: "count", label: "How many", type: "number", min: 5, max: 200 }],
  engine: (text, o) => gen.cloze(text, o.count),
  ai: async (text, o, cls, ctl) => (await aiList({
    text, count: o.count, key: "items", perChunkMax: 14, tokensPerItem: 80, ...ctl,
    build: (n) => ({
      prompt: `Write exactly ${n} fill-in-the-blank sentences from the most important facts in this course material. In "text", replace ONE key term (1-3 words) with "_____" (five underscores). "answer" is the exact removed term. "hint" is a short clue that doesn't give the answer away.`,
      schema: S.obj({ items: S.arr(S.obj({ text: S.str, answer: S.str, hint: S.str }), n, 1) }),
    }),
  })).map((c) => /_{3,}/.test(c.text) ? c : { ...c, text: c.text.replace(new RegExp(c.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "_____") }).filter((c) => /_{3,}/.test(c.text)),
  render: questionList("cloze"),
  printHTML: (out) => worksheet(out.items, (c) => esc(c.text).replace(/_{3,}/, "________________"), (c) => esc(c.answer)),
};

/* ================================================================== */
const matching = {
  id: "matching", name: "Matching", group: "practice", icon: "matching", kind: "list",
  desc: "Match each term to its definition in sets of five.",
  defaults: { count: 6 }, options: [{ key: "count", label: "How many sets", type: "number", min: 1, max: 40 }],
  engine: (text, o) => gen.matching(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "sets", perChunkMax: 3, tokensPerItem: 330, ...ctl,
    build: (n) => ({
      prompt: `Create ${n} matching sets from this course material. Each set has a short title and exactly 5 pairs: a "term" (1-5 words) and its "match" (a short definition, example or description). Terms within a set should be related so the match is a real test.`,
      schema: S.obj({ sets: S.arr(S.obj({ title: S.str, pairs: S.arr(S.obj({ term: S.str, match: S.str }), 5, 3) }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    const sets = ctx.out.items || [];
    el.innerHTML = "";
    sets.forEach((set) => {
      const opts = shuffle(set.pairs.map((p) => p.match));
      const box = document.createElement("div");
      box.className = "qbox";
      box.innerHTML = `<p class="qt">${esc(set.title)}</p>${set.pairs.map((p, i) => `<div class="mrow"><span class="it">${esc(p.term)}</span>
        <select class="sel" data-i="${i}"><option value="">Choose…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select><span class="mark"></span></div>`).join("")}
        <div class="row"><button class="btn primary sm" data-c>Check</button><span class="res muted small"></span></div>`;
      box.querySelector("[data-c]").onclick = () => {
        let right = 0;
        box.querySelectorAll("select").forEach((s) => {
          const p = set.pairs[+s.dataset.i], ok = s.value === p.match;
          if (ok) right++;
          const mk = s.nextElementSibling; mk.textContent = ok ? "✓" : "✗"; mk.className = "mark " + (ok ? "y" : "n");
          s.title = ok ? "" : "Correct: " + p.match;
          if (!ok && !s.parentElement.querySelector(".fix")) s.parentElement.insertAdjacentHTML("beforeend", `<div class="fix">${esc(p.match)}</div>`);
        });
        box.querySelector(".res").textContent = `${right} / ${set.pairs.length} correct`;
        ctx.record(set.id, right === set.pairs.length); ctx.save();
      };
      el.appendChild(box);
    });
  },
};

const ordering = {
  id: "ordering", name: "Put in order", group: "practice", icon: "ordering", kind: "list",
  desc: "Arrange the steps of a process or the events of a sequence in the right order.",
  defaults: { count: 6 }, options: [{ key: "count", label: "How many sets", type: "number", min: 1, max: 30 }],
  engine: (text, o) => gen.ordering(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "sets", perChunkMax: 3, tokensPerItem: 220, ...ctl,
    clean: (s) => ({ ...s, steps: s.steps.map(stripLabel) }),
    build: (n) => ({
      prompt: `Find up to ${n} real sequences in this course material: steps of a process, stages, chronological events, or ranked items. For each, give a "title" (e.g. "Order the stages of mitosis") and the "steps" in the CORRECT order (3-7 steps, each short). Only use sequences whose order is clear from the material. Every step in a set must be the same kind of thing (all events, or all stages of one process); leave out definitions, causes and background. Return an empty list if there are none.`,
      schema: S.obj({ sets: S.arr(S.obj({ title: S.str, steps: S.arr(S.str, 7, 3) }), n) }),
    }),
  }),
  render(el, ctx) {
    const sets = ctx.out.items || [];
    el.innerHTML = sets.length ? "" : `<div class="empty">No sequences were found in these materials.</div>`;
    sets.forEach((set) => {
      let cur = shuffle(set.steps.map((s, i) => ({ s, i })));
      if (cur.every((x, k) => x.i === k)) cur.reverse();
      const box = document.createElement("div");
      box.className = "qbox";
      const draw = (checked) => {
        box.innerHTML = `<p class="qt">${esc(set.title)}</p><ol class="order">${cur.map((x, k) => `<li class="${checked ? (x.i === k ? "correct" : "wrong") : ""}">
          <span>${esc(x.s)}</span><span class="ud"><button class="btn icon sm" data-up="${k}" ${k === 0 || checked ? "disabled" : ""} aria-label="Move up">▲</button><button class="btn icon sm" data-dn="${k}" ${k === cur.length - 1 || checked ? "disabled" : ""} aria-label="Move down">▼</button></span></li>`).join("")}</ol>
          <div class="row">${checked ? `<button class="btn sm" data-again>Try again</button>` : `<button class="btn primary sm" data-c>Check order</button>`}<span class="muted small res"></span></div>`;
        box.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => { const k = +b.dataset.up; [cur[k - 1], cur[k]] = [cur[k], cur[k - 1]]; draw(); });
        box.querySelectorAll("[data-dn]").forEach((b) => b.onclick = () => { const k = +b.dataset.dn; [cur[k + 1], cur[k]] = [cur[k], cur[k + 1]]; draw(); });
        box.querySelector("[data-c]")?.addEventListener("click", () => {
          const right = cur.filter((x, k) => x.i === k).length;
          draw(true);
          box.querySelector(".res").textContent = `${right} / ${cur.length} in the right place`;
          ctx.record(set.id, right === cur.length); ctx.save();
        });
        box.querySelector("[data-again]")?.addEventListener("click", () => { cur = shuffle(cur); draw(); });
      };
      draw();
      el.appendChild(box);
    });
  },
};

/* ================================================================== */
const short = {
  id: "short", name: "Short response", group: "practice", icon: "short", kind: "list",
  desc: "Write answers in your own words. AXON grades them and shows what you missed.",
  defaults: { count: 15 }, options: [{ key: "count", label: "How many questions", type: "number", min: 3, max: 100 }],
  engine: (text, o) => gen.short(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "questions", perChunkMax: 8, tokensPerItem: 190, ...ctl,
    build: (n) => ({
      prompt: `Write exactly ${n} short-response exam questions (answerable in 2-5 sentences) about the most important ideas in this course material. Use verbs like explain, describe, compare, why, how. "model_answer" is a complete answer in 2-5 sentences. "key_points" lists 2-5 specific ideas a full-credit answer must include.`,
      schema: S.obj({ questions: S.arr(S.obj({ question: S.str, model_answer: S.str, key_points: S.arr(S.str, 5, 2) }), n, 1) }),
    }),
  }),
  render: questionList("short"),
};

/* ================================================================== */
const essay = {
  id: "essay", name: "Essay practice", group: "practice", icon: "essay", kind: "list",
  desc: "Essay prompts with a rubric and outline. Write, time yourself, and get rubric-based feedback.",
  defaults: { count: 5 }, options: [{ key: "count", label: "How many prompts", type: "number", min: 1, max: 20 }],
  engine: (text, o, cls) => gen.essay(text, o.count, cls.name),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "prompts", perChunkMax: 3, tokensPerItem: 520, ...ctl,
    build: (n) => ({
      prompt: `Write ${n} essay prompts that a teacher could set on this course material. Each prompt is 1-3 sentences, needs an argument (not just a summary), and can be answered using the course material. For each: the "prompt", an "outline" of 4-6 lines for a strong answer, and a "rubric" of 3-5 criteria, each with points (1-5) and a one-line description of full marks.`,
      schema: S.obj({ prompts: S.arr(S.obj({ prompt: S.str, outline: S.arr(S.str, 6, 3), rubric: S.arr(S.obj({ criterion: S.str, points: S.int(1, 5), description: S.str }), 5, 3) }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    const items = ctx.out.items || [];
    const m = ctx.mem;
    m.i ??= 0;
    const it = items[m.i];
    if (!it) { el.innerHTML = `<div class="empty">No prompts yet.</div>`; return; }
    const drafts = ctx.cls.progress.essays ||= {};
    const rubric = it.rubric?.length ? it.rubric : DEFAULT_RUBRIC;
    const max = rubric.reduce((a, r) => a + r.points, 0);
    el.innerHTML = `<div class="toolbar"><select class="sel" aria-label="Prompt">${items.map((x, i) => `<option value="${i}" ${i === m.i ? "selected" : ""}>Prompt ${i + 1}: ${esc(x.prompt.slice(0, 70))}…</option>`).join("")}</select>
        <button class="btn sm timer" data-t>${icon("focus")} <span>Start 40-min timer</span></button></div>
      <div class="qbox"><p class="qt">${escBr(it.prompt)}</p>
        <details class="sg"><summary>Suggested outline</summary><div class="sgb"><ol>${it.outline.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div></details>
        <details class="sg"><summary>Rubric (${max} points)</summary><div class="sgb">${rubric.map((r) => `<p><b>${esc(r.criterion)}</b> · ${r.points} pts<br><span class="muted">${esc(r.description)}</span></p>`).join("")}</div></details>
        <textarea class="ruled tall" placeholder="Write your essay here. Your draft saves automatically.">${esc(drafts[it.id] || "")}</textarea>
        <div class="row"><button class="btn primary" data-g>Grade with rubric</button><span class="muted small wc"></span></div>
        <div class="fb"></div></div>`;
    el.querySelector("select").onchange = (e) => { m.i = +e.target.value; this.render(el, ctx); };
    const ta = el.querySelector("textarea"), wc = el.querySelector(".wc");
    const upd = () => wc.textContent = wordCount(ta.value) + " words";
    upd();
    ta.oninput = () => { drafts[it.id] = ta.value; upd(); ctx.saveSoon(); };
    const tb = el.querySelector("[data-t]");
    tb.onclick = () => {
      if (m.timer) { clearInterval(m.timer); m.timer = null; tb.dataset.on = ""; tb.querySelector("span").textContent = "Start 40-min timer"; return; }
      let left = 40 * 60; tb.dataset.on = "1";
      m.timer = setInterval(() => {
        left--; if (!tb.isConnected) { clearInterval(m.timer); m.timer = null; return; }
        tb.querySelector("span").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
        if (left <= 0) { clearInterval(m.timer); m.timer = null; tb.dataset.done = "1"; toast("Time's up! Finish your sentence and grade it."); }
      }, 1000);
    };
    el.querySelector("[data-g]").onclick = async (e) => {
      if (wordCount(ta.value) < 40) { toast("Write at least a paragraph first."); return; }
      e.target.disabled = true;
      const fb = el.querySelector(".fb");
      fb.innerHTML = `<p class="thinking">Grading against the rubric…</p>`;
      if (ctx.aiReady()) {
        try {
          const g = await aiJSON({
            prompt: `Grade this student essay against the rubric, like a fair teacher.\nPROMPT: ${it.prompt}\nRUBRIC:\n${rubric.map((r) => `- ${r.criterion} (${r.points} pts): ${r.description}`).join("\n")}\n\nESSAY:\n"""${ta.value}"""\n\nFor each criterion give "points" earned (whole number, at most the max) and a one-sentence "comment". Then 2-3 "strengths", 2-3 specific "improvements", and an "overall" comment.`,
            schema: S.obj({ scores: S.arr(S.obj({ criterion: S.str, points: S.int(0, 5), comment: S.str }), rubric.length, rubric.length), strengths: S.arr(S.str, 3), improvements: S.arr(S.str, 3), overall: S.str }),
            maxTokens: 1100,
          });
          const got = g.scores.reduce((a, s, i) => a + Math.min(s.points, rubric[i]?.points ?? 5), 0);
          fb.innerHTML = `<div class="grade"><div><span class="gs">${got} / ${max}</span><span class="muted small">graded by AI</span></div><p>${escBr(g.overall)}</p>
            ${g.scores.map((s, i) => `<p><b>${esc(rubric[i]?.criterion || s.criterion)}</b>: ${Math.min(s.points, rubric[i]?.points ?? 5)}/${rubric[i]?.points ?? 5} · <span class="muted">${esc(s.comment)}</span></p>`).join("")}
            <div class="gh">Strengths</div><ul>${g.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div class="gh">To improve</div><ul>${g.improvements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
          ctx.record(it.id, got / max >= 0.7); ctx.save();
        } catch (err) { fb.innerHTML = `<p class="badc">${esc(err.message)}</p>`; }
      } else {
        fb.innerHTML = `<div class="grade"><p>Turn on the AI (Settings → AI) for automatic rubric grading. Until then, score yourself honestly:</p>
          ${rubric.map((r, i) => `<div class="mrow"><span class="it">${esc(r.criterion)}</span><span class="muted small">${esc(r.description)}</span><select class="sel" data-r="${i}">${Array.from({ length: r.points + 1 }, (_, k) => `<option>${k}</option>`).join("")}</select></div>`).join("")}
          <div class="row"><button class="btn sm primary" data-self>Save my score</button><span class="muted small out"></span></div></div>`;
        fb.querySelector("[data-self]").onclick = () => {
          const got = [...fb.querySelectorAll("[data-r]")].reduce((a, s) => a + +s.value, 0);
          fb.querySelector(".out").textContent = `${got} / ${max}`;
          ctx.record(it.id, got / max >= 0.7); ctx.save();
        };
      }
      e.target.disabled = false;
    };
  },
};

/* ================================================================== */
const analysis = {
  id: "analysis", name: "Passage analysis", group: "practice", icon: "analysis", kind: "list",
  desc: "Pulls important quotes and passages from your material and asks you to analyze them.",
  defaults: { count: 10 }, options: [{ key: "count", label: "How many passages", type: "number", min: 3, max: 50 }],
  engine: (text, o) => gen.analysis(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "passages", perChunkMax: 4, tokensPerItem: 230, ...ctl,
    build: (n) => ({
      prompt: `Choose ${n} short, important passages or quotes (1-3 sentences, copied word for word) from this course material that are worth analyzing. For each: the exact "quote", an analysis "question" a teacher would ask about it (significance, meaning, technique, argument, connection to themes), and 3-5 "points" a strong analysis would make.`,
      schema: S.obj({ passages: S.arr(S.obj({ quote: S.str, question: S.str, points: S.arr(S.str, 5, 2) }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    const items = ctx.out.items || [];
    el.innerHTML = "";
    items.forEach((p, n) => {
      const box = document.createElement("div");
      box.className = "qbox";
      box.innerHTML = `<div class="qm">Passage ${n + 1}</div><blockquote class="quote">${escBr(p.quote)}</blockquote><p class="qt">${escBr(p.question)}</p>
        <textarea class="ruled" placeholder="Write your analysis…"></textarea>
        <div class="row"><button class="btn primary sm" data-g>Get feedback</button><button class="btn sm" data-p>Show strong points</button></div>
        <div class="fb"></div><div class="ans" hidden><span class="lab">A strong analysis would mention</span><ul>${p.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      box.querySelector("[data-p]").onclick = () => box.querySelector(".ans").hidden = false;
      box.querySelector("[data-g]").onclick = async (e) => {
        const ta = box.querySelector("textarea");
        if (!ta.value.trim()) return ta.focus();
        e.target.disabled = true;
        box.querySelector(".fb").innerHTML = `<p class="thinking">Reading your analysis…</p>`;
        const g = await gradeWritten(ctx, { question: `${p.question}\nPassage: "${p.quote}"`, answer: ta.value, points: p.points, kind: "analysis" });
        box.querySelector(".fb").innerHTML = gradeHTML(g);
        e.target.disabled = false;
        ctx.record(p.id, g.score >= 0.6); ctx.save();
      };
      el.appendChild(box);
    });
  },
};

export const PRACTICE_TOOLS = [flashcards, mcq, truefalse, cloze, matching, ordering, short, essay, analysis];
