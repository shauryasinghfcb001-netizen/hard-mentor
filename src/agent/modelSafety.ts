// Offline safety layer for model-proposed plans. A model draft is parsed with
// the existing parseModelDraft, then checked against the rows and memories
// that were supplied for THIS student. Any failure keeps the deterministic
// rule-planner baseline as the answer and is never counted as model success.
// No network access here beyond the injected ChatModel.

import type { TopicState } from "../core/priority.ts";
import { rankTopics, type RankedTopic } from "../core/priority.ts";
import { checkPlan } from "../core/checker.ts";
import type { ChatModel } from "../llm/client.ts";
import { buildPlannerPrompt, extractJson, parseModelDraft } from "./modelPlanner.ts";
import { rulePlanner, type Draft, type PlannerInput } from "./planner.ts";

export type ProposalIssueCode =
  | "malformed"
  | "unknown_topic"
  | "missing_evidence"
  | "ambiguous_evidence"
  | "foreign_evidence"
  | "unknown_field"
  | "invalid_minutes"
  | "over_time";

export interface ProposalIssue {
  code: ProposalIssueCode;
  detail: string;
}

export interface ValidationContext {
  /** rows supplied by the trusted data source; ids also in foreignRowIds are not treated as this student's */
  rows: TopicState[];
  /** source row ids known to belong to other students; refs to them are rejected */
  foreignRowIds?: string[];
  hoursPerDay: number;
  memories: PlannerInput["memories"];
}

export type Validation = { ok: true; draft: Draft } | { ok: false; issues: ProposalIssue[] };

/** Rows with no proof of ownership are not trusted: foreign ids are dropped from the student's rows. */
export function ownRows(rows: TopicState[], foreignRowIds: string[] = []): TopicState[] {
  const foreign = new Set(foreignRowIds);
  return rows.filter((r) => !foreign.has(r.sourceRow));
}

export function validateModelDraft(text: string, ctx: ValidationContext): Validation {
  const foreign = new Set(ctx.foreignRowIds ?? []);
  const rows = ctx.rows;
  const input = { ranked: ownRows(rows, [...foreign]), memories: ctx.memories } as PlannerInput;
  let draft: Draft;
  let raw: any;
  try {
    raw = extractJson(text);
    draft = parseModelDraft(text, input);
  } catch (err) {
    return { ok: false, issues: [{ code: "malformed", detail: (err as Error).message.slice(0, 200) }] };
  }

  const issues: ProposalIssue[] = [];
  const issue = (code: ProposalIssueCode, detail: string) => issues.push({ code, detail });

  // Topic and time rules come from the existing checker so there is one definition of them.
  const own = ownRows(rows, [...foreign]) as RankedTopic[];
  const plan = checkPlan({ blocks: draft.blocks, message: draft.message, evidence: ["-"] }, { hoursPerDay: ctx.hoursPerDay, ranked: own });
  for (const f of plan.failures) {
    if (f.rule === "known_topics") issue("unknown_topic", f.detail);
    else if (f.rule === "hours_fit") issue("over_time", f.detail);
    else if (f.rule === "positive_minutes") issue("invalid_minutes", f.detail);
  }

  const rawReasons: any[] = Array.isArray(raw?.reasons) ? raw.reasons : [];
  draft.reasons.forEach((r, i) => {
    const { kind, id } = r.ref;
    // Optional ref.field is not part of DraftSchema. If present it must be a real field of the cited record.
    const field = rawReasons[i]?.ref?.field;
    const checkField = (record: object | null) => {
      if (field === undefined) return;
      if (!(record && typeof field === "string" && Object.hasOwn(record, field))) issue("unknown_field", `${kind} ${id} has no field ${JSON.stringify(field)}`);
    };
    if (kind === "rule") return checkField(null);
    if (kind === "data_row") {
      const hits = rows.filter((t) => t.sourceRow === id);
      if (foreign.has(id)) issue(hits.length ? "ambiguous_evidence" : "foreign_evidence", hits.length ? `data_row ${id} is listed as both this student's and another student's row` : `data_row ${id} belongs to another student`);
      else if (hits.length === 0) issue("missing_evidence", `data_row ${id}`);
      else if (hits.length > 1) issue("ambiguous_evidence", `data_row ${id} matches ${hits.length} rows`);
      else checkField(hits[0]);
    } else if (kind === "memory") {
      const hits = ctx.memories.filter((m) => m.id === id);
      if (hits.length === 0) issue("missing_evidence", `memory ${id}`);
      else if (hits.length > 1) issue("ambiguous_evidence", `memory ${id} matches ${hits.length} records`);
      else checkField(hits[0]);
    }
  });

  return issues.length ? { ok: false, issues } : { ok: true, draft };
}

/**
 * validated = model draft passed every check and is used.
 * rejected = model replied but the draft failed validation; baseline is used.
 * model_error = the model call itself failed; baseline is used.
 * fallback = no model was configured; baseline is used.
 */
export type ProposalOutcome = "validated" | "rejected" | "model_error" | "fallback";

export interface ProposalRun {
  outcome: ProposalOutcome;
  /** true only for outcome "validated": a baseline answer is never model success */
  modelSuccess: boolean;
  /** the draft to act on */
  draft: Draft;
  baseline: Draft;
  proposal: Draft | null;
  issues: ProposalIssue[];
  error?: string;
}

export interface ProposalOptions {
  daysToExam: number;
  foreignRowIds?: string[];
}

export async function runModelProposal(model: ChatModel | null, input: PlannerInput, opts: ProposalOptions): Promise<ProposalRun> {
  const rows = ownRows(input.ranked, opts.foreignRowIds);
  const own = rankTopics(rows, opts.daysToExam);
  const scoped: PlannerInput = { ...input, ranked: own };
  const baseline = await rulePlanner.draft(scoped);
  const done = (outcome: ProposalOutcome, extra: Partial<ProposalRun> = {}): ProposalRun => ({
    outcome,
    modelSuccess: outcome === "validated",
    draft: outcome === "validated" ? extra.proposal! : baseline,
    baseline,
    proposal: null,
    issues: [],
    ...extra,
  });
  if (!model) return done("fallback");

  let text: string;
  try {
    text = (await model.chat([{ role: "user", content: buildPlannerPrompt(scoped) }])).text;
  } catch (err) {
    return done("model_error", { error: (err as Error).message.slice(0, 200) });
  }
  const v = validateModelDraft(text, { rows: input.ranked, foreignRowIds: opts.foreignRowIds, hoursPerDay: input.hoursPerDay, memories: input.memories });
  return v.ok ? done("validated", { proposal: v.draft }) : done("rejected", { issues: v.issues });
}

export interface Comparison {
  baseline: { decision: string; blocks: string[] };
  proposal: { status: ProposalOutcome; decision?: string; blocks?: string[]; issues: string[] };
}

const fmtBlocks = (d: Draft) => d.blocks.map((b) => `${b.topicId} ${b.minutes}min`);

/** Pure: baseline recommendation beside the model proposal and its status. */
export function compareProposal(run: Pick<ProposalRun, "outcome" | "baseline" | "proposal" | "issues" | "error">): Comparison {
  const issues = run.issues.map((i) => `${i.code}: ${i.detail}`);
  if (run.error) issues.push(`model_error: ${run.error}`);
  return {
    baseline: { decision: run.baseline.decision, blocks: fmtBlocks(run.baseline) },
    proposal: run.proposal
      ? { status: run.outcome, decision: run.proposal.decision, blocks: fmtBlocks(run.proposal), issues }
      : { status: run.outcome, issues },
  };
}
