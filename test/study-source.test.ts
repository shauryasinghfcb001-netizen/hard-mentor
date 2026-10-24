// OFFLINE MOCK - not Zetaris connection evidence.
// HM_STUDY_SOURCE selection in converse(). Dummy credentials, globalThis.fetch is
// replaced by a mock for the duration of each test; no socket is opened.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { converse, loadSession, type ConversationEnv, type StudentProfile } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { renderWhyCard } from "../src/agent/whyCard.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { readQuizLog } from "../src/data/studyData.ts";
import { bm25Retriever, loadCorpus } from "../src/rag/ncert.ts";

const corpus = loadCorpus("corpus/ncert-phy12-ch1.json");
const RIYA: StudentProfile = { studentId: "riya", name: "Riya (fictional)", hoursPerDay: 3 };
const INTAKE = ["hi", "12th boards", "India", "90% in PCM", "15 Feb 2027", "CBSE"];
const TABLE = "main.study_records";
const SQL = `SELECT topic_id, subject, name, mastery, marks_weight FROM ${TABLE} WHERE student_id = 'riya' ORDER BY topic_id`;
const ZENV = { HM_ZETARIS_URL: "http://localhost:3000/", HM_ZETARIS_USER: "dummy-user@example.test", HM_ZETARIS_PASSWORD: "dummy-pass-xyz", HM_ZETARIS_TABLE: TABLE };
// Zetaris baseline differs from the local seed (electrostatics 0.2 vs 0.35) so the source is observable.
const BASELINE = [
  { topic_id: "chemistry:organic", subject: "chemistry", name: "Organic Chemistry", mastery: "0.6", marks_weight: "0.6" },
  { topic_id: "maths:integrals", subject: "maths", name: "Integrals", mastery: "0.5", marks_weight: "0.7" },
  { topic_id: "physics:electrostatics", subject: "physics", name: "Electrostatics", mastery: "0.2", marks_weight: "0.8" },
  { topic_id: "physics:optics", subject: "physics", name: "Optics", mastery: "0.9", marks_weight: "0.7" },
];

const saved = { fetch: globalThis.fetch, env: { ...process.env } };
afterEach(() => {
  globalThis.fetch = saved.fetch;
  for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
  Object.assign(process.env, saved.env);
  if (saved.env.HM_STUDY_SOURCE === undefined) delete process.env.HM_STUDY_SOURCE;
});

function useZetaris(fail = false) {
  Object.assign(process.env, ZENV, { HM_STUDY_SOURCE: "zetaris" });
  const calls: { url: string; method?: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method, body: String(init.body) });
    if (fail) return new Response("{}", { status: 500 });
    if (url.endsWith("/api/auth/login")) return new Response(JSON.stringify({ idToken: "dummy.id.token", refreshToken: "r", orgId: 4242 }));
    return new Response(JSON.stringify({ records: BASELINE, pageNumber: 1, pageLimit: 500, totalCount: 4, totalPages: 1, queryToken: "q" }));
  }) as typeof fetch;
  return calls;
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-src-"));
  const records = path.join(root, "study-records.csv");
  fs.copyFileSync("seed/study-records.csv", records);
  let t = Date.parse("2026-10-23T09:00:00Z");
  const env: ConversationEnv = {
    planner: rulePlanner,
    retriever: bm25Retriever(corpus),
    research: fixtureResearch,
    corpora: [corpus],
    records,
    quizLog: path.join(root, "quiz-log.csv"),
    sessionsDir: path.join(root, "sessions"),
    async memoryFor() { return null; },
    now: () => new Date((t += 60_000)).toISOString(),
  };
  const say = (msg: string) => converse(env, RIYA, msg);
  const intake = async () => { for (const m of INTAKE) await say(m); };
  return { env, say, intake, records };
}

function letters(env: ConversationEnv): string[] {
  const q = loadSession(env, "riya")!.activeQuiz!.quiz;
  return q.items.map((it) => "ABCD"[it.options.indexOf(it.answer)]);
}

