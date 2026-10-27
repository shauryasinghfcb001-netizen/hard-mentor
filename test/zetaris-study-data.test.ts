// OFFLINE MOCK - not Zetaris connection evidence.
// Every test injects a fake fetch with dummy credentials. No socket is opened.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { zetarisStudyData } from "../src/data/zetarisStudyData.ts";
import { csvStudyData } from "../src/data/studyData.ts";

const PASS = "dummy-pass-xyz";
const TOKEN = "dummy.id.token";
const ENV = {
  HM_ZETARIS_URL: "http://localhost:3000/",
  HM_ZETARIS_USER: "dummy-user@example.test",
  HM_ZETARIS_PASSWORD: PASS,
  HM_ZETARIS_TABLE: "main.study_records",
};
const LOGIN_OK = { idToken: TOKEN, refreshToken: "dummy-refresh", orgId: 4242 };
const rec = (o: Record<string, string> = {}) => ({ topic_id: "physics:x", subject: "physics", name: "X", mastery: "0.35", marks_weight: "0.2", ...o });
const page = (records: unknown, o: Record<string, unknown> = {}) => ({ records, pageNumber: 1, pageLimit: 500, totalCount: Array.isArray(records) ? records.length : 0, totalPages: 1, queryToken: "q", ...o });

type Reply = { status?: number; body?: unknown; raw?: string; throws?: boolean };
function mock(login: Reply, query: Reply = { body: page([rec()]) }) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = url.endsWith("/api/auth/login") ? login : query;
    if (r.throws) throw new TypeError(`connect failed ${PASS} ${TOKEN}`);
    return new Response(r.raw ?? JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}
const src = (f: typeof fetch, env: Record<string, string | undefined> = ENV) => zetarisStudyData({ env, fetch: f });
const SECRETS = [PASS, TOKEN, "dummy-refresh", "4242", ENV.HM_ZETARIS_USER];

async function failure(p: Promise<unknown>, re: RegExp): Promise<void> {
  await assert.rejects(p, (e: Error) => {
    assert.match(e.message, re);
    assert.match(e.message, /^Zetaris unavailable/);
    for (const s of SECRETS) assert.ok(!e.message.includes(s), `error leaks ${s}`);
    return true;
  });
}

describe("OFFLINE MOCK - not Zetaris connection evidence: success", () => {
  test("logs in, queries once, maps rows like csvStudyData, reports the exact SQL", async () => {
    const m = mock({ body: LOGIN_OK }, { body: page([rec(), rec({ topic_id: "maths:y", subject: "maths", name: "Y", mastery: " 1 ", marks_weight: ".5" })]) });
    const s = src(m.f);
    assert.equal(s.kind, "zetaris");
    const q = await s.topicsFor("riya-1");
    assert.deepEqual(q.rows, [
      { topicId: "physics:x", subject: "physics", name: "X", mastery: 0.35, marksWeight: 0.2, sourceRow: "zetaris:main.study_records#1" },
      { topicId: "maths:y", subject: "maths", name: "Y", mastery: 1, marksWeight: 0.5, sourceRow: "zetaris:main.study_records#2" },
    ]);
    const sql = "SELECT topic_id, subject, name, mastery, marks_weight FROM main.study_records WHERE student_id = 'riya-1' ORDER BY topic_id";
    assert.equal(q.sql, sql);
    assert.equal(q.source, "Zetaris table main.study_records");

    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[0].url, "http://localhost:3000/api/auth/login");
    assert.deepEqual(m.calls[0].body, { username: ENV.HM_ZETARIS_USER, password: PASS });
    assert.equal(m.calls[1].url, "http://localhost:3000/api/proxy/query/sql/start");
    assert.equal(m.calls[1].headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(m.calls[1].headers["X-Org-ID"], "4242");
    assert.match(m.calls[1].headers["X-Request-ID"], /^[0-9a-f-]{36}$/);
    assert.deepEqual(m.calls[1].body, { select: sql, pageLimit: 500 });
  });

  test("accepts the real seed CSV value ranges and maps them like csvStudyData", async () => {
    const lines = fs.readFileSync("seed/study-records.csv", "utf-8").split("\n").slice(1).filter((l) => l.trim());
    const mine = lines.map((l) => l.split(",")).filter((f) => f[0] === "riya");
    assert.ok(mine.length > 0);
    const records = mine.map(([, topic_id, subject, name, mastery, marks_weight]) => ({ topic_id, subject, name, mastery, marks_weight }));
    const z = await src(mock({ body: LOGIN_OK }, { body: page(records) }).f).topicsFor("riya");
    const c = await csvStudyData("seed/study-records.csv").topicsFor("riya");
    const strip = (rows: typeof z.rows) => rows.map(({ sourceRow: _s, ...r }) => r);
    assert.deepEqual(strip(z.rows), strip(c.rows));
  });
  test("range is 0..1 inclusive for both columns, same as csvStudyData (marks_weight above 1 is rejected)", async () => {
    const edge = await src(mock({ body: LOGIN_OK }, { body: page([rec({ mastery: "0", marks_weight: "1" }), rec({ topic_id: "t2", mastery: "1", marks_weight: "0" })]) }).f).topicsFor("a");
    assert.deepEqual(edge.rows.map((r) => [r.mastery, r.marksWeight]), [[0, 1], [1, 0]]);
  });

  test("logs in again on every call (no token cache)", async () => {
    const m = mock({ body: LOGIN_OK });
    const s = src(m.f);
    await s.topicsFor("a");
    await s.topicsFor("a");
    assert.equal(m.calls.filter((c) => c.url.endsWith("/login")).length, 2);
  });
});

