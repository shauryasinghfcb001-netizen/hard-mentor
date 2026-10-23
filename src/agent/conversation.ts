// One conversation per student, around the graph. The session keeps what must
// survive between messages: the exam intake answers, the resolved exam
// context, the open quiz and the last plan (to explain what changed). It is a
// small JSON file per student, so one student's open quiz or intake never
// reaches another. Every message is checked for distress before anything
// else, including during intake.

import fs from "node:fs";
import path from "node:path";
import { daysUntil, researchExam, type ExamContext, type ResearchSource, type StudentGoal } from "../context/examContext.ts";
import { detectDistress } from "../core/distress.ts";
import { csvStudyData } from "../data/studyData.ts";
import { studentDir, type StudentMemory } from "../memory/studentMemory.ts";
import type { ActiveQuiz } from "../quiz/quizTurn.ts";
import type { Corpus, Retriever } from "../rag/ncert.ts";
import { runMentor, type MentorState, type StudentContext } from "./graph.ts";
import type { Planner } from "./planner.ts";
import { buildWhyCard, type WhyCard } from "./whyCard.ts";

export interface StudentProfile {
  studentId: string;
  name: string;
  hoursPerDay: number;
}

type IntakeStep = "exam" | "country" | "goal" | "date" | "choice";

export interface Session {
  studentId: string;
  stage: "intake" | "ready";
  intake: { step: IntakeStep; goal: Partial<StudentGoal> };
  exam: ExamContext | null;
  activeQuiz: ActiveQuiz | null;
  lastPlan: { at: string; top: string; topics: Record<string, { name: string; mastery: number; priority: number }> } | null;
}

export interface ConversationEnv {
  planner: Planner;
  retriever: Retriever | null;
  research: ResearchSource;
  corpora: Corpus[];
  records: string;
  quizLog: string;
  sessionsDir: string;
  memoryFor(studentId: string): Promise<StudentMemory | null>;
  /** ISO time; injected so runs are reproducible */
  now(): string;
}

export interface TurnResult {
  reply: string;
  handledBy: "intake" | "graph";
  state: MentorState | null;
  why: WhyCard | null;
  session: Session;
}

/** Used for urgency only when the student gives no exam date; the reply says so. */
export const ASSUMED_DAYS_TO_EXAM = 120;

function sessionFile(env: ConversationEnv, studentId: string): string {
  return `${studentDir(env.sessionsDir, studentId)}.json`;
}

export function loadSession(env: ConversationEnv, studentId: string): Session | null {
  const f = sessionFile(env, studentId);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf-8")) as Session) : null;
}

function saveSession(env: ConversationEnv, s: Session): void {
  const f = sessionFile(env, s.studentId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${f}.tmp`, f);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2027-02-15", "15 Feb 2027" or "February 15, 2027" -> "2027-02-15"; null if not a real date. */
export function parseDate(text: string): string | null {
  const t = text.toLowerCase();
  let y: number, m: number, d: number;
  const iso = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const dmy = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b/);
  const mdy = t.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy && MONTHS.includes(dmy[2])) [y, m, d] = [Number(dmy[3]), MONTHS.indexOf(dmy[2]) + 1, Number(dmy[1])];
  else if (mdy && MONTHS.includes(mdy[1])) [y, m, d] = [Number(mdy[3]), MONTHS.indexOf(mdy[1]) + 1, Number(mdy[2])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const UNSURE = /\b(not\s+sure|don'?t\s+know|no\s+idea|unknown|skip|later)\b/i;

function strip(text: string, lead: RegExp): string {
  return text.trim().replace(lead, "").replace(/[.!]+$/, "").trim();
}

function describeResolved(ctx: ExamContext, today: string): string {
  const mock = ctx.research.kind === "fixture";
  const lines = [
    `got it: ${ctx.exam.name} (${ctx.exam.body}), ${ctx.resolvedBy === "student choice" ? "as you chose" : ctx.resolvedBy}.`,
    mock
      ? "What I know about it comes from a small offline list I was given, not from the web, so none of it is verified:"
      : "What I found:",
    ...ctx.facts.map((f) => `- ${f.key}: ${f.value} (${f.status.toUpperCase()}: ${f.why}; source ${f.source.url}, retrieved ${f.source.retrievedAt ?? "never"})`),
    ctx.examDate
      ? `Exam date ${ctx.examDate.value} is ${ctx.examDate.origin === "student-stated" ? "your date, not an official one" : "the official date"} (${daysUntil(ctx.examDate.value, today)} days from ${today}).`
      : `No exam date yet: I'll assume ${ASSUMED_DAYS_TO_EXAM} days for urgency until you tell me.`,
    `Local notes I can quiz you from: ${ctx.corpora.length ? ctx.corpora.join(", ") : "none"}.`,
    `Say "plan my study for today" or "quiz me".`,
  ];
  return lines.join("\n");
}

