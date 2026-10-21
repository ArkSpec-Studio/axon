// Built-in study engine: pattern-based text analysis that works instantly with no AI model.
// It finds definitions, headings, key terms, dates and lists, and builds study items from them.
// It also powers search ("Ask your notes") and keyword-based grading.

const STOP = new Set(("a an the and or but if then else of to in on at by for with from as is are was were be been being it its " +
  "this that these those there their they them he she his her we our you your i me my not no do does did done can could should " +
  "would will shall may might must also than so such into over under about between through during before after above below up " +
  "down out off again further once here when where why how all any both each few more most other some own same very just too " +
  "only which who whom what while because until nor per via vs etc eg ie one two many much has have had having like within " +
  "without upon onto among across along around however therefore thus often usually example slide notes page chapter unit").split(" "));

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const pick = (a, n) => shuffle(a).slice(0, n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function tokens(s) { return (String(s).toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || []); }
export function stem(w) {
  return w.replace(/['’]s$/, "").replace(/(ization|isation)$/, "ize").replace(/(ies)$/, "y")
    .replace(/(ing|edly|ed|es|ly|ment|ness)$/, "").replace(/s$/, "");
}
export const contentWords = (s) => tokens(s).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
export const wordCount = (t) => (String(t).match(/\S+/g) || []).length;

/* ---------- structure ---------- */

export function sentences(text) {
  return String(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/))
    .map((s) => s.replace(/^[\s•*\-–·▪◦]+/, "").trim())
    .filter((s) => s.length >= 25 && s.length <= 420 && /[a-z]/.test(s) && wordCount(s) >= 5);
}

const isHeading = (line, next) => {
  const l = line.trim();
  if (!l || l.length > 80 || /[.,;]$/.test(l)) return false;
  if (/^#{1,6}\s/.test(l) || /^(unit|chapter|section|part|module|week|lecture|lesson|topic)\b/i.test(l) || /^slide \d+$/i.test(l)) return true;
  const w = l.split(/\s+/);
  if (w.length > 10) return false;
  const caps = w.filter((x) => /^[A-Z0-9]/.test(x)).length;
  return caps / w.length >= 0.6 && !!next && next.trim().length > l.length;
};

export function sectionize(text, fallbackTitle = "Notes") {
  const lines = String(text).split("\n");
  const out = [];
  let cur = { heading: fallbackTitle, body: [] };
  lines.forEach((line, i) => {
    if (isHeading(line, lines[i + 1])) {
      if (cur.body.join(" ").trim()) out.push(cur);
      cur = { heading: line.replace(/^#+\s*/, "").replace(/:$/, "").trim(), body: [] };
    } else if (line.trim()) cur.body.push(line.trim());
  });
  if (cur.body.join(" ").trim()) out.push(cur);
  // Merge tiny sections (slide titles with one bullet) into their neighbours.
  const merged = [];
  for (const s of out) {
    const txt = s.body.join("\n");
    const last = merged[merged.length - 1];
    if (last && wordCount(txt) < 25 && wordCount(last.text) < 400) last.text += "\n" + s.heading + ": " + txt;
    else merged.push({ heading: s.heading, text: txt });
  }
  return merged;
}

export function chunkText(text, maxWords = 1600) {
  const paras = String(text).split(/\n{2,}|\n(?=Slide \d+\n)/);
  const out = [];
  let buf = [], n = 0;
  for (const p of paras) {
    const w = wordCount(p);
    if (n + w > maxWords && buf.length) { out.push(buf.join("\n\n")); buf = []; n = 0; }
    if (w > maxWords) {
      const sents = p.split(/(?<=[.!?])\s+/);
      let b = [], k = 0;
      for (const s of sents) { const sw = wordCount(s); if (k + sw > maxWords && b.length) { out.push(b.join(" ")); b = []; k = 0; } b.push(s); k += sw; }
      if (b.length) { buf.push(b.join(" ")); n += k; }
    } else { buf.push(p); n += w; }
  }
  if (buf.length) out.push(buf.join("\n\n"));
  return out.filter((c) => c.trim());
}

/* ---------- key terms & definitions ---------- */

export function keywords(text, n = 30) {
  const toks = tokens(text);
  const freq = new Map();
  const bump = (k, v) => freq.set(k, (freq.get(k) || 0) + v);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)) bump(w, 1);
    const w2 = toks[i + 1];
    if (w2 && !STOP.has(w) && !STOP.has(w2) && w.length > 2 && w2.length > 2 && !/^\d/.test(w) && !/^\d/.test(w2)) bump(w + " " + w2, 1.6);
  }
  return [...freq].filter(([k, v]) => v >= (k.includes(" ") ? 3.2 : 2))
    .map(([k, v]) => [k, v * Math.log(2 + k.length)])
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

const BAD_TERM = /^(this|that|it|there|these|those|they|he|she|we|you|i|which|what|one|another|here|such|each|its|their|our|some|many|most|all|both|example|examples|ex|note|notes|slide|figure|table|page|why|how|when|where|who|ways? to|tips?|limitations?|summary|overview|introduction|conclusion|key (points|ideas|dates|terms)|other|remember|important|source|sources|see also|references?)\b/i;
// A definition that starts with a pronoun ("This is the neutral stimulus...") refers to something else, not the term.
const BAD_DEF = /^(this|these|it|they|he|she|that|those|which|here|there)\b/i;

export function definitions(text) {
  const found = new Map();
  const add = (term, def, src) => {
    term = term.replace(/^(the|a|an)\s+/i, "").replace(/[“”"*_]/g, "").trim();
    def = def.replace(/\s+/g, " ").trim().replace(/^[,:;–—-]\s*/, "");
    const tw = term.split(/\s+/).length;
    if (tw > 6 || term.length < 2 || BAD_TERM.test(term) || BAD_DEF.test(def) || def.length < 12 || wordCount(def) < 3) return;
    if (/^\d+$/.test(term)) return;
    const key = term.toLowerCase();
    if (!found.has(key) || found.get(key).def.length < def.length && def.length < 360) found.set(key, { term: cap(term), def: cap(def), src });
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/^[\s•*\-–·▪◦\d.)]+/, "").trim();
    let m = line.match(/^([A-Z][\w’'()\/&.,+ -]{1,60}?)\s*(?::|\s[–—-]\s|=)\s*(.{12,420})$/);
    if (m && !/^(https?|www)/i.test(m[1])) { add(m[1], m[2], line); continue; }
    for (const s of sentences(line)) {
      m = s.match(/^([A-Z][\w’'()\/& -]{1,50}?)\s+(?:is|are|was|were)\s+(?:defined as|known as|called|the|a|an|when|how|what|where|any|one)\s+(.{10,360})$/);
      if (m) { add(m[1], s.slice(m[1].length).replace(/^\s*(is|are|was|were)\s+(defined as\s+)?/i, ""), s); continue; }
      m = s.match(/^([A-Z][\w’'()\/& -]{1,50}?)\s+(?:refers to|means|describes|is defined as|consists of|involves)\s+(.{10,360})$/);
      if (m) { add(m[1], s.slice(m[1].length).trim(), s); continue; }
      m = s.match(/^(.{10,200}?)\s+is (?:called|known as|termed)\s+(?:an?\s+|the\s+)?([\w’' -]{2,40})[.]?$/i);
      if (m) add(m[2], m[1], s);
    }
  }
  return [...found.values()];
}

/* ---------- summaries ---------- */

function sentenceScores(sents, kws) {
  const weight = new Map(kws.map((k, i) => [k, 1 + (kws.length - i) / kws.length]));
  return sents.map((s, i) => {
    const low = s.toLowerCase();
    let sc = 0;
    for (const [k, w] of weight) if (low.includes(k)) sc += w * (k.includes(" ") ? 1.5 : 1);
    if (/\b(important|key|main|significant|essential|primary|crucial|because|therefore|result|cause|leads? to|defined)\b/i.test(s)) sc += 1.2;
    if (/\b(is|are|refers to|means)\b/.test(low)) sc += 0.4;
    sc = sc / Math.pow(wordCount(s), 0.35) + (i < 3 ? 0.4 : 0);
    return { s, i, sc };
  });
}

export function summarize(text, n = 6) {
  const sents = sentences(text);
  if (sents.length <= n) return sents;
  const kws = keywords(text, 25);
  const scored = sentenceScores(sents, kws).sort((a, b) => b.sc - a.sc);
  const chosen = [];
  for (const c of scored) {
    if (chosen.length >= n) break;
    const cw = new Set(contentWords(c.s));
    const dup = chosen.some((x) => { const xw = contentWords(x.s); return xw.filter((w) => cw.has(w)).length / Math.max(1, xw.length) > 0.6; });
    if (!dup) chosen.push(c);
  }
  return chosen.sort((a, b) => a.i - b.i).map((c) => c.s);
}

/* ---------- dates, lists ---------- */

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})s?\b|\b(\d{1,4})\s?(BCE|BC|CE|AD)\b/;
export function datedEvents(text) {
  const out = [];
  for (const s of sentences(text)) {
    const m = s.match(YEAR);
    if (!m) continue;
    let y = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 10) * (/B/.test(m[3]) ? -1 : 1);
    // The date is shown separately, so drop a leading "1879 - " / "In 1848, " from the event text.
    const ev = s.replace(/^\s*(?:in\s+)?(?:\d{3,4}s?|\d{1,4}\s?(?:BCE|BC|CE|AD))\s*[-–—:,]?\s*/i, "");
    out.push({ date: m[0], year: y, event: ev.charAt(0).toUpperCase() + ev.slice(1) });
  }
  const seen = new Set();
  return out.filter((e) => { const k = e.event.slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.year - b.year);
}

export function lists(text) {
  const out = [];
  const lines = String(text).split("\n");
  let cur = null, title = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue; // blank lines between items don't end a list
    const m = l.match(/^(?:(\d+)[.)]|[•*\-–▪◦])\s+(.{3,160})$/);
    if (m) { if (!cur) cur = { title, items: [], numbered: !!m[1] }; cur.items.push(m[2].replace(/[.;]$/, "")); }
    else { if (cur && cur.items.length >= 3) out.push(cur); cur = null; if (l) title = l.length <= 70 && !/[.!?]$/.test(l) ? l.replace(/:$/, "") : ""; }
  }
  if (cur && cur.items.length >= 3) out.push(cur);
  return out.filter((l) => l.items.length <= 9);
}

/* ---------- search (BM25) ---------- */

export function buildIndex(materials, maxWords = 220) {
  const docs = [];
  for (const m of materials) {
    const paras = String(m.text).split(/\n{2,}|\n(?=Slide \d+)/);
    let buf = "";
    for (const p of paras) {
      if (wordCount(buf + " " + p) > maxWords && buf) { docs.push({ mat: m.name, matId: m.id, text: buf.trim() }); buf = ""; }
      buf += (buf ? "\n" : "") + p;
    }
    if (buf.trim()) docs.push({ mat: m.name, matId: m.id, text: buf.trim() });
  }
  const df = new Map();
  docs.forEach((d) => { d.terms = contentWords(d.text).map(stem); d.len = d.terms.length; new Set(d.terms).forEach((t) => df.set(t, (df.get(t) || 0) + 1)); });
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length);
  return {
    search(q, k = 5) {
      const qt = [...new Set(contentWords(q).map(stem))];
      if (!qt.length) return [];
      return docs.map((d) => {
        let sc = 0;
        for (const t of qt) {
          const f = d.terms.filter((x) => x === t).length;
          if (!f) continue;
          const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
          sc += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg));
        }
        return { ...d, score: sc };
      }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

/* ---------- grounding (does a statement come from the notes?) ---------- */

// Share of a statement's words (numbers included) found in the single best-matching sentence of the notes.
export function groundScore(statement, text) {
  const words = (s) => tokens(s).filter((w) => !STOP.has(w) && w.length > 1).map(stem);
  const sw = [...new Set(words(statement))];
  if (!sw.length) return 0;
  let best = 0;
  for (const sent of String(text).split(/\n|(?<=[.!?])\s+/)) {
    const set = new Set(words(sent));
    const hit = sw.filter((w) => set.has(w)).length / sw.length;
    if (hit > best) best = hit;
  }
  return best;
}

// Makes a false version of a true statement by changing its year or swapping in a different person
// from the notes. Both are reliably false because the notes tie each date and name to a specific fact.
// (Swapping ordinary terms was tried and removed: it can accidentally produce a true statement.)
// Returns null if neither is possible.
export function falsify(statement, text) {
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const has = (s, t) => new RegExp(`\\b${reEsc(t)}\\b`, "i").test(s);
  const year = statement.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (year) {
    for (const d of shuffle([-9, -7, -5, -4, -3, -2, 2, 3, 4, 5, 7, 9])) {
      const y = String(+year[1] + d);
      if (!String(text).includes(y)) return statement.replace(year[1], y);
    }
  }
  // People: "First Last" used the way names are ("by Matthias Schleiden", "Rudolf Virchow added").
  const NAME = "([A-Z][a-z]+ [A-Z][a-z]{2,})";
  const names = new Set();
  for (const re of [new RegExp(`\\b(?:by|and|with|from)\\s+${NAME}`, "g"),
    new RegExp(`${NAME}\\s+(?:added|described|showed|proposed|discovered|wrote|argued|said|developed|founded|invented|led|commanded|signed)\\b`, "g")]) {
    for (const m of String(text).matchAll(re)) names.add(m[1]);
  }
  const people = [...names];
  for (const full of shuffle(people.filter((n) => statement.includes(n)))) {
    const other = shuffle(people).find((o) => o !== full && !statement.includes(o));
    if (other) return statement.replace(full, other);
  }
  for (const full of shuffle(people)) {
    const last = full.split(" ")[1];
    if (!has(statement, last)) continue;
    const other = shuffle(people).map((o) => o.split(" ")[1]).find((o) => o !== last && !has(statement, o));
    if (other) return statement.replace(new RegExp(`\\b${reEsc(last)}\\b`), other);
  }
  return null;
}

// False statements that pair a term with a different term's definition from the notes, e.g.
// "Mitochondria: the organelle that stores the cell's DNA". The most similar definition is used so the
// trap is believable. Reliable because each definition in the notes belongs to one specific term.
export function swappedDefinitions(text, n) {
  const defs = definitions(text).filter((d) => d.def.length < 200);
  const bag = (d) => new Set(contentWords(d.def).map(stem));
  const sim = (a, b) => { const A = bag(a), B = bag(b); const k = [...A].filter((w) => B.has(w)).length; return k / (A.size + B.size - k || 1); };
  const out = [];
  for (const a of shuffle(defs)) {
    if (out.length >= n) break;
    const b = defs.filter((x) => x !== a && x.term.toLowerCase() !== a.term.toLowerCase() && sim(a, x) < 0.6)
      .sort((x, y) => sim(a, y) - sim(a, x))[0];
    if (!b) continue;
    out.push({ id: uid(), statement: `${a.term}: ${b.def.charAt(0).toLowerCase() + b.def.slice(1)}`, isTrue: false, explanation: `False. That describes ${b.term}. ${a.term}: ${a.def}` });
  }
  return out;
}

/* ---------- grading ---------- */

// Scores a written answer by how many key points it touches. Returns 0..1 plus which points matched.
export function keywordGrade(answer, points) {
  const aw = new Set(contentWords(answer).map(stem));
  const res = points.map((p) => {
    const alts = String(p).split("|");
    const hit = alts.some((alt) => {
      const pw = contentWords(alt).map(stem);
      if (!pw.length) return false;
      const n = pw.filter((w) => aw.has(w)).length;
      return n / pw.length >= (pw.length <= 2 ? 1 : 0.5);
    });
    return { point: alts[0], hit };
  });
  const score = res.length ? res.filter((r) => r.hit).length / res.length : 0;
  return { score, points: res };
}

export const normAns = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export function closeEnough(a, b) {
  a = normAns(a); b = normAns(b);
  if (!a) return false;
  if (a === b) return true;
  if (b.length > 4 && (a.includes(b) || (b.includes(a) && a.length >= b.length * 0.7))) return true;
  const d = lev(a, b);
  return d <= Math.max(1, Math.floor(b.length / 6));
}
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

/* ---------- item generators (no AI) ---------- */

const keyPointsFrom = (s, n = 4) => keywords(s, n).length ? keywords(s, n) : contentWords(s).slice(0, n);

export const gen = {
  glossary(text) {
    return definitions(text).map((d) => ({ id: uid(), term: d.term, definition: d.def, example: "" }));
  },

  flashcards(text, count) {
    const defs = definitions(text);
    const cards = defs.map((d) => ({ id: uid(), front: d.term, back: d.def, keywords: keyPointsFrom(d.def, 4) }));
    for (const l of lists(text)) {
      if (cards.length >= count * 1.5) break;
      if (!l.title) continue;
      cards.push({ id: uid(), front: `${l.title}: list them`, back: l.items.map((x, i) => `${i + 1}. ${x}`).join("\n"), keywords: l.items.map((x) => contentWords(x).slice(0, 2).join(" ")).filter(Boolean) });
    }
    if (cards.length < count) {
      for (const sec of sectionize(text)) {
        if (cards.length >= count) break;
        const sum = summarize(sec.text, 2);
        if (sum.length) cards.push({ id: uid(), front: `Explain: ${sec.heading}`, back: sum.join(" "), keywords: keyPointsFrom(sum.join(" "), 4) });
      }
    }
    return pick(cards, count);
  },

  mcq(text, count) {
    const defs = definitions(text);
    const out = [];
    if (defs.length >= 4) {
      for (const d of shuffle(defs)) {
        const others = pick(defs.filter((x) => x !== d), 3);
        if (Math.random() < 0.6) {
          const opts = shuffle([d.term, ...others.map((o) => o.term)]);
          out.push({ id: uid(), question: `Which term matches this description?\n“${d.def}”`, options: opts, answer: opts.indexOf(d.term), explanation: `${d.term}: ${d.def}` });
        } else {
          const opts = shuffle([d.def, ...others.map((o) => o.def)]);
          out.push({ id: uid(), question: `What best describes “${d.term}”?`, options: opts, answer: opts.indexOf(d.def), explanation: `${d.term}: ${d.def}` });
        }
      }
    }
    if (out.length < count) {
      const kws = keywords(text, 40).filter((k) => !k.includes(" ") || true);
      for (const c of gen.cloze(text, count * 2)) {
        if (out.length >= count) break;
        const wrong = pick(kws.filter((k) => normAns(k) !== normAns(c.answer)), 3);
        if (wrong.length < 3) break;
        const opts = shuffle([c.answer, ...wrong]);
        out.push({ id: uid(), question: `Fill in the blank:\n${c.text}`, options: opts, answer: opts.indexOf(c.answer), explanation: c.full });
      }
    }
    return out.slice(0, count);
  },

  truefalse(text, count) {
    const defs = definitions(text);
    const out = [];
    for (const d of shuffle(defs)) {
      if (Math.random() < 0.5 || defs.length < 2) out.push({ id: uid(), statement: `${d.term}: ${d.def}`, isTrue: true, explanation: "This matches your notes." });
      else {
        const o = pick(defs.filter((x) => x !== d), 1)[0];
        out.push({ id: uid(), statement: `${d.term}: ${o.def}`, isTrue: false, explanation: `False. That describes ${o.term}. ${d.term}: ${d.def}` });
      }
    }
    for (const e of datedEvents(text)) {
      if (out.length >= count * 1.5) break;
      if (Math.random() < 0.5) out.push({ id: uid(), statement: e.event, isTrue: true, explanation: "This matches your notes." });
      else {
        const y = String(e.year + (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 15)));
        out.push({ id: uid(), statement: e.event.replace(String(e.year), y), isTrue: false, explanation: `False. The correct date is ${e.date}. ${e.event}` });
      }
    }
    return pick(out, count);
  },

  cloze(text, count) {
    const kws = keywords(text, 60);
    const out = [];
    for (const s of summarize(text, count * 3)) {
      const low = s.toLowerCase();
      const k = kws.find((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(low));
      if (!k) continue;
      const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const answer = s.match(re)[0];
      out.push({ id: uid(), text: s.replace(re, "_____"), answer, hint: `${answer.length} letters, starts with “${answer[0]}”`, full: s });
    }
    return out.slice(0, count);
  },

  matching(text, count) {
    const defs = shuffle(definitions(text));
    const sets = [];
    for (let i = 0; i + 4 <= defs.length && sets.length < count; i += 5) {
      sets.push({ id: uid(), title: `Match set ${sets.length + 1}`, pairs: defs.slice(i, i + 5).map((d) => ({ term: d.term, match: d.def })) });
    }
    return sets;
  },

  ordering(text, count) {
    const sets = [];
    for (const l of lists(text)) if (l.numbered) sets.push({ id: uid(), title: l.title || "Put these in order", steps: l.items });
    const ev = datedEvents(text);
    for (let i = 0; i + 4 <= ev.length; i += 5) sets.push({ id: uid(), title: "Put these events in time order", steps: ev.slice(i, i + 5).map((e) => e.event) });
    return sets.slice(0, count);
  },

  short(text, count) {
    const out = [];
    for (const d of shuffle(definitions(text))) out.push({ id: uid(), question: `Define “${d.term}” and give an example.`, model_answer: d.def, key_points: keyPointsFrom(d.def, 4) });
    for (const sec of sectionize(text)) {
      const sum = summarize(sec.text, 3).join(" ");
      if (sum) out.push({ id: uid(), question: `Explain the main ideas of “${sec.heading}”.`, model_answer: sum, key_points: keyPointsFrom(sec.text, 5) });
    }
    return pick(out, count);
  },

  essay(text, count, className = "this course") {
    const secs = sectionize(text);
    const kws = keywords(text, 12);
    const T = [
      (a, b) => `Compare and contrast ${a} and ${b}. Use specific examples from ${className}.`,
      (a) => `Evaluate the importance of ${a}. What are its strengths and limitations?`,
      (a, b) => `How does ${a} relate to ${b}? Build an argument supported by evidence.`,
      (a) => `To what extent is ${a} the central idea of this material? Defend your position.`,
    ];
    const topics = secs.length >= 2 ? secs.map((s) => s.heading) : kws;
    const out = [];
    for (let i = 0; i < count && topics.length; i++) {
      const [a, b] = pick(topics, 2);
      out.push({ id: uid(), prompt: T[i % T.length](a, b || kws[0] || "the course themes"), rubric: DEFAULT_RUBRIC, outline: ["Thesis that answers the prompt directly", `Body 1: ${a}`, b ? `Body 2: ${b}` : "Body 2: supporting evidence", "Counter-argument and response", "Conclusion that ties back to the thesis"] });
    }
    return out;
  },

  summary(text, mode = "detailed") {
    const secs = sectionize(text);
    const n = mode === "short" ? 1 : mode === "bullets" ? 3 : 3;
    return {
      overview: summarize(text, mode === "short" ? 3 : 5).join(" "),
      sections: secs.slice(0, 30).map((s) => ({ heading: s.heading, text: summarize(s.text, n).join(" ") })).filter((s) => s.text),
      key_points: summarize(text, 8),
    };
  },

  guide(text) {
    const defs = definitions(text);
    return {
      sections: sectionize(text).map((s) => {
        const low = s.text.toLowerCase();
        return { heading: s.heading, points: summarize(s.text, 4), terms: defs.filter((d) => low.includes(d.term.toLowerCase())).map((d) => d.term).slice(0, 6) };
      }).filter((s) => s.points.length),
    };
  },

  cheatsheet(text) {
    return {
      sections: [
        { heading: "Key terms", items: definitions(text).slice(0, 40).map((d) => `${d.term}: ${d.def}`) },
        { heading: "Must-know points", items: summarize(text, 12) },
        ...lists(text).slice(0, 6).map((l) => ({ heading: l.title || "List", items: l.items })),
        ...(datedEvents(text).length ? [{ heading: "Dates", items: datedEvents(text).slice(0, 12).map((e) => `${e.date}: ${e.event}`) }] : []),
      ].filter((s) => s.items.length),
    };
  },

  conceptmap(text, center) {
    const defs = definitions(text);
    const secs = sectionize(text, center).slice(0, 8);
    return {
      center,
      branches: secs.map((s) => {
        const low = s.text.toLowerCase();
        const kids = defs.filter((d) => low.includes(d.term.toLowerCase())).slice(0, 5).map((d) => ({ label: d.term, note: d.def.slice(0, 120) }));
        const extra = kids.length < 3 ? keywords(s.text, 5 - kids.length).map((k) => ({ label: cap(k), note: "" })) : [];
        return { label: s.heading, children: [...kids, ...extra] };
      }),
    };
  },

  timeline(text) { return { events: datedEvents(text).map((e) => ({ id: uid(), date: e.date, event: e.event, detail: "" })) }; },

  compare(text) {
    const defs = definitions(text);
    const tables = [];
    for (let i = 0; i + 1 < defs.length && tables.length < 6; i += 2) {
      const [a, b] = [defs[i], defs[i + 1]];
      tables.push({ title: `${a.term} vs. ${b.term}`, items: [a.term, b.term], rows: [{ aspect: "What it is", values: [a.def, b.def] }, { aspect: "Key words", values: [keyPointsFrom(a.def, 4).join(", "), keyPointsFrom(b.def, 4).join(", ")] }] });
    }
    return { tables };
  },

  simplify(text) {
    return { sections: sectionize(text).map((s) => ({ heading: s.heading, simple: summarize(s.text, 3).filter((x) => wordCount(x) < 30).join(" ") || summarize(s.text, 1).join(" ") })).filter((s) => s.simple) };
  },

  mnemonics(text) {
    return {
      mnemonics: lists(text).filter((l) => l.items.length >= 3 && l.items.length <= 8).map((l) => {
        const letters = l.items.map((x) => (x.match(/[A-Za-z]/) || ["?"])[0].toUpperCase()).join("");
        return { id: uid(), topic: l.title || "List", items: l.items, device: `Acronym: ${letters}`, explanation: l.items.map((x) => `${x[0].toUpperCase()} = ${x}`).join(" · ") };
      }),
    };
  },

  predict(text, count) {
    const out = [];
    const cue = /\b(important|key|main|significant|essential|crucial|major|primary|because|therefore|result|cause)\b/i;
    for (const s of sentences(text).filter((s) => cue.test(s))) out.push({ id: uid(), question: `Explain why this matters: “${s}”`, why: "Your notes flag this as important.", answer_outline: keyPointsFrom(s, 4) });
    for (const d of definitions(text).slice(0, count)) out.push({ id: uid(), question: `Define ${d.term} and explain its significance.`, why: "Defined terms are common exam questions.", answer_outline: keyPointsFrom(d.def, 4) });
    return pick(out, count);
  },

  analysis(text, count) {
    const quotes = [...String(text).matchAll(/[“"]([^”"]{50,400})[”"]/g)].map((m) => m[1]);
    const pool = quotes.length >= 3 ? quotes : summarize(text, count * 2).filter((s) => wordCount(s) > 14);
    const Q = ["What is the main idea of this passage, and how is it supported?", "What does this passage reveal about the larger topic?", "Explain the significance of this passage. Why might it matter on an exam?", "What assumptions or arguments does this passage make?"];
    return pick(pool, count).map((p, i) => ({ id: uid(), quote: p, question: Q[i % Q.length], points: keyPointsFrom(p, 4) }));
  },

  explain(text, count) {
    const out = sectionize(text).map((s) => ({ id: uid(), topic: s.heading, key_points: keyPointsFrom(s.text, 6) }));
    for (const d of definitions(text)) out.push({ id: uid(), topic: d.term, key_points: keyPointsFrom(d.def, 4) });
    return out.slice(0, count);
  },
};

export const DEFAULT_RUBRIC = [
  { criterion: "Thesis & argument", points: 4, description: "Clear position that directly answers the prompt." },
  { criterion: "Evidence & examples", points: 4, description: "Specific, accurate support from the course material." },
  { criterion: "Analysis", points: 4, description: "Explains how evidence supports the claim, not just what it says." },
  { criterion: "Organization & clarity", points: 3, description: "Logical structure, smooth transitions, clear writing." },
];