describe("OFFLINE MOCK - not Zetaris connection evidence: config and input guards", () => {
  for (const key of Object.keys(ENV)) {
    test(`unset ${key} -> not configured, no request`, async () => {
      const m = mock({ body: LOGIN_OK });
      await failure(src(m.f, { ...ENV, [key]: undefined }).topicsFor("a"), /not configured/);
      assert.equal(m.calls.length, 0);
    });
  }
  test("bad table, bad student id, non-local URL throw before any request", async () => {
    const m = mock({ body: LOGIN_OK });
    await failure(src(m.f, { ...ENV, HM_ZETARIS_TABLE: "t; drop table x" }).topicsFor("a"), /invalid table/);
    await failure(src(m.f).topicsFor("a' OR '1'='1"), /invalid student/);
    await failure(src(m.f, { ...ENV, HM_ZETARIS_URL: "https://example.com" }).topicsFor("a"), /localhost/);
    await failure(src(m.f, { ...ENV, HM_ZETARIS_URL: "not a url" }).topicsFor("a"), /localhost/);
    assert.equal(m.calls.length, 0);
  });
});

describe("OFFLINE MOCK - not Zetaris connection evidence: fail closed", () => {
  test("network error on login", async () => {
    await failure(src(mock({ throws: true }).f).topicsFor("a"), /login request failed/);
  });
  test("login 404 reports status and endpoint without guessing the cause", async () => {
    await failure(
      src(mock({ status: 404, body: { message: PASS } }).f).topicsFor("a"),
      /^Zetaris unavailable: login returned HTTP 404 \(localhost:3000\/api\/auth\/login\)$/
    );
  });
  test("login non-2xx", async () => {
    await failure(
      src(mock({ status: 401, body: { message: PASS } }).f).topicsFor("a"),
      /login returned HTTP 401 \(localhost:3000\/api\/auth\/login\)/
    );
  });
  test("login not JSON", async () => {
    await failure(
      src(mock({ raw: "<html>" }).f).topicsFor("a"),
      /login response was not JSON \(HTTP 200\) \(localhost:3000\/api\/auth\/login\)/
    );
  });
  for (const [label, body] of [
    ["no idToken", { orgId: 1 }],
    ["idToken not string", { idToken: 5, orgId: 1 }],
    ["empty idToken", { idToken: "", orgId: 1 }],
    ["no orgId", { idToken: TOKEN }],
    ["orgId string", { idToken: TOKEN, orgId: "1" }],
    ["orgId fractional", { idToken: TOKEN, orgId: 1.5 }],
    ["null body", null],
  ] as const) {
    test(`malformed login: ${label}`, async () => {
      const m = mock({ body });
      await failure(src(m.f).topicsFor("a"), /login response malformed/);
      assert.equal(m.calls.length, 1); // never queries with a bad login
    });
  }
  test("network error on query", async () => {
    await failure(src(mock({ body: LOGIN_OK }, { throws: true }).f).topicsFor("a"), /query request failed/);
  });
  test("query non-2xx", async () => {
    await failure(
      src(mock({ body: LOGIN_OK }, { status: 500, body: { error: TOKEN } }).f).topicsFor("a"),
      /query returned HTTP 500 \(localhost:3000\/api\/proxy\/query\/sql\/start\)/
    );
  });
  test("query not JSON", async () => {
    await failure(
      src(mock({ body: LOGIN_OK }, { raw: "oops" }).f).topicsFor("a"),
      /query response was not JSON \(HTTP 200\) \(localhost:3000\/api\/proxy\/query\/sql\/start\)/
    );
  });
  for (const [label, body] of [
    ["records missing", { totalCount: 0, totalPages: 1 }],
    ["records not array", page("x")],
    ["totalCount missing", { records: [rec()], totalPages: 1 }],
    ["totalPages missing", { records: [rec()], totalCount: 1 }],
    ["record is null", page([null])],
    ["record is string", page(["x"])],
    ["column missing", page([{ topic_id: "t", subject: "s", name: "n", mastery: "0.1" }])],
    ["column numeric not string", page([rec({ mastery: 0.5 as unknown as string })])],
    ["empty topic_id", page([rec({ topic_id: " " })])],
    ["null body", null],
  ] as const) {
    test(`malformed query response: ${label}`, async () => {
      await failure(src(mock({ body: LOGIN_OK }, { body }).f).topicsFor("a"), /malformed|invalid/);
    });
  }
  test("truncated: totalCount > records.length", async () => {
    await failure(src(mock({ body: LOGIN_OK }, { body: page([rec()], { totalCount: 2 }) }).f).topicsFor("a"), /truncated/);
  });
  test("truncated: totalPages > 1", async () => {
    await failure(src(mock({ body: LOGIN_OK }, { body: page([rec()], { totalPages: 2 }) }).f).topicsFor("a"), /truncated/);
  });
  for (const bad of ["abc", "", "NaN", "Infinity", "-0.1", "1.01", "1e0", "0x1", "2"]) {
    for (const col of ["mastery", "marks_weight"]) {
      test(`bad ${col} ${JSON.stringify(bad)}`, async () => {
        await failure(src(mock({ body: LOGIN_OK }, { body: page([rec({ [col]: bad })]) }).f).topicsFor("a"), /invalid number/);
      });
    }
  }
  test("zero rows throws 'no records', not an empty success", async () => {
    await failure(src(mock({ body: LOGIN_OK }, { body: page([]) }).f).topicsFor("a"), /no records/);
  });
  test("never returns CSV-shaped data on failure: result is a rejection", async () => {
    await assert.rejects(src(mock({ status: 503 }).f).topicsFor("riya"));
  });
});
