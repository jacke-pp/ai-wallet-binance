import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLcx, LCX } from '../lib/lcx.mjs';
import { createEngine } from '../lib/engine.mjs';
import { setConfig, publicConfig } from '../lib/store.mjs';

beforeEach(() => { process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-')); });

const ME = '0x00000000000000000000000000000000000000aa';
const COIN = '0x00000000000000000000000000000000000000c0';
const ZERO = '0x0000000000000000000000000000000000000000';

// The API, answering like https://swap-api.lcx.com/v1: quote.* and build.* override fields of the answers; error: an
// error answer { status, code } for every call.
function fakeApi({ quote = {}, swap = {}, build = {}, error = null } = {}) {
  const seen = [];
  let last;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, init, body });
    if (error) return { status: error.status, json: async () => ({ success: false, code: error.code, error: error.code, message: 'refused' }) };
    if (url.endsWith('/quote')) {
      last = { body, min: String((5000n * BigInt(10000 - body.slippageBps)) / 10000n) };
      const q = { quoteId: `q_${seen.length}`, chainId: 56, input: { token: body.tokenIn, amount: body.amountIn, decimals: 18 },
        output: { token: body.tokenOut, amount: '5000', minimumAmount: last.min, decimals: 18 }, spender: LCX.router,
        venues: ['pancake-v3'], routes: [], expiresAt: 1, stale: false, ...quote };
      return { status: 200, json: async () => ({ success: true, data: { quote: q } }) };
    }
    const value = last.body.tokenIn === ZERO ? last.body.amountIn : '0';
    return { status: 200, json: async () => ({ success: true, data: { swap: { chainId: 56, to: LCX.router, data: '0xdeadbeef00', value, ...swap },
      minAmountOut: last.min, deadline: '2', routerDeployed: true, simulation: { status: 'skipped', why: 'awaiting_allowance' }, ...build } }) };
  };
  return { seen, fetchImpl };
}
const client = o => { const f = fakeApi(o); return { f, lcx: createLcx({ key: 'test-key', fetchImpl: f.fetchImpl }) }; };

test('LCX Liberty DEX client: sends your key, BNB as the zero address and base units; builds for the wallet', async () => {
  const { f, lcx } = client();
  const r = await lcx.route(null, COIN, 100n);
  assert.equal(r.amountOut, 5000n);
  assert.deepEqual(r.venues, ['pancake-v3']);
  assert.equal(f.seen[0].url, 'https://swap-api.lcx.com/v1/quote');
  assert.equal(f.seen[0].init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(f.seen[0].body, { chainId: 56, tokenIn: ZERO, tokenOut: COIN, amountIn: '100', slippageBps: 50 });
  // The slippage is fixed on a quote: build quotes again with the one asked for, then builds that quote.
  const tx = await lcx.build(r, 1500, ME);
  assert.deepEqual(tx, { to: LCX.router, value: 100n, data: '0xdeadbeef00', floor: 4250n });
  assert.equal(f.seen[1].body.slippageBps, 1500);
  assert.equal(f.seen[2].url, 'https://swap-api.lcx.com/v1/build');
  assert.deepEqual(f.seen[2].body, { quoteId: 'q_2', recipient: ME, slippageBps: 1500 });
  // A sale sends no BNB.
  const s = await lcx.route(COIN, null, 100n);
  assert.equal(f.seen[3].body.tokenOut, ZERO);
  assert.equal((await lcx.build(s, 100, ME)).value, 0n);
  // Above the API's 20% nothing is asked.
  const n = f.seen.length;
  await assert.rejects(lcx.build(r, 2001, ME), /at most 20% slippage/);
  assert.equal(f.seen.length, n);
});

test('LCX Liberty DEX client: a quote or a build that does not match the request is refused', async () => {
  const bad = async (o, re, sell = false) => {
    const { lcx } = client(o);
    await assert.rejects((async () => lcx.build(await lcx.route(sell ? COIN : null, sell ? null : COIN, 100n), 1000, ME))(), re);
  };
  await bad({ quote: { spender: '0x0000000000000000000000000000000000000bad' } }, /unknown router/);
  await bad({ quote: { chainId: 1 } }, /unknown router/);
  await bad({ quote: { input: { token: ZERO, amount: '99' } } }, /different swap/);
  await bad({ quote: { input: { token: COIN, amount: '100' } } }, /different swap/);
  await bad({ quote: { output: { token: ZERO, amount: '5000', minimumAmount: '4500' } } }, /different swap/);
  await bad({ quote: { stale: true } }, /no route/);
  await bad({ swap: { to: '0x0000000000000000000000000000000000000bad' } }, /unknown router/);
  await bad({ swap: { chainId: 1 } }, /unknown router/);
  await bad({ build: { routerDeployed: false } }, /unknown router/);
  await bad({ build: { minAmountOut: '1' } }, /different minimum/);
  await bad({ swap: { value: '99' } }, /unexpected amount of BNB/);
  await bad({ swap: { value: '100' } }, /unexpected amount of BNB/, true);
  await bad({ swap: { data: '0x' } }, /empty transaction/);
});

test('LCX Liberty DEX client: a coin it refuses (transfer tax) is "no route"; a refused key is flagged to be said', async () => {
  for (const code of ['transfer_tax', 'transfer_blocked']) {
    const { lcx } = client({ error: { status: 422, code } });
    await assert.rejects(lcx.route(null, COIN, 100n), e => e.message === `LCX Liberty DEX: no route (${code})` && !e.notice);
  }
  const { lcx } = client({ error: { status: 401, code: 'INVALID_API_KEY' } });
  await assert.rejects(lcx.route(null, COIN, 100n), e => /INVALID_API_KEY/.test(e.message) && e.notice === true);
  const down = createLcx({ key: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(down.route(null, COIN, 100n), /did not answer \(ECONNRESET\)/);
});

test('LCX Liberty DEX is off without a key; the key is checked and never shown', async () => {
  const wallet = { address: async () => ME };
  assert.equal((await createEngine({ rpc: {}, wallet, kyber: null }).ctxFor()).lcx, null);
  const ctx = await createEngine({ rpc: {}, wallet, kyber: null, cfg: { lcxKey: 'lcx_test_key_123' } }).ctxFor();
  assert.equal(typeof ctx.lcx.route, 'function');
  assert.ok(!JSON.stringify(ctx.lcx).includes('lcx_test_key_123'));
  assert.throws(() => setConfig('lcxKey', 'short'), /LCX Liberty DEX API key/);
  setConfig('lcxKey', 'lcx_test_key_123');
  assert.equal(publicConfig().lcxKey, '(set)');
  assert.ok(!JSON.stringify(publicConfig()).includes('lcx_test_key_123'));
});
