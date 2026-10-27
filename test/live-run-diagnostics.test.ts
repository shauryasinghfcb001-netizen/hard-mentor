import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { completionMetadata, diagnosticFetch, launcherFailure, safeFailure, failureDiagnostic, proposalRejectionDiagnostic, type FailureDiagnostic } from '../scripts/live-run-diagnostics.ts';
import { meterlessChatModel } from '../src/llm/meterless.ts';
import { validateModelDraft, type ValidationContext } from '../src/agent/modelSafety.ts';

test('missing_evidence receipt cannot distinguish invented ids, wrong kinds, or lost context', () => {
  const row = { topicId: 'synthetic-topic', sourceRow: 'private-row', subject: 'physics', name: 'Synthetic', mastery: 0.2, marksWeight: 0.8 };
  const memory = { id: 'private-memory', content: 'Synthetic', tags: [], relevance: 1 };
  const context = { rows: [row], memories: [memory], hoursPerDay: 1 };
  const reply = (kind: string, id: string) => JSON.stringify({ decision: 'daily_plan',
    blocks: [{ topicId: row.topicId, minutes: 30, activity: 'NCERT' }], message: 'Synthetic.',
    reasons: [{ text: 'Synthetic reason', ref: { kind, id } }] });
  assert.equal(validateModelDraft(reply('data_row', row.sourceRow), context).ok, true);
  assert.equal(validateModelDraft(reply('memory', memory.id), context).ok, true);
  const cases: [string, ValidationContext][] = [
    [reply('data_row', 'private-invented'), context],
    [reply('memory', row.sourceRow), context],
    [reply('data_row', memory.id), context],
    [reply('data_row', row.sourceRow), { ...context, rows: [{ ...row, sourceRow: 'private-changed' }] }],
    [reply('memory', memory.id), { ...context, memories: [] }],
  ];
  for (const [text, ctx] of cases) {
    const validation = validateModelDraft(text, ctx);
    if (validation.ok) assert.fail('expected rejection');
    assert.deepEqual(proposalRejectionDiagnostic(text, validation.issues), {
      stage: 'proposal_validation', service: 'local', httpStatus: null, category: 'proposal_rejected',
      proposal: { input: 'client_text', boundary: 'validation', issueCodes: ['missing_evidence'] },
    });
  }
  // An omitted required ref is a schema failure, not missing_evidence.
  const omitted = JSON.stringify({ decision: 'daily_plan', blocks: [], message: 'Synthetic.', reasons: [{ text: 'Synthetic' }] });
  const invalid = validateModelDraft(omitted, context);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.deepEqual(invalid.issues.map(i => i.code), ['malformed']);
});

test('runner reference diagnostics distinguish typed misses with bounded counts and no private values', () => {
  const row = { topicId: 'private-topic', sourceRow: 'private-row', subject: 'physics', name: 'private-name', mastery: 0.2, marksWeight: 0.8 };
  const memory = { id: 'private-memory', content: 'private-content', tags: [], relevance: 1 };
  const context = { rows: [row], memories: [memory], hoursPerDay: 1 };
  for (const [kind, id, other] of [
    ['data_row', 'private-fabricated', false], ['data_row', memory.id, true],
    ['memory', 'private-fabricated', false], ['memory', row.sourceRow, true],
  ] as const) {
    const text = JSON.stringify({ decision: 'daily_plan', blocks: [], message: 'private-message',
      reasons: [{ text: 'private-claim', ref: { kind, id } }] });
    const validation = validateModelDraft(text, context);
    if (validation.ok) assert.fail('must still reject');
    const diagnostic = proposalRejectionDiagnostic(text, validation.issues, context);
    assert.deepEqual(diagnostic.proposal, { input: 'client_text', boundary: 'validation', issueCodes: ['missing_evidence', 'checker_rejected'],
      registryCounts: { data_row: 1, memory: 1 }, unmatchedReferences: [{ kind, existsInOtherRegistry: other }] });
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-|detail|content/);
    const empty = proposalRejectionDiagnostic(text, validation.issues, { rows: [], memories: [] });
    assert.deepEqual(empty.proposal?.registryCounts, { data_row: 0, memory: 0 });
    assert.deepEqual(empty.proposal?.unmatchedReferences, [{ kind, existsInOtherRegistry: false }]);
  }
  const reasons = Array.from({ length: 100 }, () => [
    { text: 'private', ref: { kind: 'data_row', id: memory.id } },
    { text: 'private', ref: { kind: 'data_row', id: 'private-made-up' } },
    { text: 'private', ref: { kind: 'memory', id: row.sourceRow } },
    { text: 'private', ref: { kind: 'memory', id: 'private-made-up' } },
    { text: 'private', ref: { kind: 'data_row', id: row.sourceRow } },
  ]).flat();
  const text = JSON.stringify({ decision: 'daily_plan', blocks: [], message: 'private', reasons });
  const diagnostic = proposalRejectionDiagnostic(text, [{ code: 'missing_evidence', detail: 'private' }], {
    rows: Array(1001).fill(row), memories: Array(1002).fill(memory),
  });
  assert.deepEqual(diagnostic.proposal?.registryCounts, { data_row: 1000, memory: 1000 });
  assert.equal(diagnostic.proposal?.unmatchedReferences?.length, 4);
  assert.ok(JSON.stringify(diagnostic).length < 600);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private-/);
});

