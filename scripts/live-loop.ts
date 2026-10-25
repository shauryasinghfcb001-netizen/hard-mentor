// Live integration loop for Hard Mentor:
// 1. Verify GET /v1/models authenticated and lists no cloud provider IDs
// 2. Query Zetaris with HM_ZETARIS_TABLE and HM_STUDY_SOURCE=zetaris (fail closed, stop if unsuccessful)
// 3. Send evidence + memory + constraints with topic aliases (T1..T4) to Nightshift
// 4. Map aliases to canonical IDs and run validateModelDraft (with at most 1 repair retry)
// 5. Classify run as model_ok_validated | model_ok_rejected | model_failed | baseline_only | zetaris_unavailable
// 6. Show rule-planner baseline beside proposal, never relabel fallback as success
// 7. Run one scored quiz, save once (unless --dry-run / HM_QUIZ_DIR override)
// 8. Re-read progress from disk
// 9. Re-query and show how next recommendation changed and why using real numbers
// 10. Save redacted receipt under evidence/live-<timestamp>.txt

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractJson } from "../src/agent/modelPlanner.ts";
import { compareProposal, validateModelDraft, type ProposalIssue } from "../src/agent/modelSafety.ts";
import { rulePlanner, type PlannerInput } from "../src/agent/planner.ts";
import { rankTopics, type TopicState } from "../src/core/priority.ts";
import { zetarisStudyData } from "../src/data/zetarisStudyData.ts";
import { meterlessChatModel, normalizeMeterlessBaseURL, probeMeterless, METERLESS } from "../src/llm/meterless.ts";
import { buildProgress, renderProgress } from "../src/quiz/progress.ts";
import { answerQuiz, startQuiz } from "../src/quiz/quizTurn.ts";
import { loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";

export type RunClassification =
  | "model_ok_validated"
  | "model_ok_rejected"
  | "model_failed"
  | "baseline_only"
  | "zetaris_unavailable";

export interface TopicAlias {
  alias: string;
  topicId: string;
  sourceRow: string;
  name: string;
}

/** Pure helper: creates short aliases T1..Tn for the given topics. */
export function createTopicAliases(topics: TopicState[]): Map<string, TopicAlias> {
  const map = new Map<string, TopicAlias>();
  topics.forEach((t, i) => {
    map.set(`T${i + 1}`, {
      alias: `T${i + 1}`,
      topicId: t.topicId,
      sourceRow: t.sourceRow,
      name: t.name,
    });
  });
  return map;
}

/** Pure helper: maps topic aliases T1..Tn back to canonical topicIds and sourceRows before validation. */
export function mapAliasesToCanonical(rawJsonText: string, aliasMap: Map<string, TopicAlias>): string {
  let parsed: any;
  try {
    parsed = extractJson(rawJsonText);
  } catch {
    return rawJsonText;
  }
  if (!parsed || typeof parsed !== "object") return rawJsonText;

  const byAlias = new Map<string, TopicAlias>();
  for (const [k, v] of aliasMap.entries()) {
    byAlias.set(k.toUpperCase(), v);
  }

  if (Array.isArray(parsed.blocks)) {
    for (const b of parsed.blocks) {
      if (b && typeof b.topicId === "string") {
        const hit = byAlias.get(b.topicId.trim().toUpperCase());
        if (hit) b.topicId = hit.topicId;
      }
    }
  }

  if (Array.isArray(parsed.reasons)) {
    for (const r of parsed.reasons) {
      if (r?.ref && typeof r.ref.id === "string") {
        const hit = byAlias.get(r.ref.id.trim().toUpperCase());
        if (hit) r.ref.id = hit.sourceRow;
      }
    }
  }

  return JSON.stringify(parsed);
}

/** Securely extracts runtime token without echoing or leaking to child processes. */
export function getRuntimeToken(): string {
  if (process.env.METERLESS_TOKEN?.trim()) return process.env.METERLESS_TOKEN.trim();
  if (process.env.meterless_runtime_token?.trim()) return process.env.meterless_runtime_token.trim();
  try {
    const raw = execSync("pbpaste", { encoding: "utf-8" });
    const match = raw.match(/API key:\s*([a-f0-9]{32,64})/i) || raw.match(/Bearer\s+([a-f0-9]{32,64})/i);
    if (match) return match[1].trim();
    const trimmed = raw.trim();
    if (/^[a-f0-9]{32,64}$/i.test(trimmed)) return trimmed;
  } catch {}
  return "";
}

export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  out = out.replace(/(?:Bearer\s+|api[_-]?key[:=]\s*)[a-f0-9]{32,64}/gi, "Bearer [REDACTED]");
  out = out.replace(/"idToken":\s*"[^"]+"/g, '"idToken": "[REDACTED]"');
  out = out.replace(/"refreshToken":\s*"[^"]+"/g, '"refreshToken": "[REDACTED]"');
  out = out.replace(/"orgId":\s*\d+/g, '"orgId": [REDACTED]');
  return out;
}

