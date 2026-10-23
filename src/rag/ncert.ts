// NCERT retriever (DECISIONS.md D9). Lexical BM25 over a small local corpus,
// so doubt answers and citation checks run offline at $0. An embedding
// retriever can replace `retrieve` later behind the same Retriever interface.
//
// Grounding (D21): a question is answered only when the covered notes contain
// supporting evidence for its key terms. Word overlap alone is not enough:
// a curated list of out-of-chapter concepts (potential energy, capacitors,
// current electricity, ...) must appear in the cited text, or the question is
// refused with a scope-limit explanation. This is lexical evidence, not
// understanding: it cannot tell a mention from an explanation.
//
// Phrase evidence (D22): the answering note is chosen by the question's word
// pairs it states close together ("line charge"), not only by the words it
// contains anywhere, and a known phrase narrowed by a word the notes never use
// ("finite charged rod") is refused.

import fs from "node:fs";

export interface Chunk {
  id: string;
  section: string;
  title: string;
  pages: number[];
  text: string;
}

export interface Corpus {
  corpus: string;
  book: string;
  chapter: number;
  chapterTitle: string;
  sourceFile: string;
  edition: string;
  provenance: string;
  chunks: Chunk[];
}

export interface Hit {
  chunk: Chunk;
  score: number;
  /** question terms (stems) found in this chunk, including alias matches */
  matched: string[];
}

export interface Retriever {
  corpus: Corpus;
  retrieve(query: string, k?: number): Hit[];
  /** question terms after stop-word, filler, alias and typo handling */
  analyze(query: string): QTerm[];
  /** multi-word phrases in the question ("two point charges", "line charge") */
  phrases(query: string): QPhrase[];
  /** true when a form of `a` and a form of `b` occur within `maxDist` words of each other in one clause of the chunk */
  near(chunkId: string, a: string[], b: string[], maxDist?: number): boolean;
  /** terms of a chunk (stems) */
  chunkTerms(chunkId: string): Set<string>;
  /** number of chunks containing the term */
  df(term: string): number;
}

/**
 * A run of adjacent content words in the question, with no stop word, filler
 * word or punctuation between them. The last word is treated as the head
 * ("charge" in "two point charges") and the others as its modifiers.
 */
export interface QPhrase {
  raw: string[];
  terms: QTerm[];
  /** the phrase starts at the first word of the question */
  first: boolean;
}

export interface QTerm {
  /** the question word as written (first occurrence) */
  raw: string;
  stem: string;
  /** acceptable alternatives (plain-language -> textbook words), stemmed */
  alts: string[];
  /** the term occurs somewhere in the corpus */
  inVocab: boolean;
  weight: number;
}

const STOP = new Set(
  "a an the of to in on for and or is are was were be been it its this that these those what why how which when who whom does do did can could should would will shall may might explain define state derive give tell me my i you your we our about with by from as at into than then there their them they his her he she not no yes please also between each".split(
    " "
  )
);

// Romanised Hindi / Hinglish question frame words.
const HINGLISH = new Set("kya hai hain hota hoti hote ka ki ke ko se mein me aur batao bataiye samjhao samjhaiye matlab kaise kyun kyon kaun kaunsi kaunsa kab kahan fark niyam".split(" "));

// Request-frame words that carry no topic.
const FILLER_RAW =
  "change find keep kept begin end away easily near due related relation calculate value meant mean means example get found show number many much long case kind type thing way use used using make made take go goes going fast quickly rapidly statement definition formula expression note short brief derivation need needed want ever extra write describe discuss list".split(
    " "
  );

/**
 * Plain-language words -> the textbook words they stand for. A lexicon, not a
 * model: it only widens what counts as a match for the listed words.
 */
