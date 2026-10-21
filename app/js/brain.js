// Talks to the on-device AI model (via the main process) and splits long materials into pieces it can read.
import { uid, chunkText, wordCount } from "./engine.js";

const api = window.axon.ai;
export const ai = {
  status: { state: "idle", installed: [], downloads: [] },
  catalog: [],
  settings: { enabled: true, model: "standard" },
  listeners: new Set(),
  ready() { return this.settings.enabled && !!this.status.loaded && ["ready", "busy"].includes(this.status.state); },
  installed(id = this.settings.model) { return this.status.installed?.includes(id); },
};

const chunkWaiters = new Map();
api.onEvent((evt) => {
  if (evt.type === "chunk") { chunkWaiters.get(evt.requestId)?.(evt.text); return; }
  if (evt.type === "status") ai.status = evt;
  if (evt.type === "download") {
    const d = ai.status.downloads || [];
    const i = d.findIndex((x) => x.id === evt.id);
    const row = { id: evt.id, downloaded: evt.downloaded, total: evt.total };
    if (i >= 0) d[i] = row; else d.push(row);
    ai.status.downloads = d;
  }
  ai.listeners.forEach((fn) => fn(evt));
});

export async function initAI(settings) {
  ai.settings = settings;
  ai.catalog = await api.catalog();
  ai.status = await api.status();
  if (settings.enabled && ai.installed(settings.model)) api.load(settings.model);
}

export const SYSTEM = "You are AXON, an expert tutor who builds study material for students. Use ONLY facts found in the provided course material; never invent facts, names, dates or numbers. Write clearly and accurately, in the same language as the material. Write plain text: no Markdown symbols such as ** or #.";

const wrapMaterial = (text) => `COURSE MATERIAL:\n"""\n${text}\n"""`;

export async function aiJSON({ prompt, schema, maxTokens = 1800, signal, system = SYSTEM }) {
  const requestId = uid();
  const onAbort = () => api.cancel(requestId);
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await api.generate({ requestId, system, prompt, schema, maxTokens });
    if (r.cancelled || signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (!r.ok) throw new Error(r.error);
    return r.data;
  } finally { signal?.removeEventListener("abort", onAbort); }
}

export async function aiText({ prompt, onChunk, maxTokens = 900, signal, system = SYSTEM }) {
  const requestId = uid();
  if (onChunk) chunkWaiters.set(requestId, onChunk);
  const onAbort = () => api.cancel(requestId);
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await api.generate({ requestId, system, prompt, maxTokens, stream: !!onChunk });
    if (!r.ok && !r.cancelled) throw new Error(r.error);
    return r.text || "";
  } finally { chunkWaiters.delete(requestId); signal?.removeEventListener("abort", onAbort); }
}

