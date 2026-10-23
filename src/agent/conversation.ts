// One conversation per student, around the graph. The session keeps what must
// survive between messages: the exam intake answers, the resolved exam
// context, the open quiz and the last plan (to explain what changed). It is a
// small JSON file per student, so one student's open quiz or intake never
// reaches another. Every message is checked for distress before anything
// else, including during intake.

import fs from "node:fs";
import path from "node:path";
import { daysUntil, researchExam, unresearchedContext, type ExamContext, type ResearchSource, type StudentGoal } from "../context/examContext.ts";
import { detectDistress } from "../core/distress.ts";
import { rankTopics } from "../core/priority.ts";
import { csvStudyData } from "../data/studyData.ts";
import { studentDir, type StudentMemory } from "../memory/studentMemory.ts";
import type { ActiveQuiz } from "../quiz/quizTurn.ts";
import type { Corpus, Retriever } from "../rag/ncert.ts";
import { classifyIntent, runMentor, type MentorState, type StudentContext } from "./graph.ts";
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
  /** the student turned memory off: nothing is recalled or written, stored memories are kept */
  memoryOff?: boolean;
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

const NO_RESEARCH = /\b(continue|proceed|go\s+ahead|carry\s+on)\s+without\s+(the\s+)?(research|lookup|looking\s+it\s+up)\b/i;
const UNSURE = /\b(not\s+sure|don'?t\s+know|no\s+idea|unknown|skip|later)\b/i;

function strip(text: string, lead: RegExp): string {
  return text.trim().replace(lead, "").replace(/[.!]+$/, "").trim();
}

function describeResolved(ctx: ExamContext, today: string): string {
  if (ctx.research.kind === "none") {
    return [
      `I have not researched ${ctx.exam.name} (${ctx.exam.country}): I can't look it up yet, and I won't guess facts about it. I have no syllabus, weightage or official dates for it.`,
      ctx.examDate ? `I'll use your exam date ${ctx.examDate.value}, which is yours, not an official one (${daysUntil(ctx.examDate.value, today)} days from ${today}).` : `No exam date yet: I'll assume ${ASSUMED_DAYS_TO_EXAM} days for urgency until you tell me.`,
      `Your plan is ranked from your saved study records and the marks weights stored in them, not from anything I researched about ${ctx.exam.name}. I have no notes to quiz you from for it.`,
      `Say "plan my study for today". You can say "change my exam to <name>" later to try the lookup again.`,
    ].join("\n");
  }
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
      if (g.exam && g.country && g.goal && NO_RESEARCH.test(message)) {
        s.exam = unresearchedContext(g as StudentGoal, env.now());
        s.stage = "ready";
        return `${first}, ${describeResolved(s.exam, env.now().slice(0, 10))}`;
      }
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
    return `${step.reply} ${s.intake.step === "exam" ? 'You can name a different exam, or say "continue without research" and I will plan from your date and goal only, without any exam facts.' : "Please pick one of the options above."}`;
  }
  s.exam = step.context;
  s.stage = "ready";
  return `${first}, ${describeResolved(step.context, env.now().slice(0, 10))}`;
}

type Correction = { field: "date" | "exam" | "country" | "goal"; value: string };

const CORRECTION_CUE = /\b(actually|correction|wrong|change[ds]?|update[ds]?|correct|moved|postponed|preponed|rescheduled?|fix)\b/i;

/**
 * A student correcting an intake answer after onboarding. Needs a correction cue
 * AND a named field, so quiz answers and ordinary questions are not caught.
 * `value` is raw text for date (parsed later, so a bad date can be refused) and
 * the new wording for the other fields.
 */
export function detectCorrection(message: string): Correction | null {
  if (!CORRECTION_CUE.test(message)) return null;
  const to = (re: RegExp) => message.match(re)?.[1]?.trim().replace(/[.!]+$/, "") ?? null;
  const exam = to(/\b(?:change|switch|update|correct)\s+(?:my\s+|the\s+)?exam\s+(?:to|as)\s+(.+)$/i) ?? to(/\bexam\s+is\s+(?:actually|now)\s+(?!on\b)(.+)$/i);
  if (exam) return { field: "exam", value: exam };
  const country = to(/\bcountry\s+(?:is\s+|to\s+|as\s+)(?:actually\s+)?(.+)$/i);
  if (country) return { field: "country", value: country };
  const goal = to(/\bgoal\s+(?:is\s+|to\s+|as\s+)(?:actually\s+)?(.+)$/i);
  if (goal) return { field: "goal", value: goal };
  if (/\b(date|exam|test|paper|moved|postponed|preponed|rescheduled?)\b/i.test(message) && (/\bdate\b/i.test(message) || parseDate(message) || /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(message)))
    return { field: "date", value: message };
  return null;
}

