// Rule-based plan checker (blueprint section 5, step 5). Deterministic.
// The LLM half of the checker (grounding/tone judgement) is not built yet;
// these rules run first and their verdict cannot be overridden.

import { MASTERED_AT, type RankedTopic } from "./priority.ts";

export interface PlanBlock {
  topicId: string;
  minutes: number;
  activity: string;
}

export interface DraftPlan {
  blocks: PlanBlock[];
  message: string;
  /** ids of evidence the plan relies on: memory ids or data row ids */
  evidence: string[];
}

export interface CheckContext {
  hoursPerDay: number;
  ranked: RankedTopic[];
}

export type RuleId =
  | "non_empty"
  | "positive_minutes"
  | "hours_fit"
  | "covers_top_priority"
  | "no_mastered_repeat"
  | "known_topics"
  | "uses_student_data"
  | "tone";

export interface CheckResult {
  ok: boolean;
  failures: { rule: RuleId; detail: string }[];
}

const INSULTS = /\b(stupid|idiot|dumb|lazy|useless|pathetic|loser|hopeless\s+case|worthless|failure\s+like\s+you)\b/i;

export function checkPlan(plan: DraftPlan, ctx: CheckContext): CheckResult {
  const failures: CheckResult["failures"] = [];
  const fail = (rule: RuleId, detail: string) => failures.push({ rule, detail });
  const byId = new Map(ctx.ranked.map((t) => [t.topicId, t]));

  if (plan.blocks.length === 0) fail("non_empty", "plan has no study blocks");

  const bad = plan.blocks.filter((b) => !(b.minutes > 0));
  if (bad.length) fail("positive_minutes", `non-positive minutes: ${bad.map((b) => b.topicId).join(", ")}`);

  const total = plan.blocks.reduce((s, b) => s + (b.minutes > 0 ? b.minutes : 0), 0);
  const budget = ctx.hoursPerDay * 60;
  if (total > budget) fail("hours_fit", `${total} min planned, budget ${budget} min`);

  const top = ctx.ranked[0];
  if (top && !plan.blocks.some((b) => b.topicId === top.topicId))
    fail("covers_top_priority", `top priority ${top.topicId} missing`);

  const unknown = plan.blocks.filter((b) => !byId.has(b.topicId));
  if (unknown.length) fail("known_topics", `unknown topics: ${unknown.map((b) => b.topicId).join(", ")}`);

  const mastered = plan.blocks.filter((b) => (byId.get(b.topicId)?.mastery ?? 0) >= MASTERED_AT);
  if (mastered.length) fail("no_mastered_repeat", `mastered topics repeated: ${mastered.map((b) => b.topicId).join(", ")}`);

  if (plan.evidence.length === 0) fail("uses_student_data", "no memory or data row cited");

  const insult = plan.message.match(INSULTS);
  if (insult) fail("tone", `insulting word: "${insult[0]}"`);

  return { ok: failures.length === 0, failures };
}
