// The Hard Mentor reasoning loop as a LangGraph state graph (blueprint
// section 5): sense -> distress override | memory ops | NCERT doubt | quiz |
// (recall -> draft -> check -> revise up to 2 times -> fallback) -> respond
// -> write back to H-MEM. Every node appends to `trace`; the why card is
// built only from that trace.

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { describeContext, type ExamContext } from "../context/examContext.ts";
import { checkPlan, type CheckResult } from "../core/checker.ts";
import { detectDistress, distressReply } from "../core/distress.ts";
import { rankTopics, type RankedTopic, type TopicState } from "../core/priority.ts";
import type { ChatModel } from "../llm/client.ts";
import { forgetMatching, listMemories, recall, rememberEpisode, type MemoryItem, type StudentMemory } from "../memory/studentMemory.ts";
import { answerQuiz, cancelQuiz, startQuiz, type ActiveQuiz, type QuizDeps, type QuizTurn } from "../quiz/quizTurn.ts";
import { answerDoubt, type DoubtAnswer } from "../rag/doubt.ts";
import { groundQuestion, type Retriever } from "../rag/ncert.ts";
import type { Draft, Intent, Planner, RecalledMemory } from "./planner.ts";

export const MAX_DRAFTS = 3; // first draft + at most 2 revisions

export interface TraceRow {
  node: string;
  detail: string;
  refs?: string[];
}

export interface StudentContext {
  studentId: string;
  name: string;
  hoursPerDay: number;
  daysToExam: number;
  topics: TopicState[];
  /** exam, country and goal resolved by researchExam; absent for older callers */
  exam?: ExamContext;
  /** where `topics` came from and the SQL that source ran; absent = nothing is claimed, the why card shows no source */
  provenance?: { source: string; sql: string | null };
}

export interface GraphDeps {
  planner: Planner;
  /** null = memory off (control condition) */
  memory: StudentMemory | null;
  /** NCERT retriever for doubts; null/absent = doubts not available */
  retriever?: Retriever | null;
  /** model for doubt answers; null/absent = extractive answers only */
  doubtModel?: ChatModel | null;
  /** note corpora and record files for quizzes; null/absent = quizzes not available */
  quiz?: QuizDeps | null;
}

export type Outcome = "sent" | "fallback" | "distress_override" | "memory_op" | "doubt_answered" | "doubt_refused" | "quiz";