async function intakeTurn(env: ConversationEnv, profile: StudentProfile, s: Session, message: string): Promise<string> {
  const first = profile.name.replace(/\s*\(fictional\)$/, "");
  const g = s.intake.goal;
  switch (s.intake.step) {
    case "exam":
      g.exam = strip(message, /^(i'?m|i\s+am)\s+(preparing|studying|appearing)\s+for\s+|^(my\s+exam\s+is|exam:?)\s*/i);
      s.intake.step = "country";
      return `Thanks. Which country is ${g.exam} in?`;
    case "country":
      g.country = strip(message, /^(in\s+|country:?\s*)/i);
      s.intake.step = "goal";
      return "What is your goal for it? For example a score or a rank.";
    case "goal":
      g.goal = strip(message, /^(my\s+goal\s+is|goal:?|i\s+want)\s*/i);
      s.intake.step = "date";
      return `When is the exam? Give a date like 2027-02-15, or say "not sure".`;
    case "date": {
      if (!UNSURE.test(message)) {
        const d = parseDate(message);
        if (!d) return `I couldn't read a date in that. Please give it like 2027-02-15, or say "not sure".`;
        if (d <= env.now().slice(0, 10)) return `${d} is not in the future. Please check the date, or say "not sure".`;
        g.statedExamDate = d;
      }
      return research(env, s, first);
    }
    case "choice":
      return research(env, s, first, message);
  }
}

async function research(env: ConversationEnv, s: Session, first: string, choice?: string): Promise<string> {
  const goal = s.intake.goal as StudentGoal;
  const step = await researchExam(env.research, goal, { ranAt: env.now(), choice });
  if (step.status === "ambiguous") {
    s.intake.step = "choice";
    return [step.question, ...step.options.map((o) => `- ${o.name} (${o.body})`), "Reply with the name of yours."].join("\n");
  }
  if (step.status === "not_found") {
    if (s.intake.step !== "choice") s.intake.step = "exam";
    return `${step.reply} ${s.intake.step === "exam" ? "You can name a different exam." : "Please pick one of the options above."}`;
  }
  s.exam = step.context;
  s.stage = "ready";
  return `${first}, ${describeResolved(step.context, env.now().slice(0, 10))}`;
}

function planChange(s: Session, state: MentorState): string | null {
  const prev = s.lastPlan;
  const top = state.draft?.blocks[0]?.topicId;
  if (!prev || !top) return null;
  const now = new Map(state.ranked.map((t) => [t.topicId, t]));
  const moved = state.ranked.filter((t) => prev.topics[t.topicId] && prev.topics[t.topicId].mastery !== t.mastery);
  const lines = [`What changed since your last plan (${prev.at.slice(0, 16).replace("T", " ")} UTC):`];
  for (const t of moved) {
    const p = prev.topics[t.topicId];
    const q = t.lastQuiz ? ` after quiz ${t.lastQuiz.quizId} (${t.lastQuiz.correct}/${t.lastQuiz.total}, ${t.lastQuiz.ref})` : "";
    lines.push(`- ${t.name} mastery ${p.mastery} -> ${t.mastery}${q}; priority ${p.priority.toFixed(3)} -> ${t.priority.toFixed(3)}`);
  }
  if (!moved.length) lines.push("- No study record changed.");
  const name = (id: string) => now.get(id)?.name ?? prev.topics[id]?.name ?? id;
  lines.push(
    top === prev.top
      ? `- Top topic unchanged: ${name(top)} still has the highest priority (${now.get(top)!.priority.toFixed(3)}).`
      : `- Top topic changed from ${name(prev.top)} to ${name(top)}: ${name(top)} now has the highest priority (${now.get(top)!.priority.toFixed(3)} vs ${now.get(prev.top)?.priority.toFixed(3)}).`
  );
  return lines.join("\n");
}

export async function converse(env: ConversationEnv, profile: StudentProfile, message: string): Promise<TurnResult> {
  let s = loadSession(env, profile.studentId);
  const isNew = !s;
  s ??= { studentId: profile.studentId, stage: "intake", intake: { step: "exam", goal: {} }, exam: null, activeQuiz: null, lastPlan: null };
  const memory = await env.memoryFor(profile.studentId);
  const deps = {
    planner: env.planner,
    memory,
    retriever: env.retriever,
    quiz: { corpora: env.corpora, records: env.records, quizLog: env.quizLog, now: () => env.now() },
  };
  const student = async (): Promise<StudentContext> => ({
    studentId: profile.studentId,
    name: profile.name,
    hoursPerDay: profile.hoursPerDay,
    daysToExam: s!.exam?.examDate ? daysUntil(s!.exam.examDate.value, env.now()) : ASSUMED_DAYS_TO_EXAM,
    topics: (await csvStudyData(env.records, env.quizLog).topicsFor(profile.studentId)).rows,
    exam: s!.exam ?? undefined,
  });

  // Distress first, in every stage. The graph sends the override reply; intake does not advance.
  if (s.stage === "intake" && detectDistress(message).distress) {
    const state = await runMentor(deps, { ...(await student()), topics: [] }, message);
    saveSession(env, s);
    return { reply: state.reply, handledBy: "graph", state, why: buildWhyCard(state), session: s };
  }
  if (s.stage === "intake") {
    const first = profile.name.replace(/\s*\(fictional\)$/, "");
    const reply = isNew
      ? `Hi ${first}. Before I plan anything I need to know your exam. Which exam are you preparing for?`
      : await intakeTurn(env, profile, s, message);
    saveSession(env, s);
    return { reply, handledBy: "intake", state: null, why: null, session: s };
  }

  const state = await runMentor(deps, await student(), message, { activeQuiz: s.activeQuiz });
  s.activeQuiz = state.activeQuiz ?? null;
  let reply = state.reply;
  if (state.draft && (state.outcome === "sent" || state.outcome === "fallback")) {
    const change = planChange(s, state);
    if (change) reply = `${reply}\n${change}`;
    s.lastPlan = {
      at: env.now(),
      top: state.draft.blocks[0]?.topicId ?? "",
      topics: Object.fromEntries(state.ranked.map((t) => [t.topicId, { name: t.name, mastery: t.mastery, priority: t.priority }])),
    };
  }
  saveSession(env, s);
  return { reply, handledBy: "graph", state, why: buildWhyCard(state), session: s };
}