const MEMORY_OFF = /\b(turn|switch|set)\b.{0,20}\bmemory\b.{0,12}\boff\b|\bmemory\s+off\b|\b(stop|don'?t|do\s+not)\s+(remembering|remember|saving|storing)\s+(me|anything|things|my)\b/i;
const MEMORY_ON = /\b(turn|switch|set)\b.{0,20}\bmemory\b.{0,12}\bon\b|\bmemory\s+on\b|\byou\s+can\s+(start\s+)?remember(ing)?\s+me\b/i;
const MEMORY_STATUS = /\bis\s+(my\s+|your\s+)?memory\s+(on|off)\b/i;

/** "turn memory off / on" and "is memory on?"; null for anything else. */
export function detectMemoryControl(message: string): "off" | "on" | "status" | null {
  if (MEMORY_STATUS.test(message)) return "status";
  if (MEMORY_OFF.test(message)) return "off";
  if (MEMORY_ON.test(message)) return "on";
  return null;
}

function daysFor(s: Session, now: string): number {
  return s.exam?.examDate ? daysUntil(s.exam.examDate.value, now) : ASSUMED_DAYS_TO_EXAM;
}

/**
 * Applies a correction to the session only (never the study records, quiz log or
 * memory). Returns what to tell the student, and whether the plan inputs changed.
 */
async function applyCorrection(env: ConversationEnv, s: Session, c: Correction): Promise<{ note: string; changed: boolean }> {
  const exam = s.exam!;
  const today = env.now().slice(0, 10);
  if (c.field === "goal") {
    exam.goal.goal = c.value;
    return { note: `Updated your goal to "${c.value}". Your plan ranking does not use the goal, so it does not change.`, changed: false };
  }
  if (c.field === "date") {
    const d = parseDate(c.value);
    if (!d) return { note: `I couldn't read an exact date in that, so I changed nothing. Please give it like 2027-03-01.`, changed: false };
    if (d <= today) return { note: `${d} is not in the future, so I kept your exam date as ${exam.examDate?.value ?? "not set"}. Please check the date.`, changed: false };
    if (exam.examDate?.origin === "verified-official") return { note: `The exam date ${exam.examDate.value} comes from an official source, so I did not replace it with yours (${d}).`, changed: false };
    if (exam.examDate?.value === d) return { note: `Your exam date is already ${d}; nothing changed.`, changed: false };
    exam.examDate = { value: d, origin: "student-stated" };
    exam.goal.statedExamDate = d;
    return { note: `Updated your exam date to ${d} (your date, not an official one).`, changed: true };
  }
  if (s.activeQuiz) return { note: `You have a quiz open and it uses notes for ${exam.exam.name}. Finish it or say "cancel the quiz" first, then change your ${c.field}. Nothing changed.`, changed: false };
  const goal = { ...exam.goal, [c.field]: c.value };
  const step = await researchExam(env.research, goal, { ranAt: env.now() });
  if (step.status === "ambiguous") return { note: `${step.question} ${step.options.map((o) => o.name).join("; ")}. Nothing changed; say "change my exam to <name>".`, changed: false };
  if (step.status === "not_found") return { note: `${step.reply} Nothing changed: you are still on ${exam.exam.name}.`, changed: false };
  const next = step.context;
  const kept = exam.corpora.filter((x) => !next.corpora.includes(x));
  s.exam = next;
  return {
    note: [
      `Updated your ${c.field}: you are now on ${next.exam.name} (${next.exam.body}). What I know about it comes from the same small offline list, so it is unverified.`,
      kept.length
        ? `The notes I used for ${exam.exam.name} (${kept.join(", ")}) do not apply to ${next.exam.name}. Your saved results and quiz history are kept as they were and are NOT relabeled for the new exam. I have no syllabus for it, so I can't tell which saved topics still apply.`
        : `Your saved results and quiz history are kept as they were.`,
      `Local notes I can quiz you from for ${next.exam.name}: ${next.corpora.length ? next.corpora.join(", ") : "none"}.`,
    ].join("\n"),
    changed: true,
  };
}

function dateChange(s: Session, before: { days: number; top: string; topics: NonNullable<Session["lastPlan"]>["topics"] } | null, state: MentorState, after: number): string {
  const u = (d: number) => 1 + 30 / Math.max(d, 1);
  const lines = [`Why the plan numbers moved: days to exam ${before ? before.days : "?"} -> ${after}; urgency 1 + 30/days = ${before ? u(before.days).toFixed(3) : "?"} -> ${u(after).toFixed(3)}. Mastery and quiz results are unchanged.`];
  for (const t of state.ranked) {
    const p = before?.topics[t.topicId];
    lines.push(`- ${t.name}: priority ${p ? p.priority.toFixed(3) : "n/a"} -> ${t.priority.toFixed(3)}`);
  }
  const top = state.draft?.blocks[0]?.topicId;
  if (before && top) lines.push(top === before.top ? `Top topic unchanged (${state.ranked.find((t) => t.topicId === top)?.name}): urgency scales every topic equally, so a new date changes the priority numbers, not their order.` : `Top topic changed.`);
  return lines.join("\n");
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
  const stored = await env.memoryFor(profile.studentId);
  // Memory off: nothing is recalled or written. Stored memories stay and can still be listed or forgotten.
  const memory = s.memoryOff ? null : stored;
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
  const control = !isNew && !detectDistress(message).distress ? detectMemoryControl(message) : null;
  if (control) {
    if (control !== "status") s.memoryOff = control === "off";
    saveSession(env, s);
    const reply = control === "status"
      ? s.memoryOff ? "Memory is off for you. I am not recalling or saving anything new. Memories stored earlier are kept; say \"what do you remember\" to see them or \"forget <words>\" to delete them." : "Memory is on. I save a short summary of each plan and quiz result, never your typed answers."
      : control === "off"
        ? "Memory is off. I will not recall or save anything new about you. Memories stored earlier are kept, not deleted; say \"what do you remember\" to see them or \"forget <words>\" to delete them. Say \"turn memory on\" to resume."
        : "Memory is on again. I will recall and save short summaries of plans and quiz results, never your typed answers.";
    return { reply, handledBy: "intake", state: null, why: null, session: s };
  }
  if (s.stage === "intake") {
    const first = profile.name.replace(/\s*\(fictional\)$/, "");
    const reply = isNew
      ? `Hi ${first}. Before I plan anything I need to know your exam. Which exam are you preparing for?`
      : await intakeTurn(env, profile, s, message);
    saveSession(env, s);
    return { reply, handledBy: "intake", state: null, why: null, session: s };
  }

  const correction = detectCorrection(message);
  if (correction && !detectDistress(message).distress) {
    // Plan numbers before the change, from the session's last plan or a fresh ranking of the unchanged records.
    const beforeDays = daysFor(s, env.now());
    const beforeTopics = s.lastPlan?.topics ?? Object.fromEntries(rankTopics((await student()).topics, beforeDays).map((t) => [t.topicId, { name: t.name, mastery: t.mastery, priority: t.priority }]));
    const before = { days: beforeDays, top: s.lastPlan?.top ?? "", topics: beforeTopics };
    const applied = await applyCorrection(env, s, correction);
    if (!applied.changed) {
      saveSession(env, s);
      return { reply: applied.note, handledBy: "intake", state: null, why: null, session: s };
    }
    const planned = await runMentor(deps, await student(), "Plan my study for today.", { activeQuiz: s.activeQuiz });
    const after = daysFor(s, env.now());
    const explain = correction.field === "date" ? dateChange(s, before, planned, after) : null;
    if (planned.draft) s.lastPlan = { at: env.now(), top: planned.draft.blocks[0]?.topicId ?? "", topics: Object.fromEntries(planned.ranked.map((t) => [t.topicId, { name: t.name, mastery: t.mastery, priority: t.priority }])) };
    saveSession(env, s);
    return { reply: [applied.note, explain, planned.reply].filter(Boolean).join("\n"), handledBy: "graph", state: planned, why: buildWhyCard(planned), session: s };
  }

  const asksMemory = s.memoryOff && ["memory_list", "memory_forget"].includes(classifyIntent(message, null, !!s.activeQuiz).intent);
  const state = await runMentor(asksMemory ? { ...deps, memory: stored } : deps, await student(), message, { activeQuiz: s.activeQuiz });
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
