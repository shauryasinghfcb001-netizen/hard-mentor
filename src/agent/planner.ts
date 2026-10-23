// Planner contract plus a deterministic rule planner. The rule planner is a
// stand-in until a model is approved (DECISIONS.md Q2): it never claims model
// reasoning, and the graph labels every draft with planner.kind.

import type { CheckResult, DraftPlan } from "../core/checker.ts";
import { MASTERED_AT, type RankedTopic } from "../core/priority.ts";

export type Intent = "distress" | "swap_request" | "plan" | "doubt" | "memory_list" | "memory_forget" | "quiz_start" | "quiz_answer" | "quiz_cancel";

export interface RecalledMemory {
  id: string;
  content: string;
  tags: string[];
  relevance: number;
}

export interface Reason {
  text: string;
  ref: { kind: "memory" | "data_row" | "rule" | "ncert" | "quiz" | "source"; id: string };
}

export interface Draft extends DraftPlan {
  decision: string;
  reasons: Reason[];
  /** who actually produced this draft, when it differs from the planner (model fallback) */
  producedBy?: string;
}

export interface PlannerInput {
  name: string;
  hoursPerDay: number;
  message: string;
  intent: Intent;
  ranked: RankedTopic[];
  memories: RecalledMemory[];
  attempt: number; // 1-based
  feedback: CheckResult["failures"];
}

export interface Planner {
  name: string;
  kind: "rules" | "model";
  draft(input: PlannerInput): Promise<Draft>;
}

function skipPatternFor(topicId: string, memories: RecalledMemory[]): RecalledMemory | undefined {
  const tag = `topic:${topicId.split(":")[1]}`;
  return memories.find((m) => m.tags.includes("pattern") && m.tags.includes(tag));
}

function requestedTopic(message: string, ranked: RankedTopic[], exclude: string): RankedTopic | undefined {
  const lower = message.toLowerCase();
  return ranked.find((t) => t.topicId !== exclude && lower.includes(t.name.toLowerCase()));
}

export const rulePlanner: Planner = {
  name: "rule-planner-v1",
  kind: "rules",
  async draft(input) {
    const budget = input.hoursPerDay * 60;
    const open = input.ranked.filter((t) => t.mastery < MASTERED_AT);
    const top = open[0];
    if (!top) return { decision: "nothing_due", blocks: [], message: "Everything is mastered. Take a revision test.", evidence: [], reasons: [] };

    const reasons: Reason[] = [
      {
        text: `${top.name} is your top priority: mastery ${top.mastery.toFixed(2)}, marks weight ${top.marksWeight}, priority ${top.priority.toFixed(3)}`,
        ref: { kind: "data_row", id: top.sourceRow },
      },
    ];
    // A quiz that moved a planned topic's mastery is cited, so the plan change can be traced to it.
    for (const t of [top, ...open.slice(1, 3)]) {
      const q = t.lastQuiz;
      if (q) reasons.push({ text: `${t.name} mastery was last updated by quiz ${q.quizId}: ${q.correct}/${q.total} on ${q.takenAt.slice(0, 10)}`, ref: { kind: "quiz", id: q.ref } });
    }
    const topMin = Math.round(budget * 0.5);
    let decision = "daily_plan";
    let rest = open.slice(1, 3);
    let message = "";

    if (input.intent === "swap_request") {
      const wanted = requestedTopic(input.message, input.ranked, top.topicId);
      const skip = skipPatternFor(top.topicId, input.memories);
      if (wanted) {
        reasons.push({
          text: `${wanted.name} ranks lower: priority ${wanted.priority.toFixed(3)}`,
          ref: { kind: "data_row", id: wanted.sourceRow },
        });
      }
      reasons.push({ text: "Policy: no swapping a hard task for an easier one without a reason", ref: { kind: "rule", id: "tough-love:no-easy-swap" } });
      if (skip) {
        decision = "refuse_swap";
        reasons.push({ text: `Pattern on record: ${skip.content}`, ref: { kind: "memory", id: skip.id } });
        rest = open.slice(1).filter((t) => t.topicId !== wanted?.topicId).slice(0, 1);
        message =
          `No swap today, ${input.name}. You have already moved ${top.name} to ${wanted?.name ?? "something easier"} before, ` +
          `and the gap is not closing. ${top.name} first for ${topMin} min, starting with the easiest NCERT examples. ` +
          `If you get stuck for 10 minutes, message me the problem.`;
      } else {
        decision = "compromise";
        if (wanted) rest = [wanted, ...open.slice(1).filter((t) => t.topicId !== wanted.topicId)].slice(0, 2);
        message =
          `${top.name} matters more right now, so do it first for ${topMin} min. ` +
          `${wanted ? `${wanted.name} comes after that.` : ""}`.trim();
      }
    } else {
      message = `Today: ${top.name} first for ${topMin} min, then ${rest.map((t) => t.name).join(" and ")}.`;
    }

    const restMin = rest.length ? Math.floor((budget - topMin) / rest.length) : 0;
    const blocks = [
      { topicId: top.topicId, minutes: topMin, activity: "NCERT examples, then exercise problems" },
      ...rest.map((t) => ({ topicId: t.topicId, minutes: restMin, activity: "practice set" })),
    ];
    const evidence = [...new Set(reasons.filter((r) => r.ref.kind !== "rule").map((r) => r.ref.id))];
    return { decision, blocks, message, evidence, reasons };
  },
};