test('rejection diagnostics use the actual parser and schema, with bounded fixed structure only', () => {
  const draft = { decision: 'daily_plan', blocks: [{ topicId: 'synthetic-topic', minutes: 30, activity: 'private-activity' }],
    message: 'private-message', reasons: [{ text: 'private-reason', ref: { kind: 'data_row', id: 'private-row' } }] };
  const context = { rows: [{ topicId: 'synthetic-topic', sourceRow: 'private-row', subject: 'physics', name: 'private-name', mastery: 0.2, marksWeight: 0.8 }],
    memories: [], hoursPerDay: 1 };
  const cases = [
    ['', 'json', 'empty_text', []],
    ['private-response', 'json', 'json_object_missing', []],
    ['{"message":"private-message"', 'json', 'json_object_unterminated', []],
    ['{"message":private-invalid}', 'json', 'invalid_json', []],
    [JSON.stringify({ decision: 'private-invalid' }), 'schema', 'schema_mismatch', ['decision', 'blocks', 'message', 'reasons']],
    [JSON.stringify({ ...draft, blocks: [{ ...draft.blocks[0], minutes: 'private-value' }] }), 'schema', 'schema_mismatch', ['blocks[].minutes']],
    [JSON.stringify({ ...draft, reasons: [{ text: 'private-reason', ref: { kind: 'private-kind', id: 'private-row' } }] }), 'schema', 'schema_mismatch', ['reasons[].ref.kind']],
  ] as const;
  for (const [text, boundary, reason, fields] of cases) {
    const result = validateModelDraft(text, context);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('expected rejection');
    const diagnostic = proposalRejectionDiagnostic(text, result.issues);
    assert.deepEqual(diagnostic.proposal, { input: 'client_text', boundary, reason, issueCodes: ['malformed'],
      ...(boundary === 'schema' ? { schemaFields: fields, schemaCodes: text.includes('private-invalid') ? ['invalid_type', 'invalid_value']
        : text.includes('private-kind') ? ['invalid_value'] : ['invalid_type'] } : {}) });
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-|received|expected|detail|content|token/);
  }
  for (const text of [JSON.stringify(draft), '```json\n' + JSON.stringify(draft) + '\n```',
    JSON.stringify({ ...draft, message: 'Escaped quote: " braces: {} backslash: \\.' })]) {
    assert.equal(validateModelDraft(text, context).ok, true, 'existing object extraction and valid schema unchanged');
  }
  for (const [change, code] of [
    [{ reasons: [{ text: 'private-reason', ref: { kind: 'data_row', id: 'private-foreign' } }] }, 'missing_evidence'],
    [{ blocks: [{ ...draft.blocks[0], topicId: 'private-unknown' }] }, 'unknown_topic'],
    [{ blocks: [{ ...draft.blocks[0], minutes: 61 }] }, 'over_time'],
    [{ blocks: [{ ...draft.blocks[0], minutes: 0 }] }, 'invalid_minutes'],
    [{ reasons: [{ text: 'private-reason', ref: { kind: 'data_row', id: 'private-row', field: 'private-field' } }] }, 'unknown_field'],
  ] as const) {
    const text = JSON.stringify({ ...draft, ...change });
    const result = validateModelDraft(text, context);
    if (result.ok) assert.fail('expected rejection');
    const diagnostic = proposalRejectionDiagnostic(text, result.issues);
    assert.deepEqual(diagnostic.proposal, { input: 'client_text', boundary: 'validation', issueCodes: code === 'unknown_topic' ? [code, 'checker_rejected'] : [code] });
    assert.doesNotMatch(JSON.stringify(diagnostic), /private-/);
  }
  const hostile = proposalRejectionDiagnostic('{}', [{ code: 'private-code', detail: 'private-detail' } as any]);
  assert.deepEqual(hostile.proposal?.issueCodes, []);
  assert.doesNotMatch(JSON.stringify(hostile), /private-/);
  assert.ok((hostile.proposal?.schemaFields?.length ?? 0) <= 8);
  const manyErrors = JSON.stringify({ decision: 'private-value', message: '', blocks: ['private-value', ...Array(20).fill({})],
    reasons: ['private-value', {}, ...Array(20).fill({ ref: {} })] });
  const bounded = proposalRejectionDiagnostic(manyErrors, [{ code: 'malformed', detail: 'private-detail' }]);
  assert.equal(bounded.proposal?.schemaFields?.length, 8);
  assert.ok((bounded.proposal?.schemaCodes?.length ?? 0) <= 4);
  assert.ok(JSON.stringify(bounded).length < 600);
  assert.doesNotMatch(JSON.stringify(bounded), /private-/);
});

