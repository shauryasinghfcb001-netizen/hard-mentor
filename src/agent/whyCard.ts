// Why card: built only from the graph's final state and trace rows, never
// from free text. `source` and `sql` come only from the provenance the caller
// put on the student context; with none supplied `sql` stays null instead of
// showing a made-up query.

import type { MentorState } from "./graph.ts";
import type { Reason } from "./planner.ts";

export interface WhyCard {
  decision: string;
  outcome: string;
  reasons: Reason[];
  loop: string[];
  sql: string | null;
  /** data source label, present only when the caller supplied provenance */
  source?: string;
}

function reasonsFor(s: MentorState): Reason[] {
  if (s.outcome === "distress_override") return [{ text: "Distress rules matched; they override every other step", ref: { kind: "rule", id: "distress-override" } }];
  if (s.quizTurn) return s.quizTurn.reasons;
  if (s.memoryOp) return s.memoryOp.items.map((m) => ({ text: `${s.memoryOp!.kind === "forget" ? "Deleted" : "Stored"}: ${m.content}`, ref: { kind: "memory" as const, id: m.id } }));
  if (s.doubt) {
    if (s.doubt.mode === "refusal") return [{ text: `Out of syllabus: ${s.doubt.grounding.reason}`, ref: { kind: "rule", id: "out-of-syllabus" } }];
    return s.doubt.citations.map((c) => ({ text: `Grounded in NCERT note ${c.chunkId}, pages ${c.pages.join(", ")}`, ref: { kind: "ncert" as const, id: c.chunkId } }));
  }
  return s.draft?.reasons ?? [];
}

function decisionFor(s: MentorState): string {
  if (s.outcome === "distress_override") return "distress_override";
  if (s.quizTurn) return `quiz_${s.quizTurn.kind}`;
  if (s.memoryOp) return `memory_${s.memoryOp.kind}`;
  if (s.doubt) return `doubt_${s.doubt.mode}`;
  return s.draft?.decision ?? "none";
}

export function buildWhyCard(s: MentorState): WhyCard {
  const prov = s.student?.provenance;
  return {
    decision: decisionFor(s),
    outcome: s.outcome,
    reasons: reasonsFor(s),
    loop: s.trace.map((t, i) => `${i + 1}. [${t.node}] ${t.detail}`),
    sql: prov?.sql ?? null,
    ...(prov ? { source: prov.source } : {}),
  };
}

export function renderWhyCard(card: WhyCard): string {
  const lines = [`Decision: ${card.decision} (${card.outcome})`, "Why:"];
  for (const r of card.reasons) lines.push(`  - ${r.text}  [${r.ref.kind}: ${r.ref.id}]`);
  lines.push("Loop:", ...card.loop.map((l) => `  ${l}`));
  if (card.source !== undefined) lines.push(`Source: ${card.source}`);
  lines.push(`SQL: ${card.sql ?? "(not available: Zetaris federation not wired yet)"}`);
  return lines.join("\n");
}
