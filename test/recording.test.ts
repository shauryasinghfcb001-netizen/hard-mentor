// Real loopback HTTP against the recording shell, fictional scratch state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { recordingServer } from '../scripts/record.ts';

test('recording HTTP boundary: loopback, same origin, strict schema and bounded messages', async () => {
  const server = recordingServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    let cookie = '';
    const post = (route: string, body: unknown = {}, headers: Record<string,string> = {}) => fetch(origin + route, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body),
    });
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Personalised Mentor/);
    assert.match(page.headers.get('content-security-policy')!, /connect-src 'self'/);
    assert.equal((await fetch(origin + '/turn')).status, 405);
    assert.equal((await post('/session', {}, { origin: 'https://other.example' })).status, 403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(origin + '/session', { method: 'POST', headers: { host: 'other.example', origin, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(wrongHost, 403);
    assert.equal((await post('/session', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post('/session', {}, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('/session', { dataRoot: '/tmp/anything' })).status, 400);
    const initial = await post('/session');
    assert.equal(initial.status, 200);
    cookie = initial.headers.get('set-cookie')!.split(';')[0];
    assert.match(initial.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    const fresh = await initial.json();
    assert.equal(fresh.memoryOn, false);
    assert.equal(fresh.messages.length, 1);
    assert.equal(fresh.scores.length, 0);
    assert.equal((await post('/turn', { message: 'hi', userId: 'privileged' })).status, 400);
    assert.equal((await post('/turn', { message: 'x'.repeat(1201) })).status, 400);
    assert.equal((await post('/turn', { message: 'x'.repeat(5000) })).status, 413);
    assert.equal((await post('/turn', { message: '' })).status, 400);
    assert.equal((await post('/turn', { message: '12th boards' })).status, 200);
    const retained = await (await post('/session')).json();
    assert.equal(retained.messages.length, 3);
    assert.match(retained.messages[2].text, /Which country/);
    const reset = await post('/reset');
    const clean = await reset.json();
    assert.equal(clean.messages.length, 1);
    assert.equal(clean.memoryOn, false);
    assert.notEqual(reset.headers.get('set-cookie')!.split(';')[0], cookie);
    // The previous scratch session remains intact, with no reset of existing data.
    assert.equal((await (await post('/session')).json()).messages.length, 3);
    const freshClient = await fetch(origin + '/turn', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"message":"hi"}' });
    assert.equal(freshClient.status, 409);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