// Runs a list-type AI job across every chunk of the material and joins the results.
// Items are requested in small batches: small models are more accurate that way and a cut-off
// answer only loses one batch. Later batches are told what already exists to avoid repeats.
// clean(item) tidies an item (or returns null to drop it). verify(item, chunk) is an async
// quality check (e.g. re-answering a question); items that fail it are dropped, so a few extra
// are requested up front. A batch that comes back short is topped up once.
export async function aiList({ text, count, perChunkMax = 12, build, key, signal, onProgress, tokensPerItem = 110, clean, verify }) {
  const chunks = chunkText(text, window.axon.limits?.chunkWords || 1500);
  const total = chunks.reduce((a, c) => a + wordCount(c), 0) || 1;
  count = Math.min(count, Math.max(5, Math.round(total / 9))); // a short handout can't support 200 questions
  const want = verify ? Math.ceil(count * 1.35) : count;
  const batchMax = Math.max(2, Math.min(perChunkMax, Math.floor(1400 / tokensPerItem)));
  const plan = chunks.map((c) => Math.max(1, Math.round(want * wordCount(c) / total)));
  const jobs = [];
  plan.forEach((n, i) => { for (let left = n; left > 0; left -= batchMax) jobs.push([Math.min(batchMax, left), i, false]); });
  const items = [];
  const seen = new Map(); // chunk -> short labels of items already made from it
  const made = new Set(); // normalised labels of every kept item, to drop repeats across batches
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Near-duplicates: the same question reworded ("Which store holds sensory information for less than a
  // second?" vs "...for only a few seconds?"). Compared on content words; 60%+ overlap counts as a repeat.
  const STOPW = new Set("the a an of to in on and or is are was were be by for with which what who that this these those following best describes describe according does do how why when where its it as at from".split(" "));
  const bagOf = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !STOPW.has(w)));
  const keptBags = [];
  const nearDup = (label) => {
    const b = bagOf(label);
    if (b.size < 3) return false;
    return keptBags.some((k) => { const inter = [...b].filter((w) => k.has(w)).length; return inter / Math.min(b.size, k.size) >= 0.6 && inter / Math.max(b.size, k.size) >= 0.45; });
  };
  for (let j = 0; j < jobs.length; j++) {
    const [n, i, isRetry] = jobs[j];
    onProgress?.(j / jobs.length, `Writing batch ${j + 1} of ${jobs.length}`);
    const { prompt, schema } = build(n, chunks[i]);
    const prev = seen.get(i) || [];
    const avoid = prev.length ? `\n\nAlready written (do NOT repeat or rephrase these, cover different facts):\n${prev.map((p) => "- " + p).join("\n")}` : "";
    try {
      const data = await aiJSON({ prompt: prompt + avoid + "\n\n" + wrapMaterial(chunks[i]), schema, maxTokens: Math.min(3500, 300 + Math.round(n * tokensPerItem * 1.6)), signal });
      let got = 0;
      for (let it of data[key] || []) {
        if (clean) it = clean(it);
        if (!it) continue;
        const label = String(Object.values(it).find((v) => typeof v === "string") || "").slice(0, 90);
        const sig = norm(JSON.stringify(Object.values(it)));
        if (made.has(sig) || (label && (made.has(norm(label)) || nearDup(label)))) continue;
        if (label) prev.push(label);
        if (verify) {
          onProgress?.(j / jobs.length, `Checking answers (batch ${j + 1} of ${jobs.length})`);
          if (!(await verify(it, chunks[i], signal))) continue;
        }
        items.push({ id: uid(), ...it });
        made.add(sig); if (label) { made.add(norm(label)); keptBags.push(bagOf(label)); }
        got++;
      }
      seen.set(i, prev);
      if (!isRetry && got < n && items.length < count) jobs.push([Math.min(batchMax, n - got), i, true]);
    } catch (e) {
      if (e.name === "AbortError") throw e;
      console.warn("AI batch failed", e);
    }
  }
  onProgress?.(1, "Done");
  return items.slice(0, count);
}

/* Answer checks: the model answers its own question again, independently, from the material.
   Disagreement means the question or its answer key is unreliable, so the item is dropped. */
export async function checkMCQ(q, chunk, signal) {
  try {
    const r = await aiJSON({
      prompt: `Answer this multiple-choice question using ONLY the course material below. Reply with the index (0-3) of the single correct option.\nQUESTION: ${q.question}\n${q.options.map((o, i) => `${i}: ${o}`).join("\n")}\n\n${wrapMaterial(chunk)}`,
      schema: S.obj({ answer: S.int(0, 3) }), maxTokens: 30, signal,
    });
    return r.answer === q.answer;
  } catch (e) { if (e.name === "AbortError") throw e; return true; }
}
export async function checkTF(s, chunk, signal) {
  try {
    const r = await aiJSON({
      prompt: `Using ONLY the course material below, is this statement true or false?\nSTATEMENT: ${s.statement}\n\n${wrapMaterial(chunk)}`,
      schema: S.obj({ isTrue: S.bool }), maxTokens: 20, signal,
    });
    return r.isTrue === !!s.isTrue;
  } catch (e) { if (e.name === "AbortError") throw e; return true; }
}

// Runs a document-type AI job: one call per chunk, results passed to merge().
export async function aiDoc({ text, build, signal, onProgress, maxTokens = 2200 }) {
  const chunks = chunkText(text, window.axon.limits?.chunkWords || 1500);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i / chunks.length, `Reading part ${i + 1} of ${chunks.length}`);
    const { prompt, schema } = build(chunks[i], i, chunks.length);
    try { results.push(await aiJSON({ prompt: prompt + "\n\n" + wrapMaterial(chunks[i]), schema, maxTokens, signal })); }
    catch (e) { if (e.name === "AbortError") throw e; console.warn("AI chunk failed", e); }
  }
  onProgress?.(1, "Done");
  return results;
}

/* JSON-schema shorthands (the model is forced to answer in exactly this shape) */
export const S = {
  str: { type: "string" },
  bool: { type: "boolean" },
  arr: (items, maxItems, minItems = 0) => ({ type: "array", items, maxItems, minItems }),
  obj: (properties) => ({ type: "object", properties }),
  int: (lo, hi) => ({ enum: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) }),
};