test('launcher reasons are strictly allowlisted; refusal is distinct from verifier failure', () => {
  for (const reason of ['token_missing', 'zetaris_login_failed', 'table_missing', 'meterless_http_401', 'meterless_http_503', 'unsafe_output_refused']) {
    assert.equal(launcherFailure(JSON.stringify({ error: reason }), 1), reason);
  }
  for (const raw of ['private provider text', 'meterless_http_503 private detail', 'meterless_http_999', null, {}]) {
    assert.equal(safeFailure(raw), 'verifier_failed');
  }
  assert.equal(launcherFailure('', 13), 'unsafe_output_refused');
  assert.equal(launcherFailure('', 1), 'verifier_failed');
  assert.equal(launcherFailure('{"loop":"fail"}', 1), 'verifier_failed');
});

test('mocked transport records login, table, HTTP and network failures without raw errors', async () => {
  const cases = [
    ['/api/auth/login', new Response('{}', { status: 401 }), 'zetaris_login_failed'],
    ['/api/auth/login', Response.json({}), 'zetaris_login_failed'],
    ['/api/proxy/query/sql/start', Response.json({ code: 'TABLE_NOT_FOUND' }, { status: 400 }), 'table_missing'],
    ['/api/proxy/query/sql/start', new Response('private body', { status: 404 }), 'zetaris_query_failed'],
    ['/v1/chat/completions', new Response('private body', { status: 503 }), 'meterless_http_503'],
  ] as const;
  for (const [path, response, expected] of cases) {
    const reasons: string[] = [];
    const wrapped = diagnosticFetch(async () => response, reason => reasons.push(reason));
    const result = await wrapped(`http://localhost:3000${path}`);
    assert.deepEqual(reasons, [expected]);
    if (path.endsWith('/chat/completions')) assert.equal(await result.text(), '{}');
  }
  const reasons: string[] = [];
  const wrapped = diagnosticFetch(async () => { throw new Error('private body'); }, reason => reasons.push(reason));
  await assert.rejects(wrapped('http://localhost:3000/api/auth/login'), { message: 'request_failed' });
  assert.deepEqual(reasons, ['zetaris_login_failed']);
});

test('successful mocked requests pass through without inventing failure', async () => {
  const response = Response.json({ idToken: 'synthetic-response', orgId: 1 });
  const wrapped = diagnosticFetch(async () => response, () => assert.fail('unexpected failure'));
  assert.equal(await wrapped('http://localhost:3000/api/auth/login'), response);
});

