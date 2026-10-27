import fs from "node:fs";
import { diagnosticFetch, safeFailure, failureDiagnostic, proposalRejectionDiagnostic, type FailureDiagnostic, type CompletionMetadata } from "./live-run-diagnostics.ts";
import path from "node:path";
import { converse, type ConversationEnv } from "../src/agent/conversation.ts";
import { createModelPlanner } from "../src/agent/modelPlanner.ts";
import { assertNoPromptedValue, validateLiveConfiguration, guardVerifierWrites, formatLiveSummary, localStudyClient, type LiveSummary, type StepLabel } from "./live-run-safety.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { meterlessFromEnv } from "../src/llm/meterless.ts";
import { openStudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";
import { fictionalSandbox } from "../src/consent/storageGate.ts";
import { readAttempts, attemptsPathFor } from "../src/quiz/attempts.ts";
import { readQuizLog } from "../src/data/studyData.ts";
import { ModelError } from "../src/llm/client.ts";

export interface ProductVerificationResult {
  ok: boolean;
  checks?: Record<string, boolean>;
  graphChecked?: boolean;
  steps?: LiveSummary["steps"];
  modelRequests?: number;
  modelProvider?: string;
  modelRouted?: string;
  producedBy?: string;
  proposalStatus?: string;
  decision?: string;
  blocks?: string[];
  sql?: string | null;
  source?: string;
  rawModelSnippet?: string;
  usage?: any;
  completion?: CompletionMetadata;
  replySnippet?: string;
  error?: string;
  loop?: { citedQuiz: boolean; exactlyOnce: boolean; masteryUpdated: boolean; adapted: boolean; nextModelValidated: boolean; before: unknown; after: unknown; score: unknown };
}

/** The live verifier passes only when the graph used a validated Meterless proposal backed by a Zetaris read. */
export function isVerifiedProductProposal(result: Omit<ProductVerificationResult, "ok" | "error">, table = "hard_mentor.study_records"): boolean {
  return (
    result.graphChecked === true &&
    result.modelProvider === "meterless" &&
    Boolean(result.modelRouted?.trim()) &&
    result.producedBy === undefined &&
    result.proposalStatus === "validated" &&
    Boolean(result.rawModelSnippet?.trim()) &&
    Boolean(result.source?.includes(`Zetaris table ${table}`)) &&
    Boolean(result.sql?.startsWith("SELECT "))
  );
}

export async function runProductVerification(onFailure: (failure: FailureDiagnostic) => void = () => {}): Promise<ProductVerificationResult> {
  let client;
  let completion: CompletionMetadata | undefined;
  try {
    client = process.env.HM_LIVE_RUN === "1"
      ? (process.env.METERLESS_TOKEN?.trim() ? await localStudyClient(process.env.METERLESS_TOKEN, fetch, metadata => { completion = metadata; }) : null)
      : meterlessFromEnv(process.env, { maxRetries: 0, timeoutMs: 45_000 });
  } catch {
    onFailure(failureDiagnostic('configuration', 'configuration_error'));
    return { ok: false, error: "local_model_unavailable", modelRequests: 0 };
  }
  if (!client) {
    onFailure(failureDiagnostic('configuration', 'configuration_error'));
    return { ok: false, error: "token_missing", modelRequests: 0 };
  }

  // Isolate state completely in an ephemeral directory
  const tempDir = fictionalSandbox("hm-product-verify-");
  const table = process.env.HM_ZETARIS_TABLE;
  if (process.env.HM_STUDY_SOURCE !== "zetaris" || !table) {
    onFailure(failureDiagnostic('configuration', 'configuration_error'));
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { ok: false, error: "zetaris_configuration_required", modelRequests: 0 };
  }
  try {
    const sessionsDir = path.join(tempDir, "sessions");
    const studentsDir = path.join(tempDir, "students");
    const records = path.join(tempDir, "study-records.csv");
    fs.writeFileSync(records, fs.readFileSync("seed/study-records.csv", "utf8"));
    const quizLog = path.join(tempDir, "quiz-log.csv");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
    let modelRouted = "meterless/auto";


    let modelRequests = 0;
    let rawModelText = "";
    let modelUsage: any = null;
    const wrappedClient = {
      ...client,
      async chat(msgs: any, opts: any) {
        if (modelRequests >= 2) throw new ModelError('live_run_model_request_limit', null, false);
        modelRequests++;
        let res;
        try { res = await client.chat(msgs, opts); }
        catch (error) {
          onFailure({ ...failureDiagnostic('model_request', 'model_error', error instanceof ModelError ? error.status : null), ...(completion ? { completion } : {}) });
          throw error;
        }
        rawModelText = res.text;
        modelUsage = res.usage;
        return res;
      },
    };

    let activeRegistry: Parameters<typeof proposalRejectionDiagnostic>[2];
    const modelPlanner = createModelPlanner(
      wrappedClient,
      {
        onCall: (info) => {
          modelRouted = info.model;
        },
        onProposal: (info) => {
          if (info.outcome === 'rejected') onFailure({ ...proposalRejectionDiagnostic(rawModelText, info.issues, activeRegistry), ...(completion ? { completion } : {}) });
        },
      },
      { validate: true }
    );
    // Scope diagnostics to the exact input for this draft; retain no registry in receipts.
    const planner: typeof modelPlanner = { ...modelPlanner, async draft(input) {
      activeRegistry = { rows: input.ranked, memories: input.memories };
      try { return await modelPlanner.draft(input); }
      finally { activeRegistry = undefined; }
    } };

    const env: ConversationEnv = {
      planner,
      maxPlanDrafts: 1, // one draft per planning step; no graph revisions
      retriever: bm25Retriever(corpus),
      research: fixtureResearch,
      corpora: [corpus],
      records,
      quizLog,
      sessionsDir,
      async memoryFor(id) {
        return openStudentMemory(id, { dataRoot: studentsDir, clock: () => Date.now() });
      },
      now: () => new Date().toISOString(),
    };

    const steps: LiveSummary["steps"] = [];
    const label = (turn: Awaited<ReturnType<typeof converse>>): StepLabel =>
      !turn.state || turn.state.outcome === "fallback" ? "FALLBACK" :
      turn.state.draft ? (turn.state.draft.comparison?.proposal.status === "validated" && !turn.state.draft.producedBy ? "LIVE" : "FALLBACK") : "RULES";

    const profile = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours };
    const checks: Record<string, boolean> = {};
    let intakeTurn;
    for (const message of ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"]) {
      intakeTurn = await converse(env, profile, message);
    }
    checks.intake = intakeTurn?.handledBy === "intake" && intakeTurn.session.stage === "ready" &&
      intakeTurn.session.exam?.exam.id === "in-cbse-12";
    if (!checks.intake) return { ok: false, error: "intake_failed", checks, modelRequests, steps };
    const turn = await converse(env, profile, "Plan my study for today.");
    checks.zetarisRead = Boolean(turn.why?.source?.includes(`Zetaris table ${table}`) && turn.why.sql?.startsWith("SELECT ") && turn.state?.ranked.length);
    checks.initialModelValidated = turn.state?.draft?.comparison?.proposal.status === "validated" && !turn.state.draft.producedBy;
    checks.initialGraphChecked = checks.initialModelValidated && turn.state?.check?.ok === true && turn.state.outcome === "sent";

    steps.push({ step: "plan", label: label(turn) });
    const result: Omit<ProductVerificationResult, "ok" | "error"> = {
      modelRequests,
      checks,
      graphChecked: checks.initialGraphChecked,
      ...(completion ? { completion } : {}),
      steps,
      modelProvider: client.provider,
      modelRouted,
      producedBy: turn.state?.draft?.producedBy,
      proposalStatus: turn.state?.draft?.comparison?.proposal?.status,
      decision: turn.state?.draft?.decision,
      blocks: turn.state?.draft?.blocks?.map((b) => `${b.topicId} ${b.minutes}m`),
      sql: turn.why?.sql,
      source: turn.why?.source,
      rawModelSnippet: rawModelText.replace(/\n/g, " "),
      usage: modelUsage,
      replySnippet: turn.reply?.slice(0, 150).replace(/\n/g, " "),
    };
    if (!isVerifiedProductProposal(result, table)) return { ...result, ok: false, error: "verification_gate_failed" };
    // Local scoring must start from the actual read, never an unrelated seed
    // mastery. The remote table stays read-only; updates live in scratch only.
    const rows = turn.state!.ranked;
    if (rows.some(r => [r.topicId, r.subject, r.name].some(v => /[,\r\n]/.test(v)))) return { ...result, ok: false, error: "unsupported_csv_baseline" };
    fs.writeFileSync(records, "student_id,topic_id,subject,name,mastery,marks_weight\n" + rows.map(r => [profile.studentId, r.topicId, r.subject, r.name, r.mastery, r.marksWeight].join(",")).join("\n") + "\n");
    const quiz = await converse(env, profile, "quiz me");
    steps.push({ step: "quiz", label: quiz.state?.quizTurn?.kind === "started" ? "RULES" : "FALLBACK" });
    const active = quiz.session.activeQuiz;
    if (!active) return { ...result, ok: false, error: "cited_quiz_unavailable" };
    const answers = active.quiz.items.map(i => "ABCD"[i.options.indexOf(i.answer)]).join(", ");
    const scored = await converse(env, profile, answers);
    steps.push({ step: "score", label: scored.state?.quizTurn?.kind === "scored" ? "RULES" : "FALLBACK" });
    const repeated = await converse(env, profile, answers); // repeated completion must not save twice
    steps.push({ step: "repeat", label: repeated.state?.quizTurn?.kind === "already_scored" ? "RULES" : "FALLBACK" });
    checks.repeatProtected = repeated.state?.quizTurn?.kind === "already_scored";
    const next = await converse(env, profile, "Plan my study for today.");
    steps.push({ step: "next_plan", label: label(next) });
    const before = turn.state!.ranked;
    const after = next.state?.ranked ?? [];
    const attempts = readAttempts(attemptsPathFor(quizLog), profile.studentId);
    const loop = {
      citedQuiz: active.quiz.items.every(i => !!i.chunkId) && /NCERT/.test(quiz.reply),
      exactlyOnce: attempts.length === 1 && readQuizLog(quizLog).length === 1,
      masteryUpdated: after.some(t => t.mastery !== before.find(b => b.topicId === t.topicId)?.mastery),
      nextModelValidated: next.state?.draft?.comparison?.proposal?.status === "validated" && next.state?.draft?.producedBy === undefined,
      adapted: /What changed since your last plan/.test(next.reply) && after.some(t => t.priority !== before.find(b => b.topicId === t.topicId)?.priority),
      before, after, score: scored.state?.quizTurn,
    };
    Object.assign(checks, { citedQuiz: loop.citedQuiz, scoredOnce: loop.exactlyOnce && scored.state?.quizTurn?.kind === "scored",
      masteryUpdated: loop.masteryUpdated, adapted: loop.adapted, nextModelValidated: loop.nextModelValidated,
      nextGraphChecked: loop.nextModelValidated && next.state?.check?.ok === true && next.state.outcome === "sent" });
    return { ...result, ...(completion ? { completion } : {}), modelRequests, loop, ok: Object.values(checks).every(Boolean) };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function liveSummary(res: ProductVerificationResult): LiveSummary {
  const labels = new Map((res.steps ?? []).map(s => [s.step, s.label]));
  return { modelRequests: res.modelRequests ?? 0, loop: res.ok ? "ok" : "fail",
    steps: ["plan", "quiz", "score", "repeat", "next_plan"].map(step => ({ step, label: labels.get(step) ?? "FALLBACK" })) };
}

if (process.argv[1]?.endsWith("verify-product-path.ts")) {
  const protectedRun = process.env.HM_LIVE_RUN === "1";
  const secrets = [process.env.METERLESS_TOKEN ?? "", process.env.HM_ZETARIS_USER ?? "", process.env.HM_ZETARIS_PASSWORD ?? ""];
  let restore: (() => void) | undefined;
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const originalFetch = globalThis.fetch;
  let failureReason: string | undefined;
  let failure: FailureDiagnostic | undefined;
  const recordFailure = (diagnostic: FailureDiagnostic) => { failure ??= diagnostic; };
  let configured = false;
  if (protectedRun) {
    // Provider/library logs never go to the evidence stream.
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
  }
  try {
    if (protectedRun) {
      if (!process.env.METERLESS_TOKEN?.trim()) {
        const missing = JSON.stringify({ ok: false, error: 'token_missing', modelRequests: 0,
          failure: failureDiagnostic('configuration', 'configuration_error') }) + '\n';
        assertNoPromptedValue(missing, secrets.filter(Boolean));
        stdoutWrite(missing);
        process.exitCode = 10;
        throw new Error('live_run_token_missing');
      }
      validateLiveConfiguration(process.env, secrets);
      // Preflight known evidence/terminal vocabulary before making any request.
      const template = liveSummary({ ok: false, modelRequests: 0 });
      assertNoPromptedValue(JSON.stringify(template) + formatLiveSummary(template) + "LIVE RULES ok", secrets);
      restore = guardVerifierWrites(secrets);
      globalThis.fetch = diagnosticFetch(originalFetch, (reason, diagnostic) => {
        failureReason ??= reason;
        if (diagnostic) recordFailure(diagnostic);
      });
    }
    configured = true;
    const res = await runProductVerification(recordFailure);
    const summary = liveSummary(res);
    const output = protectedRun ? { ...summary, ...(res.checks ? { checks: res.checks } : {}), ...(res.completion ? { completion: res.completion } : {}), ok: res.ok, ...(!res.ok ? { error: safeFailure(failureReason ?? res.error) } : {}) } : res;
    const out = JSON.stringify({ ...output, ...(!res.ok ? { failure: failure ?? failureDiagnostic('verification_gate', 'verification_failed') } : {}) }, null, 2);
    if (protectedRun) {
      // Check both original result and allowlisted evidence before emitting any bytes.
      assertNoPromptedValue(JSON.stringify(res), secrets);
      assertNoPromptedValue(out + formatLiveSummary(summary), secrets);
    }
    stdoutWrite(out + "\n");
    process.exitCode = res.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof Error && error.message === 'live_run_token_missing') { process.exitCode = 10; }
    else {
      // Refusal has a dedicated exit code and emits no potentially unsafe evidence.
      const refused = error instanceof Error && ['live_run_secret_guard', 'live_run_empty_input'].includes(error.message);
      process.exitCode = refused ? 13 : 1;
      if (!refused) {
        const out = JSON.stringify({ ok: false, error: safeFailure(failureReason), modelRequests: null,
          failure: failure ?? failureDiagnostic(configured ? 'verification_gate' : 'configuration', configured ? 'verification_failed' : 'configuration_error') });
        try {
          if (protectedRun) assertNoPromptedValue(out, secrets);
          stdoutWrite(out + "\n");
        } catch { process.exitCode = 13; }
      }
    }
  } finally { globalThis.fetch = originalFetch; restore?.(); }
}
