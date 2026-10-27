import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEVELOPMENT_ATTESTATION, DEVELOPMENT_ATTESTATION_VERSION, ConsentRequests } from "../src/consent/requests.ts";
import { assertStudentStorage, fictionalSandbox } from "../src/consent/storageGate.ts";
import { converse, type ConversationEnv } from "../src/agent/conversation.ts";
import { rulePlanner } from "../src/agent/planner.ts";
import { fixtureResearch } from "../src/context/fixtureExams.ts";
import { listMemories, openStudentMemory, rememberPattern } from "../src/memory/studentMemory.ts";
import { recordQuizResult } from "../src/data/studyData.ts";
import { appendAttempt } from "../src/quiz/attempts.ts";

function setup() {
  const root = fictionalSandbox("hm-consent-", false);
  let now = 1_000;
  let token = "";
  let deliveries = 0;
  const layout = { records: path.join(root, "records.csv"), quizLog: path.join(root, "quiz.csv"), sessionsDir: path.join(root, "sessions"), studentsDir: path.join(root, "students") };
  const service = new ConsentRequests({ sandbox: root, layout, authenticateWithdrawal: c => c === "test-parent-auth" ? { role: "parent", studentId: "riya" } : c === "test-student-auth" ? { role: "student", studentId: "riya" } : null, now: () => now, ttlMs: 120_000, noticeVersion: "test-notice-v1", sender: { async send(m) { token = m.token; deliveries++; } } });
  return { root, layout, service, token: () => token, deliveries: () => deliveries, advance: (ms: number) => now += ms };
}
const confirm = (s: ReturnType<typeof setup>, requestId: string, extra = {}) => s.service.verify({ studentId: "riya", noticeVersion: "test-notice-v1", requestId, token: s.token(), binding: "test-session", method: "POST", confirmed: true, attestation: DEVELOPMENT_ATTESTATION, attestationVersion: DEVELOPMENT_ATTESTATION_VERSION, ...extra });

test("consent: explicit single-use confirmation, session binding, expiry and revocation", async () => {
  const s = setup();
  const file = path.join(s.root, "riya.json");
  assert.throws(() => assertStudentStorage(file, "riya"), /consent required/);
  const r = await s.service.request("riya", "test-session", "parent@example.invalid");
  for (const bad of [{ method: "GET" }, { confirmed: false }, { binding: "wrong-session" }, { token: "wrong" }, { attestation: "yes" }, { attestationVersion: "old" }, { studentId: "kabir" }, { noticeVersion: "old" }]) assert.equal(confirm(s, r.requestId, bad), null);
  assert.equal(s.deliveries(), 1);
  assert.deepEqual(fs.readdirSync(s.root), [], "pending challenges never persist");
  const grant = confirm(s, r.requestId)!;
  assert.equal(grant.simulated, true);
  assert.equal(grant.scope, "fictional-scratch-only");
  assert.equal(confirm(s, r.requestId), null);
  assert.doesNotThrow(() => assertStudentStorage(file, "riya"));
  assert.throws(() => assertStudentStorage(file, "kabir"), /consent required/);
  assert.throws(() => assertStudentStorage(path.resolve("data/riya.json"), "riya"), /consent required/);
  s.service.withdraw("riya", "test-parent-auth");
  assert.throws(() => assertStudentStorage(file, "riya"), /consent required/);
  s.advance(60_000);
  const r2 = await s.service.request("riya", "test-session", "parent@example.invalid");
  s.advance(120_000);
  assert.equal(confirm(s, r2.requestId), null);
});

test("consent: restart, refusal, explicit retries and failed simulated delivery lock storage", async () => {
  const s = setup();
  const r = await s.service.request("riya", "test-session", "parent@example.invalid");
  await assert.rejects(s.service.request("riya", "test-session", "parent@example.invalid"), /rate limited/);
  assert.ok(confirm(s, r.requestId));
  s.advance(120_000);
  assert.equal(s.service.valid("riya"), true, "token expiry does not silently revoke a confirmed grant");
  new ConsentRequests({ sandbox: s.root, now: () => 1, ttlMs: 1000, noticeVersion: "test", sender: { async send() { throw Error("test sender failure"); } } });
  assert.throws(() => assertStudentStorage(path.join(s.root, "data"), "riya"), /consent required/);
  const failed = new ConsentRequests({ sandbox: s.root, now: () => 1, ttlMs: 1000, noticeVersion: "test", sender: { async send() { throw Error("test"); } } });
  await assert.rejects(failed.request("riya", "test", "parent@example.invalid"), /delivery failed/);
  await assert.rejects(failed.request("riya", "test", "parent@example.com"), /Fictional/);
  assert.throws(() => new ConsentRequests({ sandbox: process.cwd(), now: Date.now, ttlMs: 1, noticeVersion: "test", sender: { async send() {} } }), /consent required/);
  assert.deepEqual(fs.readdirSync(s.root), []);
});

