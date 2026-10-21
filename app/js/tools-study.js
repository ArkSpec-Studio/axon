// "Exam prep" and "Study" tools.
import { esc, escBr, md, icon, toast, today, plural } from "./ui.js";
import { gen, shuffle, closeEnough, buildIndex, wordCount, uid } from "./engine.js";
import { aiList, aiText, S } from "./brain.js";
import { ITEM, gradeWritten, gradeHTML } from "./tools-practice.js";

const L = "ABCD";

/* ================================================================== */
const exam = {
  id: "exam", name: "Practice exam", group: "exam", icon: "exam", kind: "live",
  desc: "A timed, mixed exam built from your questions. Graded at the end, like the real thing.",
  render(el, ctx) {
    const m = ctx.mem;
    if (m.stage === "run") return this.run(el, ctx);
    if (m.stage === "done") return this.results(el, ctx);
    const hist = ctx.cls.progress.exams || [];
    const have = (t) => (ctx.cls.outputs[t]?.items || []).length;
    el.innerHTML = `<div class="panel pad">
      <h3>Set up your exam</h3>
      <div class="formgrid">
        <label>Questions<select class="sel" data-k="n">${[10, 20, 30, 40, 50].map((n) => `<option ${n === 20 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Time limit<select class="sel" data-k="t"><option value="0">No limit</option>${[10, 15, 20, 30, 45, 60, 90].map((n) => `<option value="${n}" ${n === 30 ? "selected" : ""}>${n} minutes</option>`).join("")}</select></label>
      </div>
      <p class="muted small">Question types (uses your generated questions first, then makes more from your materials):</p>
      <div class="row wrap">${[["mcq", "Multiple choice"], ["truefalse", "True / false"], ["cloze", "Fill in the blank"], ["short", "Short response"]].map(([t, n]) =>
        `<label class="check"><input type="checkbox" data-type="${t}" ${t !== "short" || have("short") ? "checked" : ""}> ${n}${have(t) ? ` <span class="muted small">(${have(t)})</span>` : ""}</label>`).join("")}</div>
      <div class="row"><button class="btn primary" data-go>Start exam</button></div></div>
      ${hist.length ? `<h3>Past exams</h3><div class="hist">${hist.slice().reverse().map((h) => `<div class="histrow"><span>${new Date(h.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span><span>${h.n} questions</span><b class="${h.pct >= 70 ? "good" : h.pct >= 50 ? "warn" : "badc"}">${h.pct}%</b></div>`).join("")}</div>` : ""}`;
    el.querySelector("[data-go]").onclick = () => {
      const n = +el.querySelector('[data-k="n"]').value, t = +el.querySelector('[data-k="t"]').value;
      const types = [...el.querySelectorAll("[data-type]:checked")].map((c) => c.dataset.type);
      if (!types.length) return toast("Pick at least one question type.");
      const text = ctx.text();
      const pool = {};
      for (const ty of types) {
        let items = ctx.cls.outputs[ty]?.items || [];
        if (items.length < n) items = items.concat(gen[ty](text, n));
        pool[ty] = shuffle(items);
      }
      const qs = [];
      for (let k = 0; qs.length < n && k < n * 4; k++) {
        const ty = types[k % types.length];
        const it = pool[ty].shift();
        if (it) qs.push({ type: ty, item: it });
      }
      if (!qs.length) return toast("Couldn't build questions from these materials yet.");
      Object.assign(m, { stage: "run", qs: shuffle(qs), answers: {}, limit: t * 60, start: Date.now() });
      this.render(el, ctx);
    };
  },
  run(el, ctx) {
    const m = ctx.mem;
    el.innerHTML = `<div class="scorebar"><b>Practice exam</b><span class="muted small">${m.qs.length} questions</span><span class="grow"></span><span class="timer" data-on="1">${icon("focus")} <span class="tleft"></span></span><button class="btn sm" data-quit>Quit</button></div><div class="qlist"></div>
      <div class="row"><button class="btn primary" data-submit>Submit and grade</button></div>`;
    const host = el.querySelector(".qlist");
    m.qs.forEach((q, i) => {
      const it = q.item, box = document.createElement("div");
      box.className = "qbox";
      const a = m.answers;
      if (q.type === "mcq") box.innerHTML = `<div class="qm">${i + 1}. Multiple choice</div><p class="qt">${escBr(it.question)}</p>${it.options.map((o, k) => `<label class="cbrow"><input type="radio" name="q${i}" value="${k}" ${a[i] == k ? "checked" : ""}><span><b>${L[k]}.</b> ${escBr(o)}</span></label>`).join("")}`;
      if (q.type === "truefalse") box.innerHTML = `<div class="qm">${i + 1}. True or false</div><p class="qt">${escBr(it.statement)}</p><div class="row">${["True", "False"].map((v) => `<label class="cbrow"><input type="radio" name="q${i}" value="${v}" ${a[i] === v ? "checked" : ""}> ${v}</label>`).join("")}</div>`;
      if (q.type === "cloze") { const p = String(it.text).split(/_{3,}/); box.innerHTML = `<div class="qm">${i + 1}. Fill in the blank</div><p class="qt cloze">${esc(p[0])}<input class="blank" name="q${i}" value="${esc(a[i] || "")}">${esc(p.slice(1).join("_____"))}</p>`; }
      if (q.type === "short") box.innerHTML = `<div class="qm">${i + 1}. Short response</div><p class="qt">${escBr(it.question)}</p><textarea class="ruled" name="q${i}">${esc(a[i] || "")}</textarea>`;
      box.querySelectorAll("input,textarea").forEach((inp) => inp.addEventListener(inp.type === "radio" ? "change" : "input", () => { a[i] = inp.value; }));
      host.appendChild(box);
    });
    const tl = el.querySelector(".tleft");
    clearInterval(m.tick);
    const tick = () => {
      if (!tl.isConnected) return clearInterval(m.tick);
      const used = Math.floor((Date.now() - m.start) / 1000);
      if (m.limit) {
        const left = m.limit - used;
        tl.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left` : "Time's up";
        if (left <= 0) { clearInterval(m.tick); toast("Time's up! Grading your exam."); submit(); }
      } else tl.textContent = `${Math.floor(used / 60)}:${String(used % 60).padStart(2, "0")}`;
    };
    tick(); m.tick = setInterval(tick, 1000);
    const submit = async () => {
      clearInterval(m.tick);
      const btn = el.querySelector("[data-submit]");
      btn.disabled = true; btn.textContent = "Grading…";
      m.results = [];
      for (let i = 0; i < m.qs.length; i++) {
        const { type, item } = m.qs[i], ans = m.answers[i] ?? "";
        let ok = false, g = null;
        if (type === "mcq") ok = +ans === item.answer && ans !== "";
        if (type === "truefalse") ok = ans !== "" && (ans === "True") === !!item.isTrue;
        if (type === "cloze") ok = closeEnough(ans, item.answer);
        if (type === "short") {
          btn.textContent = `Grading written answer ${i + 1}…`;
          g = ans.trim() ? await gradeWritten(ctx, { question: item.question, answer: ans, reference: item.model_answer, points: item.key_points, kind: "short answer" }) : { score: 0, feedback: "No answer.", by: "—", got: [], missed: item.key_points };
          ok = g.score >= 0.6;
        }
        m.results.push({ ok, g, score: type === "short" ? g.score : ok ? 1 : 0 });
        if (ctx.cls.outputs[type]?.items?.some((x) => x.id === item.id)) ctx.record(item.id, ok, type);
      }
      const pct = Math.round(100 * m.results.reduce((a, r) => a + r.score, 0) / m.qs.length);
      (ctx.cls.progress.exams ||= []).push({ at: Date.now(), n: m.qs.length, pct, secs: Math.round((Date.now() - m.start) / 1000) });
      ctx.activity("exam", Math.round((Date.now() - m.start) / 60000));
      m.pct = pct; m.stage = "done"; ctx.save(); this.render(el, ctx);
    };
    el.querySelector("[data-submit]").onclick = submit;
    el.querySelector("[data-quit]").onclick = () => { clearInterval(m.tick); m.stage = null; this.render(el, ctx); };
  },
  results(el, ctx) {
    const m = ctx.mem;
    const right = m.results.filter((r) => r.ok).length;
    el.innerHTML = `<div class="result panel pad"><span class="eyebrow">Your score</span><b class="big ${m.pct >= 70 ? "good" : m.pct >= 50 ? "warn" : "badc"}">${m.pct}%</b>
      <p>${right} of ${m.qs.length} correct. Missed questions were added to <b>Weak spots</b>.</p><div class="row"><button class="btn primary" data-new>New exam</button></div></div><div class="qlist"></div>`;
    const host = el.querySelector(".qlist");
    m.qs.forEach(({ type, item }, i) => {
      const r = m.results[i], a = m.answers[i] ?? "";
      const box = document.createElement("div");
      box.className = "qbox " + (r.ok ? "ok" : "no");
      let body = "";
      if (type === "mcq") body = `<p class="qt">${escBr(item.question)}</p><p>Your answer: <b>${a === "" ? "—" : esc(item.options[a])}</b></p>${r.ok ? "" : `<p>Correct: <b class="good">${esc(item.options[item.answer])}</b></p>`}<p class="exp">${escBr(item.explanation || "")}</p>`;
      if (type === "truefalse") body = `<p class="qt">${escBr(item.statement)}</p><p>Your answer: <b>${esc(a || "—")}</b> · Correct: <b>${item.isTrue ? "True" : "False"}</b></p><p class="exp">${escBr(item.explanation || "")}</p>`;
      if (type === "cloze") body = `<p class="qt">${escBr(item.text)}</p><p>Your answer: <b>${esc(a || "—")}</b> · Correct: <b>${esc(item.answer)}</b></p>`;
      if (type === "short") body = `<p class="qt">${escBr(item.question)}</p><p class="muted">${escBr(a || "—")}</p>${gradeHTML(r.g)}<div class="ans"><span class="lab">Model answer</span><div class="txt">${escBr(item.model_answer)}</div></div>`;
      box.innerHTML = `<div class="qm"><span class="qres ${r.ok ? "y" : "n"}">${r.ok ? "✓ Correct" : "✗ Missed"}</span> Question ${i + 1}</div>${body}`;
      host.appendChild(box);
    });
    el.querySelector("[data-new]").onclick = () => { m.stage = null; this.render(el, ctx); };
  },
};

/* ================================================================== */
const predict = {
  id: "predict", name: "Likely exam questions", group: "exam", icon: "predict", kind: "list",
  desc: "Predicts what your teacher is most likely to ask, based on what the material stresses.",
  defaults: { count: 15 }, options: [{ key: "count", label: "How many", type: "number", min: 5, max: 60 }],
  engine: (text, o) => gen.predict(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "questions", perChunkMax: 6, tokensPerItem: 170, ...ctl,
    build: (n) => ({
      prompt: `Act as the teacher who wrote this material. Predict the ${n} exam questions you'd most likely ask, based on what the material emphasizes (repeated ideas, definitions, lists, cause and effect, examples). For each: the "question", "why" it's likely (one sentence), and an "answer_outline" of 2-5 points.`,
      schema: S.obj({ questions: S.arr(S.obj({ question: S.str, why: S.str, answer_outline: S.arr(S.str, 5, 2) }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    el.innerHTML = "";
    (ctx.out.items || []).forEach((q, n) => {
      const box = document.createElement("details");
      box.className = "sg";
      box.innerHTML = `<summary><span class="num">${n + 1}</span> ${esc(q.question)}</summary><div class="sgb"><p class="muted small">Why it's likely: ${esc(q.why)}</p>
        <textarea class="ruled" placeholder="Practice answering it…"></textarea><div class="row"><button class="btn sm primary" data-g>Grade</button><button class="btn sm" data-o>Show answer outline</button></div>
        <div class="fb"></div><ul class="outline" hidden>${q.answer_outline.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      box.querySelector("[data-o]").onclick = () => box.querySelector(".outline").hidden = false;
      box.querySelector("[data-g]").onclick = async (e) => {
        const ta = box.querySelector("textarea");
        if (!ta.value.trim()) return ta.focus();
        e.target.disabled = true;
        box.querySelector(".fb").innerHTML = `<p class="thinking">Grading…</p>`;
        const g = await gradeWritten(ctx, { question: q.question, answer: ta.value, points: q.answer_outline, kind: "answer" });
        box.querySelector(".fb").innerHTML = gradeHTML(g);
        e.target.disabled = false;
        ctx.record(q.id, g.score >= 0.6); ctx.save();
      };
      el.appendChild(box);
    });
  },
};

/* ================================================================== */
const weak = {
  id: "weak", name: "Weak spots", group: "exam", icon: "weak", kind: "live",
  desc: "Collects every question and card you've missed, across all tools, so you can fix them.",
  render(el, ctx) {
    const P = ctx.cls.progress.items || {};
    const list = [];
    for (const [key, r] of Object.entries(P)) {
      const [tool, id] = key.split(":");
      if (!ITEM[tool] || !(r.w > 0 && (r.last === false || r.w > r.r))) continue;
      const item = ctx.cls.outputs[tool]?.items?.find((x) => x.id === id);
      if (item) list.push({ tool, item, r });
    }
    list.sort((a, b) => (b.r.w - b.r.r) - (a.r.w - a.r.r));
    el.innerHTML = list.length
      ? `<p class="muted">${plural(list.length, "item")} to fix. Answer one correctly and it leaves this list.</p><div class="qlist"></div>`
      : `<div class="empty"><b>No weak spots right now.</b><br>Anything you miss in flashcards, quizzes or exams will show up here.</div>`;
    const host = el.querySelector(".qlist");
    const names = { mcq: "Multiple choice", truefalse: "True or false", cloze: "Fill in the blank", short: "Short response", flashcards: "Flashcard" };
    list.slice(0, 30).forEach(({ tool, item, r }) => {
      const box = ITEM[tool](item, (ok) => { ctx.record(item.id, ok, tool); ctx.save(); }, ctx);
      box.insertAdjacentHTML("afterbegin", `<div class="qm">${names[tool]} · missed ${plural(r.w, "time")}</div>`);
      host.appendChild(box);
    });
  },
};

/* ================================================================== */
const explain = {
  id: "explain", name: "Explain it back", group: "exam", icon: "explain", kind: "list",
  desc: "Teach a topic in your own words. AXON checks what you covered, missed or got wrong.",
  defaults: { count: 15 }, options: [{ key: "count", label: "How many topics", type: "number", min: 3, max: 60 }],
  engine: (text, o) => gen.explain(text, o.count),
  ai: (text, o, cls, ctl) => aiList({
    text, count: o.count, key: "topics", perChunkMax: 6, tokensPerItem: 110, ...ctl,
    build: (n) => ({
      prompt: `List the ${n} most important topics in this course material that a student should be able to explain out loud. For each: a short "topic" name and 3-6 "key_points" a complete explanation must include.`,
      schema: S.obj({ topics: S.arr(S.obj({ topic: S.str, key_points: S.arr(S.str, 6, 2) }), n, 1) }),
    }),
  }),
  render(el, ctx) {
    const items = ctx.out.items || [];
    const m = ctx.mem;
    m.i ??= 0;
    const t = items[m.i];
    const P = ctx.cls.progress.items || {};
    el.innerHTML = `<div class="split"><div class="side-list">${items.map((x, i) => {
      const r = P[`explain:${x.id}`];
      return `<button class="side-item ${i === m.i ? "on" : ""}" data-i="${i}">${r ? (r.last ? `<span class="good">✓</span>` : `<span class="badc">•</span>`) : `<span class="muted">○</span>`} ${esc(x.topic)}</button>`;
    }).join("")}</div>
      <div class="qbox">${t ? `<span class="eyebrow">Explain this like you're teaching a friend</span><h3>${esc(t.topic)}</h3>
        <textarea class="ruled tall" placeholder="No notes! Explain it from memory…"></textarea>
        <div class="row"><button class="btn primary" data-g>Check my explanation</button><button class="btn sm" data-k>Show key points</button></div>
        <div class="fb"></div><ul class="outline" hidden>${t.key_points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="empty">No topics yet.</div>`}</div></div>`;
    el.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => { m.i = +b.dataset.i; this.render(el, ctx); });
    if (!t) return;
    el.querySelector("[data-k]").onclick = () => el.querySelector(".outline").hidden = false;
    el.querySelector("[data-g]").onclick = async (e) => {
      const ta = el.querySelector("textarea");
      if (wordCount(ta.value) < 8) return ta.focus();
      e.target.disabled = true;
      el.querySelector(".fb").innerHTML = `<p class="thinking">Checking…</p>`;
      const g = await gradeWritten(ctx, { question: `Explain: ${t.topic}`, answer: ta.value, points: t.key_points, kind: "explanation" });
      el.querySelector(".fb").innerHTML = gradeHTML(g);
      e.target.disabled = false;
      ctx.record(t.id, g.score >= 0.7); ctx.save();
    };
  },
};

/* ================================================================== */
const ask = {
  id: "ask", name: "Ask your notes", group: "study", icon: "ask", kind: "live",
  desc: "Ask anything about this class. Answers come only from your materials, with sources.",
  render(el, ctx) {
    const hist = ctx.cls.askHistory ||= [];
    const m = ctx.mem;
    if (!m.index || m.indexFor !== ctx.cls.materials.length) { m.index = buildIndex(ctx.cls.materials); m.indexFor = ctx.cls.materials.length; }
    el.innerHTML = `<div class="chat"></div>
      <form class="command panel"><span class="cmd-glyph">&gt;_</span><input placeholder="Ask about ${esc(ctx.cls.name)}…" aria-label="Your question" autofocus><span class="badge">${ctx.aiReady() ? "AI" : "Search"}</span><button class="btn primary">Ask</button></form>
      ${hist.length ? `<button class="btn sm ghost" data-clear>Clear history</button>` : ""}`;
    const chat = el.querySelector(".chat");
    const msg = (q, a, sources) => {
      const d = document.createElement("div");
      d.className = "msg";
      d.innerHTML = `<p class="q">${esc(q)}</p><div class="a">${a}</div>${sources?.length ? `<details class="src"><summary>${plural(sources.length, "source")}</summary>${sources.map((s, i) => `<p><b>[${i + 1}] ${esc(s.mat)}</b><br>${escBr(s.text.slice(0, 600))}${s.text.length > 600 ? "…" : ""}</p>`).join("")}</details>` : ""}`;
      chat.appendChild(d);
      return d;
    };
    for (const h of hist) msg(h.q, md(h.a), h.sources);
    el.querySelector("[data-clear]")?.addEventListener("click", () => { ctx.cls.askHistory = []; ctx.save(); this.render(el, ctx); });
    const form = el.querySelector("form"), inp = form.querySelector("input");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = inp.value.trim();
      if (!q) return;
      inp.value = "";
      const hits = m.index.search(q, 5);
      if (!hits.length) { msg(q, `<p class="muted">Nothing in your materials matches that. Try other words, or add more materials.</p>`); return; }
      const sources = hits.map((h) => ({ mat: h.mat, text: h.text }));
      if (!ctx.aiReady()) {
        msg(q, `<p class="muted">Most relevant parts of your materials${ctx.aiInstalled() ? " (load the AI in Settings for written answers)" : ""}:</p>${hits.slice(0, 3).map((h) => `<blockquote class="quote">${escBr(h.text.slice(0, 700))}</blockquote><p class="muted small">— ${esc(h.mat)}</p>`).join("")}`);
        hist.push({ q, a: hits[0].text.slice(0, 700), sources }); ctx.save();
        return;
      }
      const d = msg(q, `<p class="thinking">Thinking…</p>`, sources);
      const box = d.querySelector(".a");
      let text = "";
      try {
        await aiText({
          prompt: `Answer the student's question using ONLY these excerpts from their course materials. Cite excerpts like [1] or [2]. If the excerpts don't contain the answer, say so honestly. Be clear and concise.\n\n${hits.map((h, i) => `[${i + 1}] (${h.mat})\n${h.text}`).join("\n\n")}\n\nQUESTION: ${q}`,
          onChunk: (c) => { text += c; box.innerHTML = md(text.replace(/<\/?think>/g, "")); chat.scrollTop = chat.scrollHeight; },
        });
        hist.push({ q, a: text, sources });
        if (hist.length > 40) hist.splice(0, hist.length - 40);
        ctx.activity("ask"); ctx.save();
      } catch (err) { box.innerHTML = `<p class="badc">${esc(err.message)}</p>`; }
    };
  },
};

/* ================================================================== */
const planner = {
  id: "planner", name: "Study planner", group: "study", icon: "planner", kind: "live",
  desc: "Add your exam dates and get a day-by-day plan that counts down to each one.",
  render(el, ctx) {
    const pl = ctx.cls.planner ||= { exams: [], done: {} };
    const now = new Date(today() + "T00:00");
    const up = pl.exams.filter((x) => new Date(x.date + "T00:00") >= now).sort((a, b) => a.date.localeCompare(b.date));
    const next = up[0];
    el.innerHTML = `<div class="panel pad"><h3>Exams & due dates</h3>
      <div class="row wrap"><input class="field" placeholder="e.g. Midterm" data-n><input class="field" type="date" data-d min="${today()}"><button class="btn primary" data-add>${icon("plus")} Add</button></div>
      <div class="hist">${pl.exams.slice().sort((a, b) => a.date.localeCompare(b.date)).map((x) => {
        const days = Math.round((new Date(x.date + "T00:00") - now) / 86400000);
        return `<div class="histrow"><b>${esc(x.name)}</b><span>${new Date(x.date + "T00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span><span class="${days < 0 ? "muted" : days <= 3 ? "badc" : days <= 7 ? "warn" : ""}">${days < 0 ? "past" : days === 0 ? "today!" : plural(days, "day") + " left"}</span><button class="btn icon sm" data-del="${x.id}" title="Remove">${icon("x")}</button></div>`;
      }).join("") || `<p class="muted small">No dates yet.</p>`}</div></div>
      ${next ? `<h3>Your plan until ${esc(next.name)}</h3><div class="row"><button class="btn sm" data-ics>${icon("download")} Add plan to calendar (.ics)</button></div><div class="plan"></div>` : ""}`;
    el.querySelector("[data-add]").onclick = () => {
      const n = el.querySelector("[data-n]").value.trim() || "Exam", d = el.querySelector("[data-d]").value;
      if (!d) return toast("Pick a date.");
      pl.exams.push({ id: uid(), name: n, date: d }); ctx.save(); this.render(el, ctx);
    };
    el.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { pl.exams = pl.exams.filter((x) => x.id !== b.dataset.del); ctx.save(); this.render(el, ctx); });
    if (!next) return;
    const days = this.plan(ctx, next);
    el.querySelector(".plan").innerHTML = days.map((d) => `<div class="planday ${d.date === today() ? "today" : ""}"><div class="pd">${d.date === today() ? "Today" : new Date(d.date + "T00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>
      <div>${d.tasks.map((t) => { const k = `${d.date}:${t.k}`; return `<label class="check"><input type="checkbox" data-k="${esc(k)}" ${pl.done[k] ? "checked" : ""}> <span class="${pl.done[k] ? "strike" : ""}">${esc(t.label)}</span>${t.tool ? ` <button class="linkbtn" data-open="${t.tool}">open</button>` : ""}</label>`; }).join("")}</div></div>`).join("");
    el.querySelectorAll("[data-k]").forEach((cb) => cb.onchange = () => { pl.done[cb.dataset.k] = cb.checked; if (cb.checked) ctx.activity("plan"); ctx.save(); cb.nextElementSibling.classList.toggle("strike", cb.checked); });
    el.querySelectorAll("[data-open]").forEach((b) => b.onclick = (e) => { e.preventDefault(); ctx.openTool(b.dataset.open); });
    el.querySelector("[data-ics]").onclick = () => this.ics(ctx, next, days);
  },
  plan(ctx, examObj) {
    const has = (t) => ctx.cls.tools.includes(t);
    const topics = (ctx.cls.outputs.guide?.sections || ctx.cls.outputs.summary?.sections || []).map((s) => s.heading);
    const practice = ["mcq", "truefalse", "cloze", "short", "matching", "explain", "predict"].filter(has);
    const out = [];
    const start = new Date(today() + "T00:00"), end = new Date(examObj.date + "T00:00");
    const n = Math.min(60, Math.round((end - start) / 86400000));
    for (let i = 0; i <= n; i++) {
      const d = new Date(start.getTime() + i * 86400000), date = today(d), left = n - i;
      const tasks = [];
      if (left === 0) { tasks.push({ k: "exam", label: `${examObj.name} today. Quick look at your cheat sheet, then rest.`, tool: has("cheatsheet") ? "cheatsheet" : null }); out.push({ date, tasks }); continue; }
      if (has("flashcards")) tasks.push({ k: "cards", label: "Review due flashcards", tool: "flashcards" });
      if (topics.length) { const t = topics[i % topics.length]; tasks.push({ k: "topic", label: `Study topic: ${t}`, tool: has("guide") ? "guide" : "summary" }); }
      if (practice.length) { const p = practice[i % practice.length]; tasks.push({ k: "prac-" + p, label: `Practice: ${({ mcq: "multiple choice", truefalse: "true/false", cloze: "fill in the blank", short: "short response", matching: "matching", explain: "explain it back", predict: "likely exam questions" })[p]}`, tool: p }); }
      if (has("weak") && i % 3 === 2) tasks.push({ k: "weak", label: "Fix your weak spots", tool: "weak" });
      if (has("exam") && (left === 1 || left === 3 || (left > 3 && i % 7 === 6))) tasks.push({ k: "exam", label: "Take a timed practice exam", tool: "exam" });
      if (!tasks.length) tasks.push({ k: "read", label: "Re-read your materials for 25 minutes", tool: null });
      out.push({ date, tasks });
    }
    return out;
  },
  async ics(ctx, ex, days) {
    const dt = (d) => d.replace(/-/g, "");
    const evs = days.map((d) => `BEGIN:VEVENT\r\nUID:${uid()}@axon\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z\r\nDTSTART;VALUE=DATE:${dt(d.date)}\r\nSUMMARY:${ctx.cls.name}: study for ${ex.name}\r\nDESCRIPTION:${d.tasks.map((t) => "- " + t.label).join("\\n").replace(/[,;]/g, " ")}\r\nEND:VEVENT`);
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AXON//Study plan//EN\r\n${evs.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
    const p = await window.axon.exporter.save({ defaultName: `${ctx.cls.name} study plan.ics`, content: ics, filters: [{ name: "Calendar", extensions: ["ics"] }] });
    if (p) toast("Saved. Open the file to add it to your calendar.");
  },
};

/* ================================================================== */
// The focus timer keeps running while you move around the app.
export const focusState = { running: false, mode: "focus", left: 25 * 60, total: 25 * 60, sessions: 0, timer: null, onDone: null, listeners: new Set() };
const beep = () => { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.2, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 1.2); o.start(); o.stop(a.currentTime + 1.2); } catch {} };
const focus = {
  id: "focus", name: "Focus timer", group: "study", icon: "focus", kind: "live",
  desc: "A Pomodoro timer: focused study blocks with short breaks. Minutes count toward your progress.",
  render(el, ctx) {
    const f = focusState;
    const set = ctx.cls.progress.focusSet ||= { focus: 25, short: 5, long: 15 };
    const draw = () => {
      if (!el.isConnected) { f.listeners.delete(draw); return; }
      const pct = 1 - f.left / f.total, R = 110, C = 2 * Math.PI * R;
      el.innerHTML = `<div class="focus panel pad">
        <div class="seg">${[["focus", "Focus"], ["short", "Short break"], ["long", "Long break"]].map(([k, n]) => `<button data-m="${k}" aria-pressed="${f.mode === k}">${n}</button>`).join("")}</div>
        <svg viewBox="0 0 260 260" class="ring"><circle cx="130" cy="130" r="${R}" class="ring-bg"/><circle cx="130" cy="130" r="${R}" class="ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct)}"/>
          <text x="130" y="140" class="ring-t">${Math.floor(f.left / 60)}:${String(f.left % 60).padStart(2, "0")}</text><text x="130" y="172" class="ring-s">${f.mode === "focus" ? "focus" : "break"}</text></svg>
        <div class="row center"><button class="btn primary wide" data-go>${f.running ? icon("pause") + " Pause" : icon("play") + " Start"}</button><button class="btn" data-reset>Reset</button></div>
        <p class="muted">${plural(f.sessions, "focus session")} today in this app session</p>
        <div class="formgrid">${[["focus", "Focus"], ["short", "Short break"], ["long", "Long break"]].map(([k, n]) => `<label>${n} (min)<input class="field" type="number" min="1" max="180" value="${set[k]}" data-set="${k}"></label>`).join("")}</div></div>`;
      el.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => { stop(); f.mode = b.dataset.m; f.total = f.left = set[f.mode] * 60; draw(); });
      el.querySelector("[data-go]").onclick = () => f.running ? stop() : start();
      el.querySelector("[data-reset]").onclick = () => { stop(); f.total = f.left = set[f.mode] * 60; draw(); };
      el.querySelectorAll("[data-set]").forEach((i) => i.onchange = () => { set[i.dataset.set] = Math.max(1, +i.value || 1); ctx.save(); if (!f.running && f.mode === i.dataset.set) { f.total = f.left = set[f.mode] * 60; draw(); } });
    };
    const stop = () => { clearInterval(f.timer); f.running = false; f.listeners.forEach((fn) => fn()); };
    const start = () => {
      f.running = true;
      const log = ctx.activity;
      clearInterval(f.timer);
      f.timer = setInterval(() => {
        f.left--;
        if (f.left <= 0) {
          clearInterval(f.timer); f.running = false; beep();
          if (f.mode === "focus") {
            f.sessions++; log("focus", Math.round(f.total / 60));
            new Notification("AXON", { body: "Focus session done. Take a break!" });
            f.mode = f.sessions % 4 === 0 ? "long" : "short";
          } else { new Notification("AXON", { body: "Break's over. Back to it!" }); f.mode = "focus"; }
          f.total = f.left = set[f.mode] * 60;
        }
        f.listeners.forEach((fn) => fn());
      }, 1000);
      f.listeners.forEach((fn) => fn());
    };
    f.listeners.add(draw);
    if (!f.running && f.left === f.total) f.total = f.left = set[f.mode] * 60;
    draw();
  },
};

/* ================================================================== */
export function streak(days) {
  let n = 0;
  const d = new Date();
  if (!days[today(d)]) d.setDate(d.getDate() - 1); // today not done yet doesn't break the streak
  while (days[today(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const progress = {
  id: "progress", name: "Progress", group: "study", icon: "progress", kind: "live",
  desc: "Your streak, study time, accuracy in every tool, card mastery and exam history.",
  render(el, ctx) {
    const P = ctx.cls.progress, days = P.days || {}, items = Object.entries(P.items || {});
    const totalMin = Object.values(days).reduce((a, d) => a + (d.min || 0), 0);
    const answered = items.reduce((a, [, r]) => a + r.r + r.w, 0), right = items.reduce((a, [, r]) => a + r.r, 0);
    const byTool = {};
    for (const [k, r] of items) { const t = k.split(":")[0]; (byTool[t] ||= { r: 0, w: 0 }); byTool[t].r += r.r; byTool[t].w += r.w; }
    const cards = ctx.cls.outputs.flashcards?.items || [], srs = P.srs || {};
    const mastered = cards.filter((c) => (srs[c.id]?.ivl || 0) >= 21).length, learning = cards.filter((c) => srs[c.id] && (srs[c.id].ivl || 0) < 21).length;
    const last14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); const k = today(d); return { k, d, n: (days[k]?.n || 0) + (days[k]?.min || 0) / 5 }; });
    const max = Math.max(1, ...last14.map((x) => x.n));
    const names = Object.fromEntries(ctx.allTools.map((t) => [t.id, t.name]));
    const exams = P.exams || [];
    el.innerHTML = `<div class="stats">
        <div class="stat panel"><span class="eyebrow">Streak</span><b>${streak(days)}</b><span class="muted small">days in a row</span></div>
        <div class="stat panel"><span class="eyebrow">Focus time</span><b>${totalMin >= 60 ? (totalMin / 60).toFixed(1) + " h" : totalMin + " min"}</b><span class="muted small">logged</span></div>
        <div class="stat panel"><span class="eyebrow">Answered</span><b>${answered}</b><span class="muted small">${answered ? Math.round(100 * right / answered) : 0}% correct</span></div>
        <div class="stat panel"><span class="eyebrow">Cards mastered</span><b>${mastered}<small>/${cards.length}</small></b><span class="muted small">${learning} learning</span></div>
      </div>
      <h3>Last 14 days</h3>
      <div class="days">${last14.map((x) => `<div class="day" title="${x.k}"><i style="height:${(x.n / max) * 100}%"></i><span>${x.d.toLocaleDateString([], { weekday: "narrow" })}</span></div>`).join("")}</div>
      <h3>Accuracy by tool</h3>
      <div class="units">${Object.entries(byTool).map(([t, r]) => { const p = Math.round(100 * r.r / Math.max(1, r.r + r.w)); return `<div class="urow"><span class="nm">${esc(names[t] || t)}</span><div class="bar"><i style="width:${p}%"></i></div><span class="small">${p}% · ${r.r + r.w}</span></div>`; }).join("") || `<p class="muted">Answer some questions to see your accuracy here.</p>`}</div>
      ${exams.length ? `<h3>Practice exam scores</h3><div class="days">${exams.slice(-14).map((x) => `<div class="day" title="${x.pct}% on ${new Date(x.at).toLocaleDateString()}"><i class="${x.pct >= 70 ? "g" : x.pct >= 50 ? "w" : "b"}" style="height:${x.pct}%"></i><span>${x.pct}</span></div>`).join("")}</div>` : ""}
      <div class="row"><button class="btn bad sm" data-reset>Reset progress for this class</button></div>`;
    el.querySelector("[data-reset]").onclick = async () => {
      if (!(await ctx.confirm("Reset progress?", "This clears your streak, scores, card schedule and checkmarks for this class. Your materials and generated tools stay."))) return;
      ctx.cls.progress = { items: {}, days: {}, srs: {}, exams: [] }; ctx.save(); this.render(el, ctx);
    };
  },
};

export const STUDY_TOOLS = [exam, predict, weak, explain, ask, planner, focus, progress];
