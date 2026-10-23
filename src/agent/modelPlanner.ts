// Model planner: Nemotron (or any OpenAI-compatible model) drafts the plan as
// strict JSON. Anything the model returns is parsed and validated here; the
// rule checker in the graph still has the final say. If the call or the parse
// fails, the rule planner drafts instead and the draft says so (producedBy),
// so a rule draft is never shown as model output.

import { z } from "zod";
import type { ChatModel } from "../llm/client.ts";
import { rulePlanner, type Draft, type Planner, type PlannerInput } from "./planner.ts";

const DraftSchema = z.object({
  decision: z.enum(["daily_plan", "refuse_swap", "compromise", "nothing_due"]),
  blocks: z.array(z.object({ topicId: z.string(), minutes: z.number(), activity: z.string() })),
  message: z.string().min(1),
  reasons: z.array(
    z.object({
      text: z.string(),
      ref: z.object({ kind: z.enum(["memory", "data_row", "rule"]), id: z.string() }),
    })
  ),
});

const SYSTEM = `You are Hard Mentor, a strict but caring study planner for a CBSE Class 12 student.
Rules:
- Use ONLY the topics, data rows and memories given. Never invent ids.
- The top-priority topic must be in the plan. Do not plan mastered topics (mastery >= 0.85).
- Total minutes must not exceed the daily budget.
- If the student asks to swap a hard topic for an easier one and a memory shows they have skipped that topic before, refuse the swap (decision "refuse_swap") and cite that memory. Without such a memory, offer "compromise": top topic first, then the requested one.
- Tough love, never insults. Short message, second person.
Reply with ONE JSON object and nothing else:
{"decision": "daily_plan|refuse_swap|compromise|nothing_due", "blocks": [{"topicId": "...", "minutes": 90, "activity": "..."}], "message": "...", "reasons": [{"text": "...", "ref": {"kind": "memory|data_row|rule", "id": "..."}}]}`;

export function buildPlannerPrompt(input: PlannerInput): string {
  const topics = input.ranked.map(
    (t) => `- ${t.topicId} "${t.name}": mastery ${t.mastery.toFixed(2)}, marks weight ${t.marksWeight}, priority ${t.priority.toFixed(3)} [data_row ${t.sourceRow}]`
  );
  const memories = input.memories.length ? input.memories.map((m) => `- [memory ${m.id}] (tags: ${m.tags.join(", ")}) ${m.content}`) : ["- (none)"];
  const lines = [
    `Student: ${input.name}. Daily budget: ${input.hoursPerDay * 60} minutes.`,
    `Intent (from rules): ${input.intent}.`,
    `Student message: """${input.message}"""`,
    "Topics, highest priority first:",
    ...topics,
    "Memories:",
    ...memories,
  ];
  if (input.feedback.length) {
    lines.push(`Your previous draft (attempt ${input.attempt - 1}) was rejected by the checker. Fix these:`);
    for (const f of input.feedback) lines.push(`- ${f.rule}: ${f.detail}`);
  }
  return lines.join("\n");
}

/** Pulls the first top-level JSON object out of a reply (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in reply");
}

export function parseModelDraft(text: string, input: PlannerInput): Draft {
  const d = DraftSchema.parse(extractJson(text));
  // Evidence is derived from the reasons, never taken from the model directly,
  // and only ids that were actually given to the model count.
  const known = new Set([...input.ranked.map((t) => t.sourceRow), ...input.memories.map((m) => m.id)]);
  const evidence = [...new Set(d.reasons.filter((r) => r.ref.kind !== "rule" && known.has(r.ref.id)).map((r) => r.ref.id))];
  return { ...d, evidence };
}

export interface ModelPlannerEvents {
  onCall?: (info: { latencyMs: number; model: string; provider: string; attempts: number }) => void;
  onFallback?: (reason: string) => void;
}

export function createModelPlanner(model: ChatModel, events: ModelPlannerEvents = {}): Planner {
  return {
    name: `model:${model.provider}/${model.model}`,
    kind: "model",
    async draft(input) {
      try {
        const res = await model.chat([
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPlannerPrompt(input) },
        ]);
        events.onCall?.(res);
        return parseModelDraft(res.text, input);
      } catch (err) {
        const reason = (err as Error).message.slice(0, 200);
        events.onFallback?.(reason);
        const draft = await rulePlanner.draft(input);
        return { ...draft, producedBy: `${rulePlanner.name} (rules; model failed: ${reason})` };
      }
    },
  };
}

/** HM_PLANNER=model turns the model planner on; anything else keeps the rule planner. */
export function plannerFromEnv(env: NodeJS.ProcessEnv, model: ChatModel | null): Planner {
  if (env.HM_PLANNER === "model" && model) return createModelPlanner(model);
  return rulePlanner;
}