test("consent: denied conversation performs no storage initialization, research or model work; distress still responds", async () => {
  const s = setup();
  const fail = () => { throw Error("pending student side effect"); };
  const env: ConversationEnv = { planner: { name: "must-not-call", kind: "rules", draft: fail }, retriever: null, research: { ...fixtureResearch, find: fail }, corpora: [], records: path.join(s.root, "records.csv"), quizLog: path.join(s.root, "quiz.csv"), sessionsDir: path.join(s.root, "sessions"), memoryFor: fail, now: () => "2026-10-26T18:00:00Z" };
  const profile = { studentId: "riya", name: "Fictional test", hoursPerDay: 1 };
  await assert.rejects(converse(env, profile, "plan today"), /consent required/);
  assert.equal((await converse(env, profile, "I want to die")).state?.outcome, "distress_override");
  await assert.rejects(openStudentMemory("riya", { dataRoot: s.root }), /consent required/);
  assert.throws(() => recordQuizResult(path.join(s.root, "records.csv"), env.quizLog, { studentId: "riya", quizId: "test", topicId: "test", takenAt: "now", correct: 1, total: 1, sources: [] }), /consent required/);
  assert.throws(() => appendAttempt(path.join(s.root, "attempts.jsonl"), { studentId: "riya" } as any), /consent required/);
  assert.deepEqual(fs.readdirSync(s.root), []);
});

test("consent: revocation covers existing memory handles; symlinks cannot escape scratch scope", async () => {
  const s = setup();
  const r = await s.service.request("riya", "test-session", "parent@example.invalid");
  confirm(s, r.requestId);
  const mem = await openStudentMemory("riya", { dataRoot: path.join(s.root, "students") });
  const pattern = { content: "fictional revision", subject: "physics", topic: "test", source: "test", synthetic: true };
  rememberPattern(mem, pattern);
  s.service.withdraw("riya", "test-parent-auth");
  assert.equal(fs.existsSync(mem.dir), false);
  assert.throws(() => rememberPattern(mem, pattern), /consent required/);
  assert.equal(fs.existsSync(mem.dir), false);
  const open = fictionalSandbox();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hm-ungranted-"));
  fs.symlinkSync(outside, path.join(open, "escape"));
  assert.throws(() => assertStudentStorage(path.join(open, "escape", "data"), "riya"), /consent required/);
});

test("authenticated withdrawal deletes only the associated fictional records and prevents resurrection after regrant", async () => {
  const s = setup();
  const request = await s.service.request("riya", "test-session", "parent@example.invalid");
  confirm(s, request.requestId);
  fs.copyFileSync("seed/study-records.csv", s.layout.records);
  const mem = await openStudentMemory("riya", { dataRoot: s.layout.studentsDir });
  const pattern = { content: "PRIVATE-FICTIONAL-CANARY", subject: "physics", topic: "test", source: "test", synthetic: true };
  rememberPattern(mem, pattern);
  fs.mkdirSync(s.layout.sessionsDir);
  fs.writeFileSync(path.join(s.layout.sessionsDir, "riya.json"), JSON.stringify({ private: pattern.content }));
  fs.writeFileSync(path.join(s.layout.sessionsDir, "kabir.json"), "other student stays");
  recordQuizResult(s.layout.records, s.layout.quizLog, { studentId: "riya", quizId: "test", topicId: "physics:electrostatics", takenAt: "test", correct: 1, total: 1, sources: [] });
  fs.writeFileSync(path.join(s.root, "quiz-attempts.jsonl"), JSON.stringify({ studentId: "riya", content: pattern.content }) + "\n" + JSON.stringify({ studentId: "kabir", fixture: true }) + "\n");
  assert.throws(() => s.service.withdraw("riya", "wrong-auth"), /Authenticated/);
  assert.ok(fs.existsSync(mem.dir));
  s.advance(60_000);
  const pending = await s.service.request("riya", "test-session", "parent@example.invalid");
  s.service.withdraw("riya", "test-student-auth");
  assert.equal(s.service.receipt("riya"), null);
  assert.equal(confirm(s, pending.requestId), null, "withdrawal invalidates pending tokens");
  assert.equal(fs.existsSync(mem.dir), false);
  assert.equal(fs.existsSync(path.join(s.layout.sessionsDir, "riya.json")), false);
  assert.equal(fs.readFileSync(path.join(s.layout.sessionsDir, "kabir.json"), "utf8"), "other student stays");
  assert.ok(!fs.readFileSync(s.layout.records, "utf8").includes("riya,"));
  assert.ok(fs.readFileSync(s.layout.records, "utf8").includes("kabir,"));
  const audit = fs.readFileSync(path.join(s.root, "deletion-audit.jsonl"), "utf8");
  assert.ok(!/riya|kabir|PRIVATE|parent|auth/.test(audit));
  s.advance(60_000);
  const next = await s.service.request("riya", "test-session", "parent@example.invalid");
  confirm(s, next.requestId);
  assert.throws(() => rememberPattern(mem, pattern), /consent required/, "old in-memory engine cannot resurrect deleted data after regrant");
  assert.throws(() => listMemories(mem), /consent required/, "old handles cannot disclose deleted records after regrant");
  const reopened = await openStudentMemory("riya", { dataRoot: s.layout.studentsDir });
  assert.equal(reopened.hmem.store.all().length, 0);
  s.service.withdraw("riya", "test-parent-auth");
  assert.equal(fs.existsSync(reopened.dir), false);
});

