import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import { test, mock } from 'node:test';
import { preflightZetaris } from '../scripts/live-run-preflight.ts';

const env = { HM_STUDY_SOURCE: 'zetaris', HM_ZETARIS_TABLE: 'hard_mentor.study_records', HM_ZETARIS_URL: 'http://127.0.0.1:3000' };

test('preflight checks the configured TCP port, cleans up success, refusal and timeout', async () => {
  for (const event of ['connect', 'error', 'timeout']) {
    let destroyed = false;
    let timeout: () => void;
    const socket = Object.assign(new EventEmitter(), {
      destroy() { destroyed = true; },
      setTimeout(ms: number, fn: () => void) { assert.equal(ms, 2000); timeout = fn; },
    });
    const stub = mock.method(net, 'createConnection', (options: object) => {
      assert.deepEqual(options, { host: '127.0.0.1', port: 3000 });
      queueMicrotask(() => event === 'timeout' ? timeout() : socket.emit(event, new Error('synthetic private detail')));
      return socket;
    });
    try {
      if (event === 'connect') await preflightZetaris(env);
      else await assert.rejects(preflightZetaris(env), { message: 'zetaris_port_unreachable' });
      assert.equal(destroyed, true);
    } finally { stub.mock.restore(); }
  }
});

test('preflight refuses unsafe URLs before opening any socket', async () => {
  const stub = mock.method(net, 'createConnection', () => { throw new Error('must not connect'); });
  try {
    await assert.rejects(preflightZetaris({ ...env, HM_ZETARIS_URL: 'https://example.test' }), /invalid_configuration/);
    assert.equal(stub.mock.callCount(), 0);
  } finally { stub.mock.restore(); }
});

test('launcher preflights before collecting credentials and has safe exit diagnostics', () => {
  // Read only: the live launcher is never executed by the test suite.
  const source = fs.readFileSync('scripts/live-run.sh', 'utf8');
  assert.ok(source.indexOf('scripts/live-run-preflight.ts') < source.indexOf("read -r -s 'METERLESS_TOKEN"));
  assert.match(source, /TRAPEXIT\(\)/);
  assert.match(source, /\(exit \$\{code\}\)/);
  assert.match(source, /HM_ZETARIS_URL='http:\/\/127\.0\.0\.1:3000'/);
});