test('Meterless failures retain only recognized categories and bounded completion ids in receipts and adapter errors', async () => {
  const base = failureDiagnostic('model_request', 'http_error', 502);
  const cases = [
    [{ error: { code: 'provider_error', meterless_detail: 'System prompt should always be the first message in `messages`.' },
      meterless: { request_id: 'chatcmpl-Synthetic1234' } },
    { meterlessCategory: 'system_message_order', meterlessRequestId: 'chatcmpl-Synthetic1234' }],
    [{ error: { code: 'rate_limit_exceeded', meterless_detail: 'private-detail' } }, { meterlessCategory: 'rate_limit_exceeded' }],
    [{ error: { code: 'context_length_exceeded' } }, { meterlessCategory: 'context_length_exceeded' }],
    [{ error: { code: 'provider_error' } }, { meterlessCategory: 'provider_error' }],
    ...['private-id', 'chatcmpl-short', 'chatcmpl-private\nheader', `chatcmpl-${'a'.repeat(65)}`, 123, {}, null].map(id => [
      { error: { code: 'private-code', meterless_detail: 'private-detail' }, meterless: { request_id: id } }, {},
    ]),
    [null, {}], [[], {}], ['private-body', {}],
  ] as const;
  for (const [body, expected] of cases) {
    const payload = body && typeof body === 'object' && !Array.isArray(body)
      ? { ...body, prompt: 'private-prompt', headers: { authorization: 'private-token' } } : body;
    const captured: FailureDiagnostic[] = [];
    const fakeFetch = async () => Response.json(payload, { status: 502, headers: { 'x-private': 'private-header' } });
    const wrapped = diagnosticFetch(fakeFetch, (_reason, diagnostic) => { if (diagnostic) captured.push(diagnostic); });
    const response = await wrapped('http://localhost/v1/chat/completions');
    assert.deepEqual(captured, [{ ...base, ...expected }]);
    assert.equal(await response.text(), '{}');
    for (const fetchImpl of [fakeFetch, wrapped]) {
      const model = meterlessChatModel({ token: 'synthetic-token', fetchImpl, maxRetries: 0 });
      await assert.rejects(model.chat([{ role: 'user', content: 'synthetic prompt' }]), (error: Error) => {
        assert.equal(error.message, `meterless HTTP 502: ${JSON.stringify(fetchImpl === wrapped ? {} : expected)}`);
        assert.doesNotMatch(error.message, /private-|synthetic-token|synthetic prompt/);
        return true;
      });
    }
    assert.doesNotMatch(JSON.stringify(captured), /private-/);
  }
  const captured: FailureDiagnostic[] = [];
  const malformed = diagnosticFetch(async () => new Response('private-invalid-json', { status: 502 }),
    (_reason, diagnostic) => { if (diagnostic) captured.push(diagnostic); });
  assert.equal(await (await malformed('http://localhost/v1/chat/completions')).text(), '{}');
  assert.deepEqual(captured, [base]);
});

test('HTTP receipts identify the responding service and stage without diagnosing status causes or leaking data', async () => {
  for (const [route, stage, service] of [
    ['/api/auth/login', 'zetaris_login', 'zetaris'],
    ['/api/proxy/query/sql/start', 'zetaris_query', 'zetaris'],
    ['/v1/chat/completions', 'model_request', 'meterless'],
  ] as const) {
    for (const status of [401, 404, 502]) {
      const captured: FailureDiagnostic[] = [];
      const wrapped = diagnosticFetch(async () => new Response('private-response-marker', {
        status, headers: { 'x-private-marker': 'private-header-marker' },
      }), (_reason, diagnostic) => { if (diagnostic) captured.push(diagnostic); });
      await wrapped(`http://private-host-marker:3000${route}`);
      assert.deepEqual(captured, [{ stage, service, httpStatus: status, category: 'http_error' }]);
      assert.doesNotMatch(JSON.stringify(captured), /private-/);
    }
  }
});

test('transport failure has no HTTP status; malformed successful responses retain their actual status', async () => {
  const captured: FailureDiagnostic[] = [];
  const record = (_reason: string, diagnostic?: FailureDiagnostic) => { if (diagnostic) captured.push(diagnostic); };
  const offline = diagnosticFetch(async () => { throw new Error('private-error-marker'); }, record);
  await assert.rejects(offline('http://localhost/v1/chat/completions'), { message: 'request_failed' });
  assert.deepEqual(captured.pop(), { stage: 'model_request', service: 'meterless', httpStatus: null, category: 'transport_error', transportCause: 'other' });
  for (const [route, stage] of [
    ['/api/auth/login', 'zetaris_login'], ['/api/proxy/query/sql/start', 'zetaris_query'], ['/v1/chat/completions', 'model_request'],
  ] as const) {
    await diagnosticFetch(async () => new Response('private-invalid-json'), record)(`http://localhost${route}`);
    assert.deepEqual(captured.pop(), failureDiagnostic(stage, 'invalid_response', 200));
  }
  assert.equal(failureDiagnostic('verification_gate', 'verification_failed', 999).httpStatus, null);
});

