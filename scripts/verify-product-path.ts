import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { converse, type ConversationEnv } from "../src/agent/conversation.ts";
import { createModelPlanner } from "../src/agent/modelPlanner.ts";
import { renderWhyCard } from "../src/agent/whyCard.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { meterlessChatModel } from "../src/llm/meterless.ts";
import { openStudentMemory } from "../src/memory/studentMemory.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";
import { RIYA } from "../src/synthetic/riya.ts";
import { getRuntimeToken } from "./live-loop.ts";

export interface ProductVerificationResult {
  ok: boolean;
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
  replySnippet?: string;
  error?: string;
}

/** The live verifier passes only when the graph used a validated Meterless proposal backed by a Zetaris read. */
export function isVerifiedProductProposal(result: Omit<ProductVerificationResult, "ok" | "error">): boolean {
  return (
    result.modelProvider === "meterless" &&
    Boolean(result.modelRouted?.trim()) &&
    result.producedBy === undefined &&
    result.proposalStatus === "validated" &&
    Boolean(result.rawModelSnippet?.trim()) &&
    Boolean(result.source?.includes("Zetaris table hard_mentor.study_records")) &&
    Boolean(result.sql?.startsWith("SELECT "))
  );
}

export async function runProductVerification(): Promise<ProductVerificationResult> {
  const token = getRuntimeToken();
  if (!token) {
    return { ok: false, error: "token_missing" };
  }

  // Isolate state completely in an ephemeral directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-product-verify-"));
  const priorStudySource = process.env.HM_STUDY_SOURCE;
  const priorZetarisTable = process.env.HM_ZETARIS_TABLE;
  try {
    const sessionsDir = path.join(tempDir, "sessions");
    const studentsDir = path.join(tempDir, "students");
    const records = path.join(tempDir, "study-records.csv");
    fs.copyFileSync("seed/study-records.csv", records);
    const quizLog = path.join(tempDir, "quiz-log.csv");
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Pre-populate Riya's session in ready stage so message triggers LangGraph planner loop
    fs.writeFileSync(
      path.join(sessionsDir, "riya.json"),
      JSON.stringify({
        studentId: RIYA.studentId,
        stage: "ready",
        intake: { step: "exam", goal: {} },
        exam: {
          exam: { id: "cbse_12", name: "CBSE Class 12", body: "CBSE", country: "IN" },
          goal: { exam: "CBSE Class 12" },
          corpora: ["ncert-phy12-ch1"],
          facts: [],
          research: { kind: "fixture" },
        },
        activeQuiz: null,
        lastPlan: null,
      })
    );

    const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
    let modelRouted = "meterless/auto";
    const client = meterlessChatModel({
      baseURL: "http://127.0.0.1:8088/v1",
      token,
      model: "meterless/auto",
      timeoutMs: 180_000,
    });

    let rawModelText = "";
    let modelUsage: any = null;
    const wrappedClient = {
      ...client,
      async chat(msgs: any, opts: any) {
        const res = await client.chat(msgs, opts);
        rawModelText = res.text;
        modelUsage = res.usage;
        return res;
      },
    };

    const planner = createModelPlanner(
      wrappedClient,
      {
        onCall: (info) => {
          modelRouted = info.model;
        },
      },
      { validate: true }
    );

    const env: ConversationEnv = {
      planner,
      retriever: bm25Retriever(corpus),
      research: fixtureResearch,
      corpora: [corpus],
      records,
      quizLog,
      sessionsDir,
      async memoryFor(id) {
        return openStudentMemory(id, { dataRoot: studentsDir, clock: () => Date.now() });
      },
      now: () => "2026-10-25T10:00:00Z",
    };

    process.env.HM_STUDY_SOURCE = "zetaris";
    process.env.HM_ZETARIS_TABLE = "hard_mentor.study_records";

    const profile = { studentId: RIYA.studentId, name: RIYA.name, hoursPerDay: RIYA.dailyStudyHours };
    const turn = await converse(env, profile, "Plan my study for today.");

    const result: Omit<ProductVerificationResult, "ok" | "error"> = {
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
    return isVerifiedProductProposal(result) ? { ...result, ok: true } : { ...result, ok: false, error: "verification_gate_failed" };
  } finally {
    if (priorStudySource === undefined) delete process.env.HM_STUDY_SOURCE;
    else process.env.HM_STUDY_SOURCE = priorStudySource;
    if (priorZetarisTable === undefined) delete process.env.HM_ZETARIS_TABLE;
    else process.env.HM_ZETARIS_TABLE = priorZetarisTable;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("verify-product-path.ts")) {
  runProductVerification().then((res) => {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  });
}
