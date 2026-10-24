// Exam context: the student names their exam, country and goal, a research
// source returns candidate exams with sourced facts, ambiguity is resolved by
// asking the student, and each fact is marked verified only when it came from
// a fetched page on the exam body's official domain.
//
// Only an offline fixture source exists (src/context/fixtureExams.ts). It is a
// mock: nothing is fetched, so none of its facts can be verified. A web source
// would implement the same ResearchSource interface; it is not built, because
// it needs network access that has not been approved.

export interface StudentGoal {
  exam: string;
  country: string;
  goal: string;
  /** date the student says the exam is on (YYYY-MM-DD); used until an official date is verified */
  statedExamDate?: string;
}

export interface SourceRef {
  url: string;
  publisher: string;
  via: "fixture" | "web";
  /** when the page was fetched; null when it was never fetched */
  retrievedAt: string | null;
  /** date printed on the source, if any */
  publishedAt: string | null;
  note: string;
}

export interface ExamFact {
  key: string;
  value: string;
  source: SourceRef;
}

export interface ExamCandidate {
  id: string;
  name: string;
  body: string;
  country: string;
  /** phrases that make a student's wording match this exam */
  aliases: string[];
  /** words that pick this exam out of several matches */
  distinct: string[];
  officialDomains: string[];
  facts: ExamFact[];
  /** local note corpora that cover part of this exam's syllabus */
  corpora: string[];
}

export interface ResearchSource {
  name: string;
  kind: "fixture" | "web";
  find(goal: StudentGoal): Promise<ExamCandidate[]>;
  /** web sources: read the chosen exam's official pages and return sourced facts plus what could not be found */
  deepen?(candidate: ExamCandidate, goal: StudentGoal): Promise<{ facts: ExamFact[]; limits: string[]; pages?: string[] }>;
}

export interface CheckedFact extends ExamFact {
  status: "verified-official" | "unverified";
  why: string;
}

export interface ExamContext {
  goal: StudentGoal;
  exam: { id: string; name: string; body: string; country: string };
  resolvedBy: "single match" | "named in goal" | "student choice" | "student-stated, not researched";
  facts: CheckedFact[];
  examDate: { value: string; origin: "verified-official" | "student-stated" } | null;
  corpora: string[];
  research: { source: string; kind: "fixture" | "web" | "none"; ranAt: string; candidates: number; /** what the research could not find or was stopped by */ limits?: string[]; /** official pages actually read */ pages?: string[] };
}

export type ContextStep =
  | { status: "resolved"; context: ExamContext }
  | { status: "ambiguous"; question: string; options: { id: string; name: string; body: string }[] }
  | { status: "not_found"; reply: string };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A fact is verified only if it was fetched from a page on one of the exam body's official domains. */
export function checkFact(f: ExamFact, c: ExamCandidate): CheckedFact {
  const host = hostOf(f.source.url);
  const official = !!host && c.officialDomains.some((d) => host === d || host.endsWith(`.${d}`));
  if (f.source.via !== "web" || !f.source.retrievedAt) return { ...f, status: "unverified", why: "mock fixture: not fetched from the web" };
  if (!official) return { ...f, status: "unverified", why: `${host ?? "bad URL"} is not an official domain of ${c.body}` };
  return { ...f, status: "verified-official", why: `fetched ${f.source.retrievedAt} from ${host}` };
}

const lower = (s: string) => s.toLowerCase();

/**
 * One research step. Call again with `choice` (the student's reply) after an
 * "ambiguous" result. `ranAt` is passed in so runs are reproducible.
 */
