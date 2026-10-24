// OFFLINE MOCK - not Zetaris connection evidence.
// Pure formatting tests. Dummy credentials, mocked fetch, no socket is opened.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatFailure, formatQuery } from "../scripts/zetaris-query.ts";
import { zetarisStudyData } from "../src/data/zetarisStudyData.ts";

const PASS = "dummy-pass-xyz";
const TOKEN = "dummy.id.token";
const ENV = {
  HM_ZETARIS_URL: "http://localhost:3000/",
  HM_ZETARIS_USER: "dummy-user@example.test",
  HM_ZETARIS_PASSWORD: PASS,
  HM_ZETARIS_TABLE: "main.study_records",
};
const SECRETS = [PASS, TOKEN, "dummy-refresh", "4242"];

function fakeFetch(login: { status?: number; body: unknown }, query: { status?: number; body: unknown }): typeof fetch {
  return (async (url: string) => {
    const r = url.endsWith("/api/auth/login") ? login : query;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
}
const LOGIN = { body: { idToken: TOKEN, refreshToken: "dummy-refresh", orgId: 4242 } };

describe("OFFLINE MOCK - not Zetaris connection evidence: zetaris-query format", () => {
  test("success output lists kind, source, exact sql, row count and each row", async () => {
    const records = [
      { topic_id: "physics:x", subject: "physics", name: "X", mastery: "0.35", marks_weight: "0.2" },
      { topic_id: "maths:y", subject: "maths", name: "Y", mastery: "1", marks_weight: "0.5" },
    ];
    const page = { records, pageNumber: 1, pageLimit: 500, totalCount: 2, totalPages: 1, queryToken: "q" };
    const s = zetarisStudyData({ env: ENV, fetch: fakeFetch(LOGIN, { body: page }) });
    const out = formatQuery(s.kind, await s.topicsFor("riya"));
    assert.equal(
      out,
      [
        "kind: zetaris",
        "source: Zetaris table main.study_records",
        "sql: SELECT topic_id, subject, name, mastery, marks_weight FROM main.study_records WHERE student_id = 'riya' ORDER BY topic_id",
        "rows: 2",
        "  topic_id=physics:x name=X mastery=0.35 marks_weight=0.2",
        "  topic_id=maths:y name=Y mastery=1 marks_weight=0.5",
      ].join("\n")
    );
    for (const secret of SECRETS) assert.ok(!out.includes(secret));
  });

  test("a null sql is shown as (none), not hidden", () => {
    const out = formatQuery("zetaris", { rows: [], source: "s", sql: null });
    assert.match(out, /^sql: \(none\)$/m);
    assert.match(out, /^rows: 0$/m);
  });

  test("connector failure prints Zetaris unavailable and no token, password or orgId", async () => {
    const bad = { status: 500, body: { error: `${TOKEN} ${PASS} 4242` } };
    for (const s of [
      zetarisStudyData({ env: ENV, fetch: fakeFetch(LOGIN, bad) }),
      zetarisStudyData({ env: ENV, fetch: fakeFetch(bad, bad) }),
      zetarisStudyData({ env: { ...ENV, HM_ZETARIS_TABLE: undefined }, fetch: fakeFetch(LOGIN, bad) }),
    ]) {
      const err = await s.topicsFor("riya").then(() => null, (e: unknown) => e);
      const out = formatFailure(err, [PASS, ENV.HM_ZETARIS_USER]);
      assert.match(out, /^Zetaris unavailable/);
      for (const secret of [...SECRETS, ENV.HM_ZETARIS_USER]) assert.ok(!out.includes(secret), `leaks ${secret}`);
    }
  });

  test("foreign or secret-bearing errors are replaced, never echoed", () => {
    for (const e of [new Error(`boom ${PASS}`), new Error(`Zetaris unavailable: ${PASS}`), "string", null]) {
      const out = formatFailure(e, [PASS]);
      assert.equal(out, "Zetaris unavailable: unexpected error");
      assert.ok(!out.includes(PASS));
    }
  });

  test("never prints CSV data on failure", () => {
    assert.ok(!/csv/i.test(formatFailure(new Error("Zetaris unavailable: login returned HTTP 503"))));
  });
});