const ALIASES: Record<string, string[]> = {
  push: ["repel"], pushes: ["repel"], pushing: ["repel"], pull: ["attract"], pulls: ["attract"], pulling: ["attract"],
  stick: ["attract"], sticks: ["attract"], cling: ["attract"], attraction: ["attract"], repulsion: ["repel"], repulsive: ["repel"], attractive: ["attract"],
  identical: ["like"], opposite: ["unlike"],
  gaussian: ["gauss"], sphere: ["spherical"], hollow: ["shell"], metal: ["conductor"], metals: ["conductor"],
  conducting: ["conductor"], conduct: ["conductor"], conducts: ["conductor"], conductive: ["conductor"],
  intersect: ["cross"], intersects: ["cross"], intersection: ["cross"],
  decrease: ["fall"], decreases: ["fall"], decreasing: ["fall"], diminish: ["fall"], diminishes: ["fall"],
  destroyed: ["destroy"], lost: ["destroy"], inside: ["enclose"],
  // added 2026-10-23 while reviewing frozen v2 failures (v2 is a development set from then on)
  third: ["other", "several", "multiple"], another: ["other"], additional: ["other"], line: ["linear"],
  direction: ["away", "toward", "towards", "radial", "along"],
};

export function stem(raw: string): string {
  let w = raw.replace(/iz(?=(e|ed|es|ing|ation|ations)$)/, "is");
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const FILLER = new Set(FILLER_RAW.map(stem));

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Stemmed tokens with stop words removed. Used for chunk text and answer text. */
export function tokenize(text: string): string[] {
  return words(text)
    .filter((t) => !STOP.has(t) && !HINGLISH.has(t))
    .map(stem);
}

export function loadCorpus(file: string): Corpus {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Corpus;
}

// Optimal-string-alignment distance (adjacent swaps count as one edit).
function osa(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export const OOV_WEIGHT = 1.0;

const CLAUSE = /[.,;:?!()=]/;

export function bm25Retriever(corpus: Corpus, params = { k1: 1.2, b: 0.75 }): Retriever {
  const docs = corpus.chunks.map((c) => tokenize(`${c.title} ${c.title} ${c.text}`));
  // Word positions per clause, stop words included, so "near" measures real distance.
  const clauses = corpus.chunks.map((c) => `${c.title}. ${c.text}`.split(CLAUSE).map((s) => words(s).map(stem)));
  const docSets = corpus.chunks.map((c, i) => new Set(docs[i]));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const d of docSets) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const vocab = [...df.keys()];

  function resolve(t: string): string {
    if (df.has(t)) return t;
    if (t.length < 5) return t;
    const max = t.length >= 7 ? 2 : 1;
    let best: string | null = null;
    let bestD = max + 1;
    let tie = false;
    for (const v of vocab) {
      if (Math.abs(v.length - t.length) > max) continue;
      // "light" must not become "lightning": a pure prefix/suffix difference is a different word, not a typo.
      if (v.startsWith(t) || t.startsWith(v)) continue;
      const dist = osa(t, v);
      if (dist < bestD) {
        best = v;
        bestD = dist;
        tie = false;
      } else if (dist === bestD) tie = true;
    }
    return best && !tie && bestD <= max ? best : t;
  }

  /** null for stop, Hinglish frame and filler words */
  function termOf(w: string): QTerm | null {
    if (STOP.has(w) || HINGLISH.has(w)) return null;
    const s0 = stem(w);
    if (FILLER.has(s0)) return null;
    const alts = (ALIASES[w] ?? []).map(stem);
    let s = s0;
    if (!df.has(s) && !alts.some((a) => df.has(a))) s = resolve(s);
    const inVocab = df.has(s) || alts.some((a) => df.has(a));
    const known = [s, ...alts].filter((x) => df.has(x));
    const weight = inVocab ? Math.max(...known.map(idf)) : OOV_WEIGHT;
    return { raw: w, stem: s, alts, inVocab, weight };
  }

  function analyze(query: string): QTerm[] {
    const out = new Map<string, QTerm>();
    for (const w of words(query)) {
      const t = termOf(w);
      if (t && !out.has(t.stem)) out.set(t.stem, t);
    }
    return [...out.values()];
  }

  function phrases(query: string): QPhrase[] {
    const out: QPhrase[] = [];
    let pos = 0;
    for (const clause of query.split(CLAUSE)) {
      let run: QPhrase = { raw: [], terms: [], first: false };
      const flush = () => {
        if (run.terms.length >= 2) out.push(run);
        run = { raw: [], terms: [], first: false };
      };
      for (const w of words(clause)) {
        const t = termOf(w);
        if (!t) flush();
        else {
          if (!run.terms.length) run.first = pos === 0;
          run.raw.push(w);
          run.terms.push(t);
        }
        pos++;
      }
      flush();
    }
    return out;
  }

  function near(chunkId: string, a: string[], b: string[], maxDist = 3): boolean {
    const i = corpus.chunks.findIndex((c) => c.id === chunkId);
    for (const cl of clauses[i] ?? []) {
      const pa = cl.flatMap((w, p) => (a.includes(w) ? [p] : []));
      const pb = cl.flatMap((w, p) => (b.includes(w) ? [p] : []));
      if (pa.some((x) => pb.some((y) => x !== y && Math.abs(x - y) <= maxDist))) return true;
    }
    return false;
  }

  return {
    corpus,
    analyze,
    phrases,
    near,
    df: (t) => df.get(t) ?? 0,
    chunkTerms: (id) => docSets[corpus.chunks.findIndex((c) => c.id === id)] ?? new Set(),
    retrieve(query, k = 3) {
      const q = analyze(query);
      const hits: Hit[] = docs.map((d, i) => {
        let score = 0;
        const matched: string[] = [];
        for (const t of q) {
          const forms = [t.stem, ...t.alts];
          const tf = Math.max(...forms.map((f) => d.filter((x) => x === f).length));
          if (!tf) continue;
          matched.push(t.stem);
          const form = forms.filter((f) => df.has(f)).sort((a, b) => idf(b) - idf(a))[0] ?? t.stem;
          score += idf(form) * ((tf * (params.k1 + 1)) / (tf + params.k1 * (1 - params.b + (params.b * d.length) / avgLen)));
        }
        return { chunk: corpus.chunks[i], score, matched };
      });
      return hits
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, k);
    },
  };
}