/* Text read from photos or scans has recognition mistakes ("paraleed", "Welatoniu"). The AI fixes
   obvious ones, a section at a time. Any rewrite that changes the length a lot is rejected, since
   that means the model added or dropped content instead of correcting it. */
export async function aiCleanOCR(text, signal) {
  const parts = [];
  for (const part of chunkText(text, 600)) {
    const n = wordCount(part);
    try {
      const fixed = (await aiText({
        system: "You correct text-recognition (OCR) mistakes. You never add, remove or summarize content.",
        prompt: `This text was read from a photo or scan and contains recognition mistakes. Rewrite it with the mistakes fixed: correct garbled or misspelled words to the words the writer clearly meant, fix spacing and punctuation, and drop junk characters or lines that are only noise. Do NOT add, remove, reorder or summarize information. Keep every number as written unless it is clearly the same number misread; if unsure, keep it. Reply with only the corrected text.\n\nTEXT:\n"""\n${part}\n"""`,
        maxTokens: Math.round(n * 2.4) + 120, signal,
      })).replace(/^["“]{3}|["”]{3}$/g, "").trim();
      const m = wordCount(fixed);
      parts.push(m >= n * 0.6 && m <= n * 1.5 ? fixed.replace(/[ \t]+$/gm, "") : part);
    } catch (e) { if (e.name === "AbortError") throw e; parts.push(part); }
  }
  return parts.join("\n\n");
}

/* grading with AI */
// With key points, the model judges each point on its own (correct / partly / missing / wrong) and the
// score is calculated from those verdicts. Small models are far more reliable at per-point yes/no
// judgments than at picking an overall number, and a stated misconception ("wrong") costs marks.
export async function aiGrade({ question, answer, reference, points, maxScore = 10, kind = "answer", signal }) {
  const pts = (points || []).map(String).filter(Boolean).slice(0, 8);
  if (pts.length >= 2) try {
    const r = await aiJSON({
      prompt: `You are grading a student's ${kind}. Check the student's ${kind} against EACH key point separately.
QUESTION: ${question}
${reference ? `REFERENCE ANSWER: ${reference}\n` : ""}KEY POINTS:
${pts.map((p, i) => `${i + 1}. ${p}`).join("\n")}
STUDENT ${kind.toUpperCase()}: """${answer}"""

"verdicts": one word per key point, in the same order: "correct" (clearly stated, any wording), "partly" (vague or incomplete), "missing" (not mentioned) or "wrong" (the student states something that contradicts it). Then "feedback": 2-3 short sentences telling the student what was right and exactly what to fix.`,
      schema: S.obj({ verdicts: S.arr({ enum: ["correct", "partly", "missing", "wrong"] }, pts.length, pts.length), feedback: S.str }),
      maxTokens: 420 + pts.length * 12, signal,
    });
    const v = r.verdicts;
    const raw = v.reduce((a, x) => a + (x === "correct" ? 1 : x === "partly" ? 0.5 : x === "wrong" ? -0.5 : 0), 0) / pts.length;
    const score = Math.max(0, Math.min(maxScore, Math.round(raw * maxScore)));
    return {
      score, feedback: r.feedback,
      got: pts.filter((_, i) => v[i] === "correct" || v[i] === "partly"),
      missed: pts.filter((_, i) => v[i] === "missing" || v[i] === "wrong"),
    };
  } catch (e) {
    if (e.name === "AbortError") throw e; // otherwise fall back to a single overall score below
  }
  const schema = S.obj({ score: S.int(0, maxScore), feedback: S.str, got: S.arr(S.str, 6), missed: S.arr(S.str, 6) });
  const prompt = `Grade this student's ${kind} fairly, like a strict but kind teacher.
QUESTION: ${question}
${reference ? `REFERENCE ANSWER: ${reference}\n` : ""}${points?.length ? `KEY POINTS EXPECTED: ${points.join("; ")}\n` : ""}STUDENT ${kind.toUpperCase()}: """${answer}"""

Give a score from 0 to ${maxScore}. "got": key ideas the student got right. "missed": important ideas missing or wrong. "feedback": 2-3 sentences on how to improve. Accept different wording if the meaning is correct.`;
  return aiJSON({ prompt, schema, maxTokens: 700, signal });
}