describe("OFFLINE MOCK - not Zetaris connection evidence: HM_STUDY_SOURCE", () => {
  test("unset and csv are identical: local numbers, no provenance, no network", async () => {
    const outs: string[] = [];
    for (const v of [undefined, "csv"]) {
      if (v) process.env.HM_STUDY_SOURCE = v; else delete process.env.HM_STUDY_SOURCE;
      globalThis.fetch = (async () => { throw new Error("network must not be used in csv mode"); }) as typeof fetch;
      const { say, intake } = setup();
      await intake();
      const r = await say("Plan my study for today.");
      assert.equal(r.state!.student!.provenance, undefined);
      assert.equal(r.why!.source, undefined);
      assert.equal(r.why!.sql, null);
      assert.equal(r.state!.ranked.find((x) => x.topicId === "physics:electrostatics")!.mastery, 0.35);
      outs.push(r.reply + "\n" + renderWhyCard(r.why!));
    }
    assert.equal(outs[0], outs[1]);
    assert.doesNotMatch(outs[0], /attempt log|Zetaris baseline/);
  });

  test("invalid value throws a clear error, even before intake", async () => {
    process.env.HM_STUDY_SOURCE = "postgres";
    const { say } = setup();
    await assert.rejects(say("hi"), /HM_STUDY_SOURCE must be "csv" or "zetaris", got "postgres"/);
    process.env.HM_STUDY_SOURCE = "";
    await assert.rejects(say("hi"), /HM_STUDY_SOURCE must be/);
    process.env.HM_STUDY_SOURCE = "ZETARIS";
    await assert.rejects(say("hi"), /HM_STUDY_SOURCE must be/);
  });

  test("zetaris: why card shows the real source and exact SQL; baseline comes from Zetaris", async () => {
    const calls = useZetaris();
    const { say, intake } = setup();
    await intake();
    assert.equal(calls.length, 0, "intake turns do not read Zetaris");
    const r = await say("Plan my study for today.");
    assert.equal(r.why!.sql, SQL);
    assert.equal(r.why!.source, `Zetaris baseline + local attempt log (Zetaris table ${TABLE})`);
    assert.match(renderWhyCard(r.why!), /Zetaris baseline \+ local attempt log/);
    assert.equal(r.state!.ranked.find((x) => x.topicId === "physics:electrostatics")!.mastery, 0.2);
    assert.deepEqual(calls.map((c) => c.url.replace(/^.*localhost:3000/, "")), ["/api/auth/login", "/api/proxy/query/sql/start"]);
    assert.ok(calls.every((c) => c.method === "POST" && !/INSERT|UPDATE|DELETE/i.test(c.body)), "read-only");
  });

  test("zetaris unavailable: reply is 'Zetaris unavailable', turn stops, no CSV fallback", async () => {
    useZetaris(true);
    const { env, say, intake } = setup();
    await intake();
    const r = await say("Plan my study for today.");
    assert.equal(r.reply, "Zetaris unavailable");
    assert.equal(r.state, null);
    assert.equal(r.why, null);
    assert.doesNotMatch(r.reply, /Electrostatics|0\.35/);
    const q = await say("quiz me");
    assert.equal(q.reply, "Zetaris unavailable");
    assert.equal(loadSession(env, "riya")!.activeQuiz, null);
    assert.ok(!fs.existsSync(env.quizLog));
  });

  test("zetaris not configured also fails closed", async () => {
    useZetaris();
    delete process.env.HM_ZETARIS_PASSWORD;
    const { say, intake } = setup();
    await intake();
    assert.equal((await say("Plan my study for today.")).reply, "Zetaris unavailable");
  });

  test("distress reply does not depend on Zetaris", async () => {
    const calls = useZetaris(true);
    const { say } = setup();
    await say("hi");
    const d = await say("I want to die");
    assert.equal(d.state!.outcome, "distress_override");
    assert.equal(calls.length, 0);
  });

  test("zetaris quiz: score saved once locally, applied over the baseline, next plan changes, nothing written to Zetaris", async () => {
    const calls = useZetaris();
    const { env, say, intake, records } = setup();
    await intake();
    const plan1 = await say("Plan my study for today.");
    assert.equal(plan1.state!.draft!.blocks[0].topicId, "physics:electrostatics");
    await say("quiz me");
    const a = letters(env);
    a[2] = "ABCD"[(["A", "B", "C", "D"].indexOf(a[2]) + 1) % 4]; // Q3 wrong -> 4/5
    const done = await say(a.join(", "));
    assert.equal(done.state!.quizTurn!.kind, "scored");
    assert.match(done.reply, /: 4\/5\./);
    assert.equal(readQuizLog(env.quizLog).length, 1, "scored once");
    // Local attempt store is written as before (CSV baseline 0.35 -> 0.485); Zetaris is untouched.
    const local = fs.readFileSync(records, "utf-8").split("\n").find((l) => l.startsWith("riya,physics:electrostatics,"))!;
    assert.equal(local.split(",")[4], "0.485");
    assert.ok(calls.every((c) => c.url.endsWith("/login") || c.url.endsWith("/sql/start")));
    assert.ok(calls.every((c) => !/INSERT|UPDATE|DELETE/i.test(c.body)));

    const plan2 = await say("Plan my study for today.");
    const t = plan2.state!.ranked.find((x) => x.topicId === "physics:electrostatics")!;
    assert.equal(t.mastery, 0.38, "Zetaris 0.2 baseline + 4/5 replayed in memory");
    assert.equal(t.lastQuiz!.correct, 4);
    assert.match(plan2.reply, /Electrostatics mastery 0\.2 -> 0\.38 after quiz/);
    assert.equal(plan2.why!.source, `Zetaris baseline + local attempt log (Zetaris table ${TABLE})`);
    assert.equal(plan2.why!.sql, SQL);

    // A repeat completion of the same quiz id is not scored again.
    assert.equal(readQuizLog(env.quizLog).length, 1);
  });
});