/** Human citation, e.g. "NCERT Physics Part I, Class 12, Ch 1, §1.5, pp. 6-8". */
export function citeChunk(corpus: Corpus, c: Chunk): string {
  const p = c.pages.length > 1 ? `pp. ${c.pages[0]}-${c.pages[c.pages.length - 1]}` : `p. ${c.pages[0]}`;
  return `${corpus.book}, Ch ${corpus.chapter}, §${c.section}, ${p}`;
}

// --- Out-of-chapter concepts -------------------------------------------------
// A question that names one of these concepts is answered only if the concept
// also appears in the retrieved notes. Shared words like "electric", "charge"
// or "field" do not count as support.

interface ScopeConcept {
  id: string;
  label: string;
  re: RegExp;
  /** where the standard NCERT order usually puts it; omitted when unsure */
  usually?: string;
}

export const OUT_OF_CHAPTER: ScopeConcept[] = [
  {
    id: "potential",
    label: "electric potential and potential energy",
    re: /\b(electric(al)?\s+potential|electrostatic\s+potential|potential\s+(energy|difference|due\s+to|at\s+a)|equipotential\w*|voltage|work\s+done|work\s+required)\b/i,
    usually: "usually Ch 2, Electrostatic Potential and Capacitance",
  },
  {
    id: "capacitance",
    label: "capacitors and dielectrics",
    re: /\b(capacit\w+|dielectric\w*|farad\w*|parallel[-\s]plate|relative\s+permittivity|permittivity\s+of\s+(a\s+)?(medium|material))\b/i,
    usually: "usually Ch 2, Electrostatic Potential and Capacitance",
  },
  {
    id: "current",
    label: "current electricity",
    re: /\b(current|resist\w+|ohm\w*|kirchhoff\w*|drift|emf|battery|circuit\w*|ammeter|voltmeter|wheatstone|conductivity)\b/i,
    usually: "usually Ch 3, Current Electricity",
  },
  {
    id: "magnetism",
    label: "magnetism and electromagnetic induction",
    re: /\b(magnet\w*|biot|savart|ampere\w*|solenoid\w*|lorentz|tesla|faraday\w*|lenz\w*|induct\w*|eddy|transformer\w*|alternating|reactance|impedance)\b/i,
    usually: "a later Class 12 chapter",
  },
  {
    id: "optics-modern",
    label: "optics and modern physics",
    re: /\b(photoelectric|photon\w*|wavelength|de\s+broglie|bohr|nucle(us|i|ar)|radioactiv\w*|semiconductor\w*|diode\w*|transistor\w*|lens(es)?|mirror\w*|refraction|refractive|reflection|interference|diffraction|prism|telescope|microscope)\b/i,
    usually: "a later Class 12 chapter",
  },
  { id: "mechanics", label: "mechanics (laws of motion)", re: /\b(newton['’]?s|laws?\s+of\s+motion|momentum|friction|projectile\w*|kinematics?|accelerat\w*|velocity)\b/i, usually: "Class 11 Physics" },
  { id: "devices", label: "electrostatic machines and devices", re: /\b(van\s+de\s+graaff|generator\w*|dynamo|motor)\b/i },
  { id: "history-particle-facts", label: "particle facts and history", re: /\b(mass\s+of|discover(ed|y|er|s)?|invent(ed|or|ion)|history\s+of|atomic\s+number|isotope\w*)\b/i },
  { id: "other-subject", label: "another subject (chemistry or maths)", re: /\b(chemical|reaction\w*|hybridi[sz]ation|photosynthesis|enzyme\w*|organic|periodic\s+table|derivative\w*|differentiat\w*|integrat\w*|integral\w*|sin\s*x|cos\s*x|logarithm\w*|matrix|matrices|determinant\w*|probability)\b/i },
];

export interface ScopeLimit {
  /** concepts the question names that the covered notes do not contain */
  concepts: { id: string; label: string; usually?: string }[];
}

// Gate thresholds. Set on the dev questions in test/fixtures/rag-dev.ts and
// the 22 earlier questions in test/rag.test.ts (not on any held-out set).
export const MIN_SCORE = 2.0;
export const MIN_COVERAGE = 0.55; // weighted share of question terms found in the answering chunk
export const MIN_ANCHOR_DF = 4; // an "anchor" is a matched term that occurs in at most this many chunks
export const NO_ANCHOR_COVERAGE = 0.75; // without an anchor, coverage must be higher

export interface GroundingDecision {
  inSyllabus: boolean;
  reason: string;
  /** top hits; when answerable, the answering chunk is first */
  hits: Hit[];
  /** weighted coverage of the question by the answering chunk (0 when none) */
  coverage: number;
  scopeLimit?: ScopeLimit;
  /** question terms the answering chunk did not contain */
  missing?: string[];
  /** why the chosen chunk was picked: the question phrases it states together, and the terms it contains */
  support?: { chunkId: string; phrases: string[]; terms: string[] };
}

/** Word pairs of a question phrase (each modifier with the head) that a chunk states together. */
function phraseSupport(r: Retriever, chunkId: string, phrases: QPhrase[]): { pairs: string[]; weight: number; max: number } {
  const pairs: string[] = [];
  let weight = 0;
  let max = 0;
  for (const p of phrases) {
    const head = p.terms[p.terms.length - 1];
    if (!head.inVocab) continue;
    p.terms.slice(0, -1).forEach((m, i) => {
      if (!m.inVocab) return;
      max += m.weight + head.weight;
      if (!r.near(chunkId, [m.stem, ...m.alts], [head.stem, ...head.alts])) return;
      pairs.push(`${p.raw[i]} ${p.raw[p.raw.length - 1]}`);
      weight += m.weight + head.weight;
    });
  }
  return { pairs, weight, max };
}

export function groundQuestion(r: Retriever, question: string, k = 3): GroundingDecision {
  // Every chunk with any match is a candidate; only the first k are returned.
  const all = r.retrieve(question, r.corpus.chunks.length);
  const hits = all.slice(0, k);
  const q = r.analyze(question);
  const phrases = r.phrases(question);

  // 1. Out-of-chapter concepts must appear in the covered notes.
  const absent = OUT_OF_CHAPTER.filter((c) => c.re.test(question) && !r.corpus.chunks.some((ch) => c.re.test(`${ch.title} ${ch.text}`)));
  if (absent.length) {
    return {
      inSyllabus: false,
      reason: `question names ${absent.map((c) => c.label).join(", ")}; the covered notes do not contain it`,
      hits,
      coverage: 0,
      scopeLimit: { concepts: absent.map(({ id, label, usually }) => ({ id, label, usually })) },
    };
  }

  const top = hits[0];
  if (!top) return { inSyllabus: false, reason: "no chunk matched any question word", hits, coverage: 0 };
  if (!q.length) return { inSyllabus: false, reason: "no content words in the question", hits, coverage: 0 };

  // 2. A phrase the notes use, narrowed by a word the notes never use ("finite" in
  // "finite charged rod" when the notes only have "charged rod"), asks about something
  // more specific than the notes cover. Lexical: it cannot tell a narrowing adjective
  // from an unrelated word, so it only fires when the unknown word sits directly before
  // a known modifier-head pair that the notes state together.
  const narrowed = phrases.flatMap((p) => {
    const n = p.terms.length;
    for (let i = 0; i + 2 < n; i++) {
      const [w, m, head] = [p.terms[i], p.terms[i + 1], p.terms[n - 1]];
      if (w.inVocab || !m.inVocab || !head.inVocab) continue;
      // the first word of a question is usually a request verb ("Write Coulomb's law ..."), not a qualifier
      if (p.first && i === 0) continue;
      if (r.corpus.chunks.some((c) => r.near(c.id, [m.stem, ...m.alts], [head.stem, ...head.alts]))) return [{ phrase: p.raw.slice(i).join(" "), unknown: p.raw[i] }];
    }
    return [];
  });
  if (narrowed.length) {
    const concepts = narrowed.map((x) => ({ id: "narrowed-phrase", label: `"${x.phrase}" (the notes never say "${x.unknown}")` }));
    return { inSyllabus: false, reason: `question names ${concepts.map((c) => c.label).join("; ")}`, hits, coverage: 0, scopeLimit: { concepts } };
  }

  // 3. Pick the chunk that supports the question best. Phrase pairs the chunk states
  // together (modifier near head, same clause) count as extra evidence on top of the
  // single terms, so "force between two point charges" picks Coulomb's law over a note
  // that only contains the words, and "line charge" picks the line-charge note over
  // the field-lines note.
  const total = q.reduce((s, t) => s + t.weight, 0);
  const scored = all.map((h) => {
    const id = h.chunk.id;
    const terms = r.chunkTerms(id);
    const got = q.filter((t) => terms.has(t.stem) || t.alts.some((a) => terms.has(a)));
    const cov = got.reduce((s, t) => s + t.weight, 0) / total;
    const anchor = got.some((t) => Math.min(r.df(t.stem) || 99, ...t.alts.map((a) => r.df(a) || 99)) <= MIN_ANCHOR_DF);
    const phrase = phraseSupport(r, id, phrases);
    const support = (got.reduce((s, t) => s + t.weight, 0) + phrase.weight) / (total + phrase.max);
    return { h, cov, anchor, phrase, support, got: got.map((t) => t.raw), missing: q.filter((t) => !got.includes(t)).map((t) => t.raw) };
  });
  const best = [...scored].sort((a, b) => b.support - a.support || b.h.score - a.h.score)[0];
  const ordered = [best.h, ...all.filter((h) => h !== best.h)].slice(0, k);
  const support = { chunkId: best.h.chunk.id, phrases: best.phrase.pairs, terms: best.got };
  const why = `${best.phrase.pairs.length ? `; states together: ${best.phrase.pairs.map((p) => `"${p}"`).join(", ")}` : ""}`;

  if (best.h.score < MIN_SCORE) return { inSyllabus: false, reason: `best score ${best.h.score.toFixed(2)} < ${MIN_SCORE}`, hits: ordered, coverage: best.cov, missing: best.missing };
  if (best.cov < MIN_COVERAGE) {
    return { inSyllabus: false, reason: `best chunk supports ${(best.cov * 100).toFixed(0)}% of the question's key terms (< ${MIN_COVERAGE * 100}%); not found: ${best.missing.join(", ")}`, hits: ordered, coverage: best.cov, missing: best.missing };
  }
  if (!best.anchor && best.cov < NO_ANCHOR_COVERAGE) {
    return { inSyllabus: false, reason: `only common words matched and coverage ${(best.cov * 100).toFixed(0)}% < ${NO_ANCHOR_COVERAGE * 100}%`, hits: ordered, coverage: best.cov, missing: best.missing };
  }
  return {
    inSyllabus: true,
    reason: `best ${best.h.chunk.id} score ${best.h.score.toFixed(2)}, supports ${(best.cov * 100).toFixed(0)}% of key terms${why}`,
    hits: ordered,
    coverage: best.cov,
    missing: best.missing,
    support,
  };
}

export interface Citation {
  chunkId: string;
  pages: number[];
}

export interface CitationCheck {
  ok: boolean;
  failures: string[];
}

/**
 * Citation check. A citation must support the answer, not only point to a real
 * page. Every cited chunk must exist and be one of the retrieved chunks; every
 * cited page must belong to that chunk; at least one citation is required; the
 * answer must share content words with what it cites; and, when the question
 * and retriever are given, each cited chunk must contribute a distinctive term
 * to the answer, the cited text together must cover the question's key terms,
 * and any number in the answer must appear in the cited text.
 */
export function checkCitations(
  answer: string,
  citations: Citation[],
  retrieved: Chunk[],
  minOverlap = 0.3,
  opts?: { question?: string; retriever?: Retriever }
): CitationCheck {
  const failures: string[] = [];
  const byId = new Map(retrieved.map((c) => [c.id, c]));
  if (citations.length === 0) failures.push("no citation");
  const citedWords = new Set<string>();
  const citedText: string[] = [];
  const ans = [...new Set(tokenize(answer))];
  const r = opts?.retriever;
  for (const c of citations) {
    const chunk = byId.get(c.chunkId);
    if (!chunk) {
      failures.push(`cites ${c.chunkId}, which was not retrieved`);
      continue;
    }
    const badPages = c.pages.filter((p) => !chunk.pages.includes(p));
    if (badPages.length) failures.push(`${c.chunkId}: pages ${badPages.join(",")} not in chunk pages ${chunk.pages.join(",")}`);
    const terms = new Set(tokenize(`${chunk.title} ${chunk.text}`));
    for (const t of terms) citedWords.add(t);
    citedText.push(chunk.text);
  }
  if (r) {
    // Each cited chunk must add something: a distinctive answer term (rare in the notes) that
    // no other cited chunk supplies. A citation that only repeats another one is decoration.
    const termsOf = (c: Citation) => new Set(tokenize(`${byId.get(c.chunkId)!.title} ${byId.get(c.chunkId)!.text}`));
    const valid = citations.filter((c) => byId.has(c.chunkId));
    for (const c of valid) {
      const mine = termsOf(c);
      const others = valid.filter((o) => o !== c).map(termsOf);
      const unique = ans.filter((t) => mine.has(t) && (r.df(t) || 99) <= MIN_ANCHOR_DF && !others.some((o) => o.has(t)));
      if (!unique.length) failures.push(`${c.chunkId}: contributes no distinctive term to the answer`);
    }
  }
  if (ans.length && citedWords.size) {
    const overlap = ans.filter((t) => citedWords.has(t)).length / ans.length;
    if (overlap < minOverlap) failures.push(`answer shares ${(overlap * 100).toFixed(0)}% of words with cited text (< ${minOverlap * 100}%)`);
  }
  if (r && opts?.question && citedWords.size) {
    const q = r.analyze(opts.question);
    const total = q.reduce((s, t) => s + t.weight, 0);
    const got = q.filter((t) => citedWords.has(t.stem) || t.alts.some((a) => citedWords.has(a))).reduce((s, t) => s + t.weight, 0);
    if (total && got / total < MIN_COVERAGE) failures.push(`cited text supports ${((got / total) * 100).toFixed(0)}% of the question's key terms (< ${MIN_COVERAGE * 100}%)`);
  }
  if (r && citedText.length) {
    const sourceNums = new Set((citedText.join(" ") + " " + (opts?.question ?? "")).match(/\d+(?:\.\d+)?/g) ?? []);
    const bad = [...new Set(answer.match(/\d+(?:\.\d+)?/g) ?? [])].filter((n) => !sourceNums.has(n));
    if (bad.length) failures.push(`number ${bad.join(", ")} in the answer is not in the cited text`);
  }
  return { ok: failures.length === 0, failures };
}
