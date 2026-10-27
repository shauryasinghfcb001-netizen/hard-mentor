// OFFLINE MOCK - not Zetaris connection evidence.
// Pure formatting tests. Dummy credentials, mocked fetch, no socket is opened.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { boundedQueryMain, formatFailure, formatQuery } from "../scripts/zetaris-query.ts";
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
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

test('bounded query success and failure use only login and one SELECT, without model configuration or output', async () => {
  const env = new Proxy({ ...ENV, HM_STUDY_SOURCE: 'zetaris' }, {
    get(target, key) {
      assert.doesNotMatch(String(key), /METERLESS|MODEL|TOKEN/, 'model configuration must never be read');
      return Reflect.get(target, key);
    },
  });
  for (const outcome of ['success', 'transport', 'http', 'invalid', 'login'] as const) {
    const routes: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const route = new URL(String(input)).pathname;
      routes.push(route);
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal, 'retain connector timeout');
      if (route === '/api/auth/login') return Response.json(outcome === 'login' ? {} : LOGIN.body);
      assert.equal(route, '/api/proxy/query/sql/start', 'model request is forbidden');
      assert.match(String(init?.body), /WHERE student_id = 'riya'/);
      assert.equal(JSON.parse(String(init?.body)).pageLimit, 500);
      if (outcome === 'transport') throw Object.assign(new Error('private-message'), { cause: { code: 'ECONNREFUSED' } });
      if (outcome === 'http') return new Response('private-body', { status: 502 });
      const records = [{ topic_id: 'private-topic', subject: 'physics', name: 'private-name', mastery: outcome === 'invalid' ? 'bad' : '0.2', marks_weight: '0.8' }];
      return Response.json({ records, totalCount: 1, totalPages: 1 });
    };
    let output = '';
    const code = await boundedQueryMain(env, fetchImpl, s => { output += s; });
    const receipt = JSON.parse(output);
    assert.equal(receipt.modelRequests, 0);
    assert.equal(receipt.mode, 'query-only');
    assert.equal(code, outcome === 'success' ? 0 : 1);
    assert.equal(receipt.ok, outcome === 'success');
    assert.deepEqual(routes, outcome === 'login' ? ['/api/auth/login'] : ['/api/auth/login', '/api/proxy/query/sql/start']);
    assert.equal(receipt.requests, routes.length);
    if (outcome === 'success') assert.equal(receipt.rowCount, 1);
    if (outcome === 'transport') assert.deepEqual(receipt.failure, {
      stage: 'zetaris_query', service: 'zetaris', category: 'transport_error', httpStatus: null, transportCause: 'connection_refused',
    });
    if (outcome === 'http') assert.equal(receipt.failure.httpStatus, 502);
    if (outcome === 'invalid') assert.equal(receipt.failure.category, 'invalid_response');
    if (outcome === 'login') assert.equal(receipt.failure.stage, 'zetaris_login');
    for (const secret of [...SECRETS, ENV.HM_ZETARIS_USER, 'private-']) assert.ok(!output.includes(secret));
  }
});

test('bounded executable terminates on either outcome and never loads a model module', () => {
  for (const success of [true, false]) {
    // Entire child uses synthetic environment and fetch; importing a model/resolver fails the test.
    const code = `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, next) {
        if (/llm\\/|modelPlanner|verify-product-path/.test(specifier)) throw new Error('forbidden_model_import');
        return next(specifier, context);
      }});
      globalThis.fetch = async (input) => {
        if (String(input).endsWith('/api/auth/login')) return Response.json({idToken:'synthetic-response',orgId:1});
        if (!String(input).endsWith('/api/proxy/query/sql/start')) throw new Error('forbidden_model_request');
        ${success ? "return Response.json({records:[{topic_id:'x',subject:'physics',name:'X',mastery:'0.2',marks_weight:'0.8'}],totalCount:1,totalPages:1});" : "throw {cause:{code:'ECONNRESET'}};"}
      };
      process.argv = [process.execPath, new URL('./scripts/zetaris-query.ts', import.meta.url).pathname, '--bounded'];
      await import('./scripts/zetaris-query.ts');
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      encoding: 'utf8', env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: '1', ...ENV, HM_STUDY_SOURCE: 'zetaris' },
    });
    assert.equal(child.stderr, '');
    assert.equal(child.status, success ? 0 : 1);
    const receipt = JSON.parse(child.stdout);
    assert.equal(receipt.ok, success);
    assert.equal(receipt.modelRequests, 0);
    assert.equal(receipt.requests, 2);
  }
});

test('launcher query-only mode bypasses token prompt and exits before verifier or evidence writes', () => {
  const source = fs.readFileSync('scripts/live-run.sh', 'utf8');
  assert.match(source, /--clean "\$\{mode_args\[@\]\}"/);
  assert.match(source, /if \(\( ! query_only \)\); then\s+typeset METERLESS_TOKEN\s+read -r -s 'METERLESS_TOKEN\?METERLESS_TOKEN: ' <\/dev\/tty\s+print -u2\s+fi/);
  const start = source.indexOf('if (( query_only )); then');
  const end = source.indexOf("failure_reason='token_missing'", start);
  const branch = source.slice(start, end);
  assert.match(branch, /exec node --import tsx scripts\/zetaris-query.ts --bounded/);
  assert.match(branch, /\) 2>\/dev\/null && exit 0\s+exit \$\?\s+fi/);
  assert.doesNotMatch(branch, /METERLESS|verify-product-path|mkdir|evidence_file/);
});