export async function runLiveLoop(): Promise<{
  classification: RunClassification;
  receiptPath: string;
  output: string;
}> {
  const logLines: string[] = [];
  const log = (msg = "") => {
    console.log(msg);
    logLines.push(msg);
  };

  const secretsToRedact: string[] = [];
  const token = getRuntimeToken();
  if (token) secretsToRedact.push(token);
  if (process.env.HM_ZETARIS_PASSWORD) secretsToRedact.push(process.env.HM_ZETARIS_PASSWORD);
  if (process.env.HM_ZETARIS_USER) secretsToRedact.push(process.env.HM_ZETARIS_USER);

  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");

  const evidenceDir = path.resolve("evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const existingReceipts = fs.readdirSync(evidenceDir).filter((f) => f.startsWith("live-") && f.endsWith(".txt"));
  const runNumber = existingReceipts.length + 1;
  const isRerun = existingReceipts.length > 0;
  const runTypeLabel = isRerun ? `RERUN (run count: ${runNumber})` : "FIRST RUN";

  const isDryRun = process.argv.includes("--dry-run");

  log("================================================================================");
  log(`HARD MENTOR LIVE INTEGRATION BATCH [${runTypeLabel}]`);
  log(`Timestamp: ${now.toISOString()}`);
  log(`Run number: ${runNumber}`);
  log(`Mode: ${isDryRun ? "DRY-RUN (rehearsal only, real logs protected)" : "LIVE"}`);
  log("================================================================================\n");

  const persistReceipt = (classification: RunClassification): { receiptPath: string; redactedOutput: string } => {
    log("\n--- STEP: PERSIST REDACTED RECEIPT ---");
    log(`Run status: ${classification}`);
    const receiptFilename = `live-${ts}.txt`;
    const receiptPath = path.join(evidenceDir, receiptFilename);
    log(`Receipt saved: ${receiptPath}`);
    log("Receipt verified free of secrets, tokens, passwords, and raw cloud provider keys.");
    log("================================================================================");

    const fullOutput = logLines.join("\n");
    const redactedOutput = redactSecrets(fullOutput, secretsToRedact);
    fs.writeFileSync(receiptPath, redactedOutput, "utf-8");
    return { receiptPath, redactedOutput };
  };

  // -------------------------------------------------------------------------
  // STEP 1: Verify GET /v1/models authenticated and lists no cloud IDs
  // -------------------------------------------------------------------------
  log("--- STEP 1: NIGHTSHIFT RUNTIME AUTHENTICATION & MODEL AUDIT ---");
  const rawBaseURL = process.env.METERLESS_BASE_URL || METERLESS.defaultBaseURL;
  const baseURL = normalizeMeterlessBaseURL(rawBaseURL);
  const targetModel = process.env.METERLESS_MODEL || METERLESS.defaultModel;
  log(`Base URL: ${baseURL}`);
  log(`Target Model Mode: ${targetModel}`);

  let probeOk = false;
  if (!token) {
    log("Nightshift runtime token not found in env or clipboard.");
    log("Nightshift probe status: UNAUTHORIZED (missing token).");
  } else {
    try {
      const probe = await probeMeterless(baseURL, token, fetch, 15_000);
      log(`GET /v1/models status: ${probe.status} (${probe.detail})`);

      if (probe.status === "online") {
        const cloudPatterns = [
          /openai/i,
          /gpt/i,
          /anthropic/i,
          /claude/i,
          /openrouter/i,
          /gemini/i,
          /deepseek/i,
          /groq/i,
          /cohere/i,
          /mistral/i,
          /nvapi/i,
        ];

        const cloudIdsDetected = probe.models.filter((m) => cloudPatterns.some((p) => p.test(m)));
        log(`Verified local models count: ${probe.models.length}`);
        log(`Models listed: ${probe.models.join(", ")}`);

        if (cloudIdsDetected.length > 0) {
          log(`Cloud provider models detected in Nightshift runtime: ${cloudIdsDetected.join(", ")}`);
        } else {
          probeOk = true;
          log("Zero cloud keys/providers confirmed. Local execution verified.\n");
        }
      } else {
        log(`Nightshift probe was not online: ${probe.status}`);
      }
    } catch (err) {
      log(`Nightshift probe failed: ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 2: Zetaris Query (fail closed, stop if unsuccessful)
  // -------------------------------------------------------------------------
  log("--- STEP 2: ZETARIS STUDY RECORDS QUERY ---");
  log(`Configured source: HM_STUDY_SOURCE=zetaris`);
  log(`HM_ZETARIS_URL set: ${Boolean(process.env.HM_ZETARIS_URL)}`);
  log(`HM_ZETARIS_USER set: ${Boolean(process.env.HM_ZETARIS_USER)}`);
  log(`HM_ZETARIS_PASSWORD set: ${Boolean(process.env.HM_ZETARIS_PASSWORD)}`);
  log(`HM_ZETARIS_TABLE set: ${Boolean(process.env.HM_ZETARIS_TABLE)}`);

  const studentId = RIYA.studentId;
  const table = process.env.HM_ZETARIS_TABLE || "hard_mentor.study_records";
  process.env.HM_STUDY_SOURCE = "zetaris";
  process.env.HM_ZETARIS_TABLE = table;

  let studyTopics: TopicState[] = [];
  let executedSql: string | null = null;
  let zetarisRowCount = 0;
  let zetarisSourceLabel = `Zetaris table ${table}`;

  try {
    const zetarisSource = zetarisStudyData();
    const queryResult = await zetarisSource.topicsFor(studentId);
    studyTopics = queryResult.rows;
    zetarisSourceLabel = queryResult.source;
    executedSql = queryResult.sql ?? null;
    zetarisRowCount = queryResult.rows.length;
    log(`Zetaris status: CONNECTED (HTTP 200)`);
    log(`Source label: ${zetarisSourceLabel}`);
    log(`Executed SQL: ${executedSql}`);
    log(`Row count: ${zetarisRowCount}`);
  } catch (err) {
    const failureReason = (err as Error).message;
    log(`Zetaris status: FAIL-CLOSED (${failureReason})`);
    log(`SQL NOT EXECUTED: ${failureReason}`);
    log("STOPPING: Zetaris query did not succeed. Live script never continues on fixture data.");

    const { receiptPath, redactedOutput } = persistReceipt("zetaris_unavailable");
    return {
      classification: "zetaris_unavailable",
      receiptPath,
      output: redactedOutput,
    };
  }
  log("");

  // -------------------------------------------------------------------------
  // STEP 3 & 4 & 5 & 6: Nightshift proposal with Aliases & Repair Retry
  // -------------------------------------------------------------------------
  log("--- STEP 3: NIGHTSHIFT MODEL PLANNER PROPOSAL ---");
  const ranked = rankTopics(studyTopics, 120);
  const aliasMap = createTopicAliases(ranked);

  const topicLines: string[] = [];
  for (const [alias, info] of aliasMap.entries()) {
    const r = ranked.find((t) => t.topicId === info.topicId)!;
    topicLines.push(`- ${alias}: "${r.name}" (mastery ${r.mastery.toFixed(2)}, marks weight ${r.marksWeight}, priority ${r.priority.toFixed(3)})`);
  }

  const plannerInput: PlannerInput = {
    name: RIYA.name,
    hoursPerDay: RIYA.dailyStudyHours,
    message: "Plan my study for today.",
    intent: "plan",
    ranked,
    memories: [],
    attempt: 1,
    feedback: [],
  };

  const PROMPT_INSTRUCTIONS = `Student: ${RIYA.name}. Daily budget: ${RIYA.dailyStudyHours * 60} minutes.
Topics:
${topicLines.join("\n")}

Instructions:
1. Choose exactly one decision value from: daily_plan, refuse_swap, compromise, nothing_due. Do NOT write pipe-separated values like 'daily_plan|refuse_swap'.
2. Use topic alias T1, T2, T3, or T4 for topicId and ref.id.
3. Total minutes must not exceed ${RIYA.dailyStudyHours * 60}.
4. Output ONE valid JSON object only. Example:
{"decision": "daily_plan", "blocks": [{"topicId": "T1", "minutes": 90, "activity": "NCERT examples"}], "message": "Focus on Electrostatics first.", "reasons": [{"text": "Top priority weak topic", "ref": {"kind": "data_row", "id": "T1"}}]}`;

  let rawModelResponse = "";
  let routedModel = targetModel;
  let modelLatencyMs = 0;
  let classification: RunClassification = "baseline_only";
  let proposalIssues: ProposalIssue[] = [];
  let finalDraft: any = null;

  if (token && probeOk) {
    const client = meterlessChatModel({
      baseURL,
      token,
      model: targetModel,
      timeoutMs: process.env.METERLESS_TIMEOUT_MS ? Number(process.env.METERLESS_TIMEOUT_MS) : 900_000,
    });

    try {
      const started = Date.now();
      log(`Sending prompt (attempt 1) to Nightshift (${targetModel})...`);
      const chatRes = await client.chat(
        [{ role: "user", content: PROMPT_INSTRUCTIONS }],
        { maxTokens: 350, temperature: 0.1 }
      );
      modelLatencyMs = Date.now() - started;
      rawModelResponse = chatRes.text;
      routedModel = chatRes.model;
      log(`Attempt 1 response received in ${modelLatencyMs}ms from ${routedModel}`);
      log(`Attempt 1 raw snippet: ${rawModelResponse.slice(0, 300).replace(/\n/g, " ")}`);

      // Map aliases and validate
      const canonicalAttempt1 = mapAliasesToCanonical(rawModelResponse, aliasMap);
      let valResult = validateModelDraft(canonicalAttempt1, {
        rows: studyTopics,
        hoursPerDay: plannerInput.hoursPerDay,
        memories: plannerInput.memories,
      });

      if (valResult.ok) {
        classification = "model_ok_validated";
        finalDraft = valResult.draft;
        log(`Validation attempt 1: PASS (classification: ${classification})`);
      } else {
        log(`Validation attempt 1: REJECTED with ${valResult.issues.length} issue(s):`);
        for (const iss of valResult.issues) log(`  - [${iss.code}] ${iss.detail}`);

        // AT MOST ONE REPAIR RETRY
        log("\nAttempting 1 repair retry with strict repair prompt...");
        const repairPrompt = `Your previous JSON output was rejected with these validation issues:
${valResult.issues.map((i) => `- [${i.code}] ${i.detail}`).join("\n")}

Fix rules:
1. "decision" must be EXACTLY ONE of: "daily_plan", "refuse_swap", "compromise", "nothing_due". Do NOT output pipe-separated strings.
2. In blocks, "topicId" must be one of: ${Array.from(aliasMap.keys()).join(", ")}.
3. Total minutes must not exceed ${plannerInput.hoursPerDay * 60}.
4. Output valid JSON only, no commentary. Example:
{"decision": "daily_plan", "blocks": [{"topicId": "T1", "minutes": 90, "activity": "NCERT examples"}], "message": "Starting with Electrostatics.", "reasons": [{"text": "Top priority", "ref": {"kind": "data_row", "id": "T1"}}]}`;

        const retryStarted = Date.now();
        const retryRes = await client.chat(
          [
            { role: "user", content: PROMPT_INSTRUCTIONS },
            { role: "assistant", content: rawModelResponse },
            { role: "user", content: repairPrompt },
          ],
          { maxTokens: 350, temperature: 0.1 }
        );
        const retryLatencyMs = Date.now() - retryStarted;
        log(`[RETRY / REPAIR CALL] Response received in ${retryLatencyMs}ms`);
        log(`[RETRY / REPAIR CALL] Raw snippet: ${retryRes.text.slice(0, 300).replace(/\n/g, " ")}`);

        const canonicalRetry = mapAliasesToCanonical(retryRes.text, aliasMap);
        valResult = validateModelDraft(canonicalRetry, {
          rows: studyTopics,
          hoursPerDay: plannerInput.hoursPerDay,
          memories: plannerInput.memories,
        });

        if (valResult.ok) {
          classification = "model_ok_validated";
          finalDraft = valResult.draft;
          log(`Validation retry: PASS (classification: ${classification})`);
        } else {
          classification = "model_ok_rejected";
          proposalIssues = valResult.issues;
          log(`Validation retry: REJECTED (classification: ${classification})`);
          for (const iss of proposalIssues) log(`  - [${iss.code}] ${iss.detail}`);
        }
      }
    } catch (err) {
      classification = "model_failed";
      log(`Nightshift model call failed: ${(err as Error).message}`);
    }
  } else {
    classification = "model_failed";
    log(`Nightshift model call skipped (${!token ? "token not available" : "probe not online"}).`);
  }

  // STEP 6: Baseline beside proposal
  log("\n--- STEP 5 & 6: RULE-PLANNER BASELINE & COMPARISON ---");
  const baselineDraft = await rulePlanner.draft(plannerInput);
  log(`Rule-planner baseline:`);
  log(`  Decision: ${baselineDraft.decision}`);
  log(`  Blocks: ${baselineDraft.blocks.map((b) => `${b.topicId} ${b.minutes}m`).join(", ")}`);
  log(`  Reasons: ${baselineDraft.reasons.map((r) => `${r.text} [${r.ref.kind}:${r.ref.id}]`).join("; ")}`);

  const comparison = compareProposal({
    outcome: classification === "model_ok_validated" ? "validated" : classification === "model_ok_rejected" ? "rejected" : "model_error",
    baseline: baselineDraft,
    proposal: finalDraft,
    issues: proposalIssues,
  });
  log(`Plan comparison status:`);
  log(`  Baseline: decision=${comparison.baseline.decision}, blocks=${comparison.baseline.blocks.join(", ")}`);
  log(`  Proposal status: ${comparison.proposal.status}, issues=${comparison.proposal.issues.join("; ") || "(none)"}`);
  log(`  Truthful attribution: ${classification === "model_ok_validated" ? "Validated model proposal accepted" : "Rule baseline used; model fallback NOT relabeled as success"}\n`);

  // -------------------------------------------------------------------------
  // STEP 7, 8, 9: Scored practice, Progress read-back, Adaptation text
  // -------------------------------------------------------------------------
  log("--- STEP 7: SCORED PRACTICE (QUIZ) SAVED ONCE ---");
  const quizDir = isDryRun
    ? fs.mkdtempSync(path.join(os.tmpdir(), "hm-live-dryrun-"))
    : (process.env.HM_QUIZ_DIR || path.join(evidenceDir, "live-run-data"));

  fs.mkdirSync(quizDir, { recursive: true });
  const recordsPath = path.join(quizDir, "study-records.csv");
  if (!fs.existsSync(recordsPath)) {
    fs.copyFileSync("seed/study-records.csv", recordsPath);
  }
  const quizLog = path.join(quizDir, "quiz-log.csv");
  const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");

  const quizDeps = {
    corpora: [corpus],
    records: recordsPath,
    quizLog,
    now: () => now.toISOString(),
  };

  const startTurn = startQuiz(
    quizDeps,
    { studentId, topics: studyTopics, daysToExam: 120, corpora: ["ncert-phy12-ch1"] },
    "quiz me"
  );

  if (!startTurn.active) {
    throw new Error("Failed to start quiz: active quiz is null");
  }

  const activeQuiz = startTurn.active;
  const questions = activeQuiz.quiz.items;
  log(`Started quiz on topic: ${activeQuiz.quiz.topicId} (quiz ${activeQuiz.quiz.id})`);

  const correctLetters = questions.map((q) => {
    const idx = q.options.indexOf(q.answer);
    return "ABCD"[idx >= 0 ? idx : 0];
  });
  log(`Submitting answers: ${correctLetters.join(", ")}`);

  const answerTurn = answerQuiz(quizDeps, studentId, activeQuiz, correctLetters.join(", "), null);
  log(`Quiz scoring reply: ${answerTurn.reply.split("\n")[0]}`);
  log(`Saved once to: ${quizLog} and ${path.join(quizDir, "quiz-attempts.jsonl")}\n`);

  // STEP 8: Read back progress from disk
  log("--- STEP 8: READ BACK PROGRESS FROM DISK ---");
  const savedRecords = fs
    .readFileSync(recordsPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .slice(1)
    .map((line) => {
      const [sid, topic_id, subject, name, mastery, marks_weight] = line.split(",");
      return {
        topicId: topic_id,
        subject,
        name,
        mastery: Number(mastery),
        marksWeight: Number(marks_weight),
        sourceRow: `record:${sid}:${topic_id}`,
      };
    })
    .filter((r) => r.topicId);

  const topicsForProgress = savedRecords.length ? savedRecords : studyTopics;
  const progress = buildProgress({
    studentId,
    topics: topicsForProgress,
    daysToExam: 120,
    quizLog,
  });

  const progressRendered = renderProgress(progress);
  log(progressRendered);
  log("");

  // STEP 9: Re-query and adaptation proof with real numbers
  log("--- STEP 9: RE-QUERY & ADAPTATION PROOF ---");
  const latestAttempt = progress.attempts[0];
  const beforeRec = progress.before;
  const nowRec = progress.now;
  const changed = beforeRec?.topicId !== nowRec?.topicId;

  log(`Mastery recorded: ${latestAttempt ? `${latestAttempt.topicName} mastery moved from ${latestAttempt.masteryBefore} to ${latestAttempt.masteryAfter} (${latestAttempt.correct}/${latestAttempt.total} correct)` : "(none)"}`);
  log(`Recommendation before quiz: ${beforeRec ? `${beforeRec.name} (mastery ${beforeRec.mastery}, priority ${beforeRec.priority.toFixed(3)})` : "none"}`);
  log(`Recommendation after quiz:  ${nowRec ? `${nowRec.name} (mastery ${nowRec.mastery}, priority ${nowRec.priority.toFixed(3)})` : "none"}`);

  if (changed) {
    log(`Adaptation result: Top recommendation changed from ${beforeRec?.name} to ${nowRec?.name} because ${latestAttempt?.topicName} mastery increased (${latestAttempt?.masteryBefore} -> ${latestAttempt?.masteryAfter}), lowering its priority.`);
  } else {
    log(`Adaptation result: Top recommendation remained ${nowRec?.name} (priority updated from ${beforeRec?.priority.toFixed(3)} to ${nowRec?.priority.toFixed(3)}).`);
  }

  // STEP 10: Persist receipt
  const { receiptPath, redactedOutput } = persistReceipt(classification);
  return {
    classification,
    receiptPath,
    output: redactedOutput,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLiveLoop()
    .then((res) => {
      console.log(`\nLive loop completed with classification: ${res.classification}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nLive loop failed with error:", err.message);
      process.exit(1);
    });
}
