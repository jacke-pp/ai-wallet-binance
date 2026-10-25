// The local trading page must only answer this computer's own browser, holding the key from the printed link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-ui-'));
const { startUi } = await import('../lib/ui/server.mjs');

const rpc = { blockNumber: async () => 1000n, logs: async () => [], balance: async () => 10n ** 18n, read: async () => 1n };
const wallet = { status: async () => ({ status: 'CONNECTED' }), address: async () => '0x' + '1'.repeat(40), settings: async () => ({}) };
const engine = { inspect: async () => ({}), buy: async () => { throw new Error('must not be reached'); } };

function req(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let data = ''; res.on('data', c => (data += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

test('local page: key, host and origin are enforced', async () => {
  const ui = await startUi({ cfg: { slippagePct: 15 }, rpc, wallet, createEngine: () => engine, log: () => {} });
  try {
    const port = ui.server.address().port, key = ui.link.split('#k=')[1];
    const host = `127.0.0.1:${port}`;
    assert.equal(ui.server.address().address, '127.0.0.1');
    assert.match(key, /^[0-9a-f]{48}$/);

    const page = await req(port, '/', { headers: { host } });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(!page.body.includes(key), 'the page itself never contains the key');

    assert.equal((await req(port, '/api/state', { headers: { host } })).status, 401, 'no key');
    assert.equal((await req(port, '/api/state', { headers: { host, 'x-aiwb-key': 'f'.repeat(48) } })).status, 401, 'wrong key');
    assert.equal((await req(port, '/api/state', { headers: { host: `evil.example:${port}`, 'x-aiwb-key': key } })).status, 403, 'DNS rebinding host');
    assert.equal((await req(port, '/api/state', { headers: { host, origin: 'https://evil.example', 'x-aiwb-key': key } })).status, 403, 'other website');
    const ok = await req(port, '/api/state', { headers: { host, 'x-aiwb-key': key } });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).signedIn, true);
    assert.equal((await req(port, '/api/trenches', { headers: { host } })).status, 401, 'board needs the key too');
    const board = await req(port, '/api/trenches', { headers: { host, 'x-aiwb-key': key } });
    assert.equal(board.status, 200);
    assert.ok(Array.isArray(JSON.parse(board.body).items));

    // A form post from another page can't send JSON with our header; plain text bodies are refused outright.
    const form = await req(port, '/api/buy', { method: 'POST', headers: { host, 'x-aiwb-key': key, 'content-type': 'text/plain' }, body: '{"ca":"0x' + '2'.repeat(40) + '","bnb":1}' });
    assert.equal(form.status, 415);
    const big = await req(port, '/api/buy', { method: 'POST', headers: { host, 'x-aiwb-key': key, 'content-type': 'application/json' }, body: 'x'.repeat(30_000) });
    assert.equal(big.status, 413);
    assert.equal((await req(port, '/../package.json', { headers: { host } })).status, 404, 'no files outside the page');
  } finally { ui.close(); }
});

test('settings: the GMGN key is saved but never sent back; send switches need an address', async () => {
  const ui = await startUi({ cfg: { slippagePct: 15 }, rpc, wallet, createEngine: () => ({ ...engine, ctxFor: async () => ({ me: '0x' + '1'.repeat(40) }) }), log: () => {} });
  try {
    const port = ui.server.address().port, key = ui.link.split('#k=')[1];
    const headers = { host: `127.0.0.1:${port}`, 'x-aiwb-key': key, 'content-type': 'application/json' };
    const post = b => req(port, '/api/settings', { method: 'POST', headers, body: JSON.stringify(b) });
    assert.equal((await req(port, '/api/settings', { headers: { host: headers.host } })).status, 401);
    const off = JSON.parse((await req(port, '/api/settings', { headers })).body);
    assert.equal(off.autoSendFour, null);
    assert.equal(off.gmgnKey, false);
    const refused = await post({ autoSendFour: true });
    assert.equal(refused.status, 400);
    assert.match(JSON.parse(refused.body).error, /address to send to first/);
    const saved = await post({ autoSendTo: '0x' + '3'.repeat(40), autoSendFour: true, gmgnKey: 'secret-gmgn-key-123' });
    assert.equal(saved.status, 200);
    assert.ok(!saved.body.includes('secret-gmgn-key-123'));
    const v = JSON.parse(saved.body);
    assert.equal(v.gmgnKey, true);
    assert.ok(v.autoSendFour);
    assert.ok(!(await req(port, '/api/settings', { headers })).body.includes('secret-gmgn-key-123'));
    const cleared = JSON.parse((await post({ autoSendTo: '', gmgnKey: '' })).body);
    assert.equal(cleared.autoSendFour, null);
    assert.equal(cleared.gmgnKey, false);
  } finally { ui.close(); }
});