test("development pending defaults expire at 30 minutes with no disk writes or implicit grant", async () => {
  const root = fictionalSandbox("hm-pending-default-", false);
  let now = 0;
  let token = "";
  const service = new ConsentRequests({ sandbox: root, now: () => now, noticeVersion: "development-notice-v1", sender: { async send(m) { token = m.token; } } });
  const request = await service.request("riya", "binding", "parent@example.invalid");
  assert.equal(request.expiresAt, 30 * 60_000);
  now = request.expiresAt;
  assert.equal(service.verify({ studentId: "riya", noticeVersion: "development-notice-v1", requestId: request.requestId, token, binding: "binding", method: "POST", confirmed: true, attestation: DEVELOPMENT_ATTESTATION, attestationVersion: DEVELOPMENT_ATTESTATION_VERSION }), null);
  assert.equal(service.valid("riya"), false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("withdrawal stays locked when deletion preflight fails; a fresh service cannot revive old engine handles", async () => {
  const s = setup();
  const r = await s.service.request("riya", "test-session", "parent@example.invalid");
  confirm(s, r.requestId);
  const mem = await openStudentMemory("riya", { dataRoot: s.layout.studentsDir });
  fs.writeFileSync(path.join(s.root, "quiz-attempts.jsonl"), "corrupt fixture\n");
  assert.throws(() => s.service.withdraw("riya", "test-parent-auth"));
  assert.equal(s.service.valid("riya"), false);
  assert.throws(() => assertStudentStorage(path.join(s.root, "records.csv"), "riya"), /consent required/);
  let token = "";
  const restarted = new ConsentRequests({ sandbox: s.root, noticeVersion: "test", now: () => 0, sender: { async send(m) { token = m.token; } } });
  const r2 = await restarted.request("riya", "test-session", "parent@example.invalid");
  restarted.verify({ studentId: "riya", noticeVersion: "test", requestId: r2.requestId, token, binding: "test-session", method: "POST", confirmed: true, attestation: DEVELOPMENT_ATTESTATION, attestationVersion: DEVELOPMENT_ATTESTATION_VERSION });
  assert.throws(() => rememberPattern(mem, { content: "old", subject: "test", topic: "test", source: "test", synthetic: true }), /consent required/);
});

test("local consent HTTP boundary requires authenticated explicit parent action and ignores substituted identities", async () => {
  const { consentHandler } = await import("../src/consent/http.ts");
  const s = setup();
  const handler = consentHandler({ requests: s.service, authenticate: req => req.headers.get("authorization") === "test-parent-auth" ? { studentId: "riya", sessionBinding: "test-session", role: "parent" } : null });
  const send = (body: unknown, auth = "test-parent-auth", method = "POST") => handler(new Request("http://localhost/consent", { method, headers: { authorization: auth, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  assert.equal((await send({}, "invalid")).status, 401);
  assert.equal((await send({}, "test-parent-auth", "GET")).status, 405);
  const r = await (await send({ operation: "request", studentId: "kabir", recipient: "parent@example.invalid" })).json();
  const confirmation = { operation: "verify", noticeVersion: r.noticeVersion, requestId: r.requestId, token: s.token(), binding: "ignored-attacker-binding", confirmed: true, attestation: DEVELOPMENT_ATTESTATION, attestationVersion: DEVELOPMENT_ATTESTATION_VERSION };
  assert.equal((await send({ ...confirmation, confirmed: false })).status, 403);
  assert.equal((await send(confirmation)).status, 200);
  assert.equal(s.service.valid("riya"), true);
  assert.equal(s.service.valid("kabir"), false);
  assert.equal((await send(confirmation)).status, 403);
  const deletion = await send({ operation: "withdraw" });
  assert.equal(deletion.status, 200);
  assert.equal(s.service.valid("riya"), false);
  assert.equal(s.service.receipt("riya"), null);
});