const State = Annotation.Root({
  student: Annotation<StudentContext>(),
  message: Annotation<string>(),
  intent: Annotation<Intent>(),
  memories: Annotation<RecalledMemory[]>(),
  ranked: Annotation<RankedTopic[]>(),
  draft: Annotation<Draft | null>(),
  check: Annotation<CheckResult | null>(),
  attempts: Annotation<number>(),
  doubt: Annotation<DoubtAnswer | null>(),
  memoryOp: Annotation<{ kind: "list" | "forget"; items: MemoryItem[] } | null>(),
  /** the student's open quiz: passed in by the caller's session, returned updated */
  activeQuiz: Annotation<ActiveQuiz | null>(),
  quizTurn: Annotation<QuizTurn | null>(),
  reply: Annotation<string>(),
  outcome: Annotation<Outcome>(),
  trace: Annotation<TraceRow[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export type MentorState = typeof State.State;

const SWAP = /\b(instead\s+of|swap|switch|skip)\b/i;
const MEMORY_LIST = /\bwhat\s+(do|did)\s+you\s+(remember|know)\b/i;
const MEMORY_FORGET = /^\s*(please\s+)?forget\s+(about\s+)?(.+?)[.!]?\s*$/i;
const QUIZ_START = /\b(quiz|test)\s+me\b|\b(start|begin|give\s+me|take|new|another)\s+(a\s+|an\s+|another\s+|the\s+|my\s+)?(quick\s+|short\s+|new\s+)?(quiz|test)\b|^\s*quiz\s*[.!?]?\s*$/i;
const QUIZ_CANCEL = /\b(cancel|stop|quit|exit|abandon|drop)\b.{0,20}\b(quiz|test)\b|^\s*(cancel|stop|quit)\s*[.!]?\s*$/i;
// A message made only of quiz answers ("B, A, D", "A C B" or "Q3: directions, Q4: A") with no quiz open.
function looksLikeAnswers(message: string): boolean {
  const parts = message.split(/[,;\n]+/).map((p) => p.trim().replace(/[.!]+$/, "")).filter(Boolean);
  if (parts.length === 1 && /^([a-d]\s+)+[a-d]$/i.test(parts[0])) return true;
  return parts.length > 0 && parts.every((p) => /^[a-d]$/i.test(p) || /^q?\d+\s*[:.)=-]?\s*[a-z]+$/i.test(p));
}

// Textbook-question cues (D21). A message is a doubt when it asks a question or
// asks for a definition and is not about the student's own schedule.
const Q_LEAD = /^\s*(what|what's|whats|why|how|which|when|where|who|whose|whom|explain|define|state|derive|describe|differentiate|distinguish|compare|prove|is|are|was|were|does|do|did|can|could|will|would|should)\b/i;
const Q_LEAD_REQUEST = /^\s*(give|write|tell\s+me|list|name)\b.{0,24}\b(formula|expression|definition|statement|law|unit|value|difference|example|note|meaning|derivation|principle)\b/i;
const Q_HINGLISH = /\b(kya\s+(hai|hota|hoti|hote)|kaise|kyun|kyon|kaun(si|sa)?|kahan|batao|bataiye|samjhao|samjhaiye|matlab|fark)\b/i;
const Q_DEFINITIONAL = /\b(definition|meaning|formula|expression|statement|law|principle|theorem|derivation|derive|short\s+note|difference\s+between|example\s+of|unit\s+of|si\s+unit)\b/i;
// Words about the student's own plan. "study" alone is NOT one: "what does electrostatics study?" is a doubt.
const PLAN_CUE =
  /\b(plan|schedule|timetable|today|tonight|tomorrow|this\s+(week|weekend|evening|morning)|weekend|morning|evening|dinner|(take|need|want)\s+a\s+break|break\s+(after|before|for)|study\s+(time|session|hours?|plan)|revise\s+first|hours?\s+(should|do|can)\s+i|how\s+many\s+hours|should\s+i\s+(study|revise|start|begin|do|focus)|most\s+urgent|urgent\s+for\s+me|time\s+for|my\s+(day|week|session|schedule|plan|revision|routine))\b/i;
const AUX_LEAD = /^\s*(is|are|was|were|does|do|did|can|could|will|would|should)\b/i;
const FIRST_PERSON = /\b(i|i'm|i've|i'd|my|me|mine|we|our)\b/i;

export function classifyIntent(message: string, retriever?: Retriever | null, quizOpen = false): { intent: Intent; detail: string } {
  // Distress is checked first, before any other routing: it bypasses study
  // pressure, quizzes, planning, retrieval and memory write-back. Only rule ids
  // are recorded, never the message wording.
  const d = detectDistress(message);
  if (d.distress) return { intent: "distress", detail: `distress rules matched (ids only): ${d.matched.join(", ")}` };
  // With a quiz open, every other message is read as answers, except cancel and memory requests.
  if (quizOpen) {
    if (QUIZ_CANCEL.test(message)) return { intent: "quiz_cancel", detail: "intent quiz_cancel (rules; quiz open)" };
    if (MEMORY_FORGET.test(message)) return { intent: "memory_forget", detail: "intent memory_forget (rules; quiz stays open)" };
    if (MEMORY_LIST.test(message)) return { intent: "memory_list", detail: "intent memory_list (rules; quiz stays open)" };
    return { intent: "quiz_answer", detail: "intent quiz_answer (rules; quiz open)" };
  }
  if (MEMORY_FORGET.test(message)) return { intent: "memory_forget", detail: "intent memory_forget (rules)" };
  if (MEMORY_LIST.test(message)) return { intent: "memory_list", detail: "intent memory_list (rules)" };
  if (QUIZ_CANCEL.test(message)) return { intent: "quiz_cancel", detail: "intent quiz_cancel (rules)" };
  if (QUIZ_START.test(message)) return { intent: "quiz_start", detail: "intent quiz_start (rules)" };
  if (looksLikeAnswers(message)) return { intent: "quiz_answer", detail: "intent quiz_answer (rules: answer letters, no quiz open)" };
  if (SWAP.test(message)) return { intent: "swap_request", detail: "intent swap_request (rules)" };
  if (PLAN_CUE.test(message)) return { intent: "plan", detail: "intent plan (rules: schedule wording)" };
  const hinglish = Q_HINGLISH.test(message);
  const definitional = Q_DEFINITIONAL.test(message);
  const lead = Q_LEAD.test(message) || Q_LEAD_REQUEST.test(message);
  if (!(lead || hinglish || definitional)) {
    // A bare topic phrase ("dipole torque in uniform field") has no cue word. It is a doubt only
    // when it is not about the student, has no numbers, and the Ch 1 notes support at least two key terms.
    if (retriever && !FIRST_PERSON.test(message) && !/\d/.test(message) && message.trim().split(/\s+/).length <= 12) {
      const g = groundQuestion(retriever, message);
      if (g.inSyllabus && retriever.analyze(message).length >= 2) return { intent: "doubt", detail: "intent doubt (rules: topic phrase supported by the Ch 1 notes)" };
    }
    return { intent: "plan", detail: "intent plan (rules: no question or definition cue)" };
  }
  // "Can I ..." / "Do I ..." is ambiguous between a doubt and a planning question: the notes decide.
  if (AUX_LEAD.test(message) && FIRST_PERSON.test(message) && !hinglish && !definitional) {
    if (retriever && groundQuestion(retriever, message).inSyllabus) return { intent: "doubt", detail: "intent doubt (rules: question about me, but the Ch 1 notes support it)" };
    return { intent: "plan", detail: "intent plan (rules: question about me, no support in the notes)" };
  }
  return { intent: "doubt", detail: `intent doubt (rules: ${hinglish ? "Hinglish question" : definitional && !lead ? "definition request" : "question wording"})` };
}

const firstName = (s: StudentContext) => s.name.replace(/\s*\(fictional\)$/, "");

export function buildMentorGraph(deps: GraphDeps) {
  const { planner, memory } = deps;

  return new StateGraph(State)
    .addNode("sense", (s) => {
      const { intent, detail } = classifyIntent(s.message, deps.retriever, !!s.activeQuiz);
      // A distress message is not kept in the state that is returned to the caller.
      const kept = intent === "distress" ? { message: "[distress message not retained]" } : {};
      return { ...kept, intent, attempts: 0, draft: null, check: null, doubt: null, memoryOp: null, quizTurn: null, trace: [{ node: "sense", detail }] };
    })
    .addNode("distress_override", (s) => ({
      reply: distressReply(firstName(s.student)),
      outcome: "distress_override" as const,
      // An open quiz is closed without a score: study pressure stops here.
      activeQuiz: null,
      // Nothing about the distress message is written to memory.
      trace: [
        { node: "distress_override", detail: "supportive reply sent (Tele-MANAS 14416); no planning, quiz, retrieval or memory write; message text not retained", refs: ["rule:distress-override"] },
        ...(s.activeQuiz ? [{ node: "distress_override", detail: `open quiz ${s.activeQuiz.quiz.id} closed without a score; nothing written` }] : []),
      ],
    }))
    .addNode("quiz", (s) => {
      if (!deps.quiz) {
        return { reply: "Quizzes are not available in this session.", outcome: "quiz" as const, activeQuiz: s.activeQuiz ?? null, trace: [{ node: "quiz", detail: "no quiz deps configured" }] };
      }
      const st = s.student;
      const t =
        s.intent === "quiz_start"
          ? startQuiz(deps.quiz, { studentId: st.studentId, topics: st.topics, daysToExam: st.daysToExam, corpora: st.exam?.corpora }, s.message)
          : s.intent === "quiz_cancel"
            ? cancelQuiz(s.activeQuiz ?? null)
            : answerQuiz(deps.quiz, st.studentId, s.activeQuiz ?? null, s.message, memory);
      return { quizTurn: t, activeQuiz: t.active, reply: t.reply, outcome: "quiz" as const, trace: t.trace };
    })
    .addNode("memory_ops", (s) => {
      if (!memory) {
        return { reply: "Memory is off for this session, so I have nothing stored about you.", outcome: "memory_op" as const, trace: [{ node: "memory_ops", detail: "memory OFF: nothing to list or forget" }] };
      }
      if (s.intent === "memory_list") {
        const items = listMemories(memory);
        const reply = items.length
          ? `Here is everything I remember about you (${items.length}):\n${items.map((m) => `- ${m.content} [${m.id}]`).join("\n")}\nSay "forget <words>" to delete any of it.`
          : "I don't remember anything about you yet.";
        return { memoryOp: { kind: "list" as const, items }, reply, outcome: "memory_op" as const, trace: [{ node: "memory_ops", detail: `listed ${items.length} H-MEM records`, refs: items.map((m) => m.id) }] };
      }
      const target = s.message.match(MEMORY_FORGET)![3];
      const items = forgetMatching(memory, target);
      const reply = items.length
        ? `Done. I deleted ${items.length} memor${items.length === 1 ? "y" : "ies"}:\n${items.map((m) => `- ${m.content} [${m.id}]`).join("\n")}\nI won't use ${items.length === 1 ? "it" : "them"} again. My log keeps only the id, the time and "forgotten", not the text.`
        : `I found nothing matching "${target}", so nothing was deleted.`;
      return { memoryOp: { kind: "forget" as const, items }, reply, outcome: "memory_op" as const, trace: [{ node: "memory_ops", detail: `forget "${target}": deleted ${items.length} H-MEM records`, refs: items.map((m) => m.id) }] };
    })
    .addNode("answer_doubt", async (s) => {
      if (!deps.retriever) {
        return { reply: "I can't answer textbook doubts in this session yet.", outcome: "doubt_refused" as const, trace: [{ node: "answer_doubt", detail: "no NCERT retriever configured" }] };
      }
      const a = await answerDoubt(deps.retriever, s.message, deps.doubtModel ?? null);
      const refs = a.citations.map((c) => `ncert:${c.chunkId}`);
      return {
        doubt: a,
        reply: a.text,
        outcome: a.mode === "refusal" ? ("doubt_refused" as const) : ("doubt_answered" as const),
        trace: [
          { node: "answer_doubt", detail: `retrieval: ${a.grounding.reason}`, refs: a.grounding.hits.map((h) => `ncert:${h.chunk.id}`) },
          { node: "answer_doubt", detail: `${a.mode} answer by ${a.producedBy}${a.check ? `; citation check ${a.check.ok ? "passed" : "failed"}` : ""}`, refs },
        ],
      };
    })
    .addNode("recall", (s) => {
      const ranked = rankTopics(s.student.topics, s.student.daysToExam);
      const rankRow: TraceRow = {
        node: "recall",
        detail: `ranked ${ranked.length} topics by (1-mastery)*marks_weight*urgency; top ${ranked[0]?.topicId}`,
        refs: ranked.map((t) => t.sourceRow),
      };
      const ctx = s.student.exam;
      const ctxRows: TraceRow[] = ctx ? [{ node: "recall", detail: describeContext(ctx), refs: ctx.facts.map((f) => `source:${f.source.url}`) }] : [];
      if (!memory) {
        return { ranked, memories: [], trace: [...ctxRows, rankRow, { node: "recall", detail: "memory OFF: H-MEM not queried" }] };
      }
      const res = recall(memory, s.message, { topN: 5 });
      const memories: RecalledMemory[] = res.memories.map((r: any) => ({
        id: r.memory.id,
        content: r.memory.content,
        tags: r.memory.tags,
        relevance: r.relevance,
      }));
      return {
        ranked,
        memories,
        trace: [
          ...ctxRows,
          rankRow,
          {
            node: "recall",
            detail: `H-MEM (${memory.engineSource}) returned ${memories.length}: ${res.trace?.retrievalReason ?? ""}`.trim(),
            refs: memories.map((m) => m.id),
          },
        ],
      };
    })
    .addNode("draft_plan", async (s) => {
      const attempt = s.attempts + 1;
      const draft = await planner.draft({
        name: firstName(s.student),
        hoursPerDay: s.student.hoursPerDay,
        message: s.message,
        intent: s.intent,
        ranked: s.ranked,
        memories: s.memories,
        attempt,
        feedback: s.check?.failures ?? [],
      });
      const by = draft.producedBy ?? `${planner.name} (${planner.kind})`;
      return {
        draft,
        attempts: attempt,
        trace: [{ node: "draft_plan", detail: `attempt ${attempt} by ${by}: decision ${draft.decision}` }],
      };
    })
    .addNode("check_plan", (s) => {
      const check = checkPlan(s.draft!, { hoursPerDay: s.student.hoursPerDay, ranked: s.ranked });
      const detail = check.ok ? `attempt ${s.attempts} passed all rules` : `attempt ${s.attempts} rejected: ${check.failures.map((f) => `${f.rule} (${f.detail})`).join("; ")}`;
      return { check, trace: [{ node: "check_plan", detail }] };
    })
    .addNode("fallback", (s) => {
      const top = s.ranked[0];
      const minutes = Math.min(60, s.student.hoursPerDay * 60);
      const draft: Draft = {
        decision: "safe_fallback",
        blocks: top ? [{ topicId: top.topicId, minutes, activity: "NCERT examples" }] : [],
        message: top ? `Let's keep today simple: ${minutes} min of ${top.name}, NCERT examples only.` : "I have no study records for you yet, so there is nothing to rank and I won't guess a plan. Study records come from a data source, and none has rows for you.",
        evidence: top ? [top.sourceRow] : [],
        reasons: top ? [{ text: `${top.name} is the top priority`, ref: { kind: "data_row", id: top.sourceRow } }] : [],
        ...(s.draft?.comparison ? { comparison: s.draft.comparison } : {}),
      };
      return {
        draft,
        reply: draft.message,
        outcome: "fallback" as const,
        trace: [{ node: "fallback", detail: `${s.attempts} drafts rejected; sent safe fallback`, refs: draft.evidence }],
      };
    })
    .addNode("respond", (s) => ({
      reply: s.draft!.message,
      outcome: "sent" as const,
      trace: [{ node: "respond", detail: `sent decision ${s.draft!.decision}`, refs: s.draft!.evidence }],
    }))
    .addNode("write_back", (s) => {
      if (!memory) return { trace: [{ node: "write_back", detail: "memory OFF: no write-back" }] };
      if (!s.ranked.length) return { trace: [{ node: "write_back", detail: "no study records, so no plan was made: nothing written to memory" }] };
      const rec = rememberEpisode(memory, {
        intent: s.intent,
        decision: s.draft!.decision,
        topTopic: s.ranked[0]?.topicId,
        topics: s.draft!.blocks.map((b) => b.topicId),
        outcome: s.outcome,
      });
      return { trace: [{ node: "write_back", detail: `H-MEM episode ${rec.id} written (decision summary, not the raw message)`, refs: [rec.id] }] };
    })
    .addEdge(START, "sense")
    .addConditionalEdges(
      "sense",
      (s) =>
        s.intent === "distress"
          ? "distress_override"
          : s.intent === "memory_list" || s.intent === "memory_forget"
            ? "memory_ops"
            : s.intent === "doubt"
              ? "answer_doubt"
              : s.intent === "quiz_start" || s.intent === "quiz_answer" || s.intent === "quiz_cancel"
                ? "quiz"
                : "recall",
      ["distress_override", "memory_ops", "answer_doubt", "quiz", "recall"]
    )
    .addEdge("distress_override", END)
    .addEdge("memory_ops", END)
    .addEdge("answer_doubt", END)
    .addEdge("quiz", END)
    .addEdge("recall", "draft_plan")
    .addEdge("draft_plan", "check_plan")
    .addConditionalEdges(
      "check_plan",
      (s) => (s.check?.ok ? "respond" : s.attempts < MAX_DRAFTS ? "draft_plan" : "fallback"),
      ["respond", "draft_plan", "fallback"]
    )
    .addEdge("fallback", "write_back")
    .addEdge("respond", "write_back")
    .addEdge("write_back", END)
    .compile();
}

export async function runMentor(deps: GraphDeps, student: StudentContext, message: string, opts?: { activeQuiz?: ActiveQuiz | null }): Promise<MentorState> {
  return buildMentorGraph(deps).invoke({ student, message, activeQuiz: opts?.activeQuiz ?? null });
}