export async function researchExam(source: ResearchSource, goal: StudentGoal, opts: { ranAt: string; choice?: string }): Promise<ContextStep> {
  const found = await source.find(goal).catch(() => [] as ExamCandidate[]);
  const naming = (text: string) => found.filter((c) => c.distinct.some((d) => new RegExp(`\\b${d}\\b`).test(lower(text))));
  let pick = found;
  let resolvedBy: ExamContext["resolvedBy"] = "single match";
  if (found.length > 1) {
    const named = naming(goal.exam);
    if (named.length) {
      pick = named;
      resolvedBy = "named in goal";
    }
    if (pick.length > 1 && opts.choice) {
      pick = naming(opts.choice).filter((c) => pick.includes(c));
      resolvedBy = "student choice";
    }
  }
  if (pick.length === 0) {
    const limits = source.kind === "web" && "lastLimits" in source ? (source as unknown as { lastLimits(): string[] }).lastLimits() : [];
    const what = found.length ? `"${opts.choice}" does not match any of the options` : `I could not find "${goal.exam}" (${goal.country})`;
    return {
      status: "not_found",
      reply:
        `${what}. ` +
        (source.kind === "fixture"
        ? "Web research is not built yet; I only have a small offline list of exams, so I can't look this up."
        : found.length
          ? "Please pick one of the exams I listed."
          : `I found no official website for it through public sources${limits.length ? ` (${limits.join("; ")})` : ""}, so I will not guess. Check the exam name and country.`),
    };
  }
  if (pick.length > 1) {
    return {
      status: "ambiguous",
      question: `"${goal.exam}" in ${goal.country} could mean ${pick.length} different exams. Which one are you taking?`,
      options: pick.map((c) => ({ id: c.id, name: c.name, body: c.body })),
    };
  }
  const c = pick[0];
  let extra: { facts: ExamFact[]; limits: string[]; pages?: string[] } = { facts: [], limits: [] };
  if (source.deepen) extra = await source.deepen(c, goal).catch(() => ({ facts: [], limits: ["research stopped on an internal error; no official facts were read"] }));
  const facts = [...c.facts, ...extra.facts].map((f) => checkFact(f, c));
  const officialDate = facts.find((f) => f.key === "exam_date" && f.status === "verified-official");
  const examDate = officialDate
    ? { value: officialDate.value, origin: "verified-official" as const }
    : goal.statedExamDate
      ? { value: goal.statedExamDate, origin: "student-stated" as const }
      : null;
  return {
    status: "resolved",
    context: {
      goal,
      exam: { id: c.id, name: c.name, body: c.body, country: c.country },
      resolvedBy,
      facts,
      examDate,
      corpora: c.corpora,
      research: { source: source.name, kind: source.kind, ranAt: opts.ranAt, candidates: found.length, limits: extra.limits, pages: extra.pages },
    },
  };
}

/**
 * For an exam the research source could not find. Nothing about the exam is
 * claimed: no facts, no notes, only what the student said. A later research
 * step (a correction of the exam, or a web source) can replace it.
 */
export function unresearchedContext(goal: StudentGoal, ranAt: string): ExamContext {
  return {
    goal,
    exam: { id: "unresearched", name: goal.exam, body: "not researched", country: goal.country },
    resolvedBy: "student-stated, not researched",
    facts: [],
    examDate: goal.statedExamDate ? { value: goal.statedExamDate, origin: "student-stated" } : null,
    corpora: [],
    research: { source: "none", kind: "none", ranAt, candidates: 0 },
  };
}

export function daysUntil(date: string, today: string): number {
  return Math.max(1, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) / 86_400_000));
}

/** One line for the graph trace and the why card. */
export function describeContext(ctx: ExamContext): string {
  if (ctx.research.kind === "none") return `exam context: ${ctx.exam.name} NOT researched (student-stated only); exam date ${ctx.examDate ? `${ctx.examDate.value} (${ctx.examDate.origin})` : "unknown"}`;
  const verified = ctx.facts.filter((f) => f.status === "verified-official").length;
  const date = ctx.examDate ? `${ctx.examDate.value} (${ctx.examDate.origin})` : "unknown";
  return (
    `exam context: ${ctx.exam.name} (${ctx.resolvedBy}, ${ctx.research.candidates} candidates); ` +
    `${verified}/${ctx.facts.length} facts verified; exam date ${date}; research by ${ctx.research.source} (${ctx.research.kind === "fixture" ? "mock, not web" : "web"}) at ${ctx.research.ranAt}`
  );
}