test('transport causes use bounded structured codes and nested causes, never exception text', async () => {
  const cases = [
    [Object.assign(new Error('private-message'), { cause: { code: 'ECONNREFUSED' } }), 'connection_refused'],
    [{ cause: { cause: { code: 'ECONNRESET' } } }, 'connection_reset'],
    [new AggregateError([{ code: 'ENOTFOUND' }], 'private-message'), 'dns'],
    [{ code: 'EAI_AGAIN' }, 'dns'],
    [new DOMException('private-message', 'TimeoutError'), 'timeout'],
    [{ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }, 'timeout'],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'tls'],
    [{ code: 'CERT_HAS_EXPIRED' }, 'tls'],
    [new Error('ECONNREFUSED private-message'), 'other'],
    [{ code: 'private-code', cause: null }, 'other'],
  ] as const;
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  for (const [error, expected] of [...cases, [cycle, 'other']] as const) {
    const captured: FailureDiagnostic[] = [];
    const wrapped = diagnosticFetch(async () => { throw error; }, (_r, d) => { if (d) captured.push(d); });
    await assert.rejects(wrapped('http://localhost/api/proxy/query/sql/start'), { message: 'request_failed' });
    assert.deepEqual(captured, [{ ...failureDiagnostic('zetaris_query', 'transport_error'), transportCause: expected }]);
    assert.doesNotMatch(JSON.stringify(captured), /private-|ECONN|ENOTFOUND|CERT_/);
  }
});

test('explicit table error codes provide a category while valid response content passes through', async () => {
  const failures: FailureDiagnostic[] = [];
  const missing = diagnosticFetch(async () => Response.json({ error: { code: 'TABLE_NOT_FOUND', detail: 'private-detail' } }, { status: 400 }),
    (_reason, diagnostic) => { if (diagnostic) failures.push(diagnostic); });
  await missing('http://localhost/api/proxy/query/sql/start');
  assert.deepEqual(failures, [failureDiagnostic('zetaris_query', 'table_missing', 400)]);
  for (const [route, body] of [
    ['/api/proxy/query/sql/start', { records: [], totalCount: 0, totalPages: 0 }],
    ['/v1/chat/completions', { choices: [{ message: { content: 'synthetic model output' } }] }],
  ] as const) {
    const response = Response.json(body);
    const wrapped = diagnosticFetch(async () => response, () => assert.fail('unexpected failure'));
    assert.equal(await wrapped(`http://localhost${route}`), response);
    assert.deepEqual(await response.json(), body);
  }
});

test('protected verifier preserves safe failure evidence and restores fetch; launcher reads it after failure', () => {
  // Static wiring check only: neither executable is run.
  const verifier = fs.readFileSync('scripts/verify-product-path.ts', 'utf8');
  const launcher = fs.readFileSync('scripts/live-run.sh', 'utf8');
  assert.match(verifier, /error: safeFailure\(failureReason \?\? res.error\)/);
  assert.match(verifier, /process.exitCode = refused \? 13 : 1/);
  assert.match(verifier, /globalThis.fetch = originalFetch/);
  assert.match(launcher, /live-run-diagnostics.ts "\$evidence_file" "\$run_status"/);
  assert.doesNotMatch(launcher, /verifier failed or refused unsafe output/);
});


test('completion metadata allowlists only boundary facts and never invents absent provider telemetry', () => {
  assert.deepEqual(completionMetadata({}), { status: 'response_received' });
  assert.deepEqual(completionMetadata({ choices: [{ message: { content: 'private' }, finish_reason: 'private-reason' }],
    usage: { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: Number.MAX_SAFE_INTEGER + 1, secret: 'private' } }),
    { status: 'response_received', characterCount: 7 });
  assert.deepEqual(completionMetadata({ choices: [{ message: { content: 'private' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 0, completion_tokens: 600, total_tokens: 600 } }),
    { status: 'response_received', characterCount: 7, finishReason: 'length', tokenCounts: { prompt_tokens: 0, completion_tokens: 600, total_tokens: 600 } });
});
