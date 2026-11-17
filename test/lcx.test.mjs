import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLcx, checkCall, LCX } from '../lib/lcx.mjs';
import { createEngine } from '../lib/engine.mjs';
import { setConfig, publicConfig } from '../lib/store.mjs';
import { encodeCall } from '../lib/abi.mjs';

beforeEach(() => { process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-')); });

const ME = '0x00000000000000000000000000000000000000aa';
const COIN = '0x00000000000000000000000000000000000000c0';
const ZERO = '0x0000000000000000000000000000000000000000';
const POOL = '0x00000000000000000000000000000000000000b0';
const BEBOP = '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F';

// Router calldata, encoded independently of lib/lcx.mjs. f: the six fields the checks read.
const LEGS = '(uint256,(uint8,address,address,address,uint256)[])[]';
const FEE = '(address,address,uint256,uint256,address,uint256,address)';
function calldata(fn, f, maker = BEBOP) {
  const legs = [[f.totalIn, [[1, POOL, f.tokenIn, f.tokenOut, 500n]]]];
  const six = [f.tokenIn, f.tokenOut, f.totalIn, f.minAmountOut, f.recipient, f.deadline];
  return {
    swapSplit: () => encodeCall(`swapSplit(address,address,uint256,uint256,address,uint256,${LEGS})`, [...six, legs]),
    swapSplitWithFee: () => encodeCall(`swapSplitWithFee(${FEE},${LEGS})`, [[...six, ZERO], legs]),
    swapSplitViaPropAMM: () => encodeCall(`swapSplitViaPropAMM(${FEE},${LEGS},address,uint256)`, [[...six, ZERO], legs, POOL, 1n]),
    swapSplitWithPropAMMSplit: () => encodeCall(`swapSplitWithPropAMMSplit(${FEE},${LEGS},${LEGS},(address,uint256,uint256))`, [[...six, ZERO], legs, legs, [POOL, f.totalIn / 2n, 1n]]),
    makerSwap: () => encodeCall(`makerSwap((address,address,uint256,uint256,address,uint256),${LEGS},(address,address,uint256,uint256,bytes),${LEGS})`, [six, legs, [maker, maker, f.totalIn / 2n, 1n, '0xabcdef'], legs]),
  }[fn]();
}
const SELECTORS = { swapSplit: '0xfc54261d', swapSplitWithFee: '0x5e98574a', swapSplitViaPropAMM: '0x195e648e', swapSplitWithPropAMMSplit: '0x31ab353b', makerSwap: '0xa565fdcc' };
const soon = () => BigInt(Math.floor(Date.now() / 1000) + 300);

// The API, answering like https://swap-api.lcx.com/v1: quote.* and build.* override fields of the answers; error: an
// error answer { status, code } for every call; amounts: what the 1st, 2nd... quote pays (default 5000); call: the
// router function the build calls and fields to change in its calldata (maker: makerSwap's market maker).
function fakeApi({ quote = {}, swap = {}, build = {}, error = null, amounts = [], call = {} } = {}) {
  const seen = [];
  let last, quotes = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, init, body });
    if (error) return { status: error.status, json: async () => ({ success: false, code: error.code, error: error.code, message: 'refused' }) };
    if (url.endsWith('/quote')) {
      const amount = BigInt(amounts[quotes++] ?? 5000);
      last = { body, min: String((amount * BigInt(10000 - body.slippageBps)) / 10000n) };
      const q = { quoteId: `q_${seen.length}`, chainId: 56, input: { token: body.tokenIn, amount: body.amountIn, decimals: 18 },
        output: { token: body.tokenOut, amount: String(amount), minimumAmount: last.min, decimals: 18 }, spender: LCX.router,
        venues: ['pancake-v3'], routes: [], expiresAt: 1, stale: false, ...quote };
      return { status: 200, json: async () => ({ success: true, data: { quote: q } }) };
    }
    const value = last.body.tokenIn === ZERO ? last.body.amountIn : '0';
    const { fn = 'swapSplit', maker, ...fields } = call;
    const data = calldata(fn, { tokenIn: last.body.tokenIn, tokenOut: last.body.tokenOut, totalIn: BigInt(last.body.amountIn), minAmountOut: BigInt(last.min), recipient: body.recipient, deadline: soon(), ...fields }, maker);
    return { status: 200, json: async () => ({ success: true, data: { swap: { chainId: 56, to: LCX.router, data, value, ...swap },
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
  assert.deepEqual({ ...tx, data: tx.data.slice(0, 10) }, { to: LCX.router, value: 100n, data: SELECTORS.swapSplit, floor: 4250n });
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
  // Quoted again at the trade's slippage, its floor fell below what that slippage allows on the price it was chosen on.
  await bad({ amounts: [5000, 4999] }, /lower minimum than this slippage allows/);
  const { lcx } = client({ amounts: [5000, 5100] }); // a higher floor is fine
  assert.equal((await lcx.build(await lcx.route(null, COIN, 100n), 1000, ME)).floor, 4590n);
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

test('LCX Liberty DEX calldata: every router function decodes, market-maker routes included', async () => {
  for (const fn of Object.keys(SELECTORS)) {
    for (const sell of [false, true]) {
      const { lcx } = client({ call: { fn } });
      const r = await lcx.route(sell ? COIN : null, sell ? null : COIN, 100n);
      const tx = await lcx.build(r, 1000, ME);
      assert.equal(tx.data.slice(0, 10), SELECTORS[fn], fn);
      assert.equal(tx.floor, 4500n, fn);
    }
  }
  // A higher minimum in the calldata than in the quote is fine, and is what the floor reports.
  const { lcx } = client({ call: { fn: 'swapSplitWithPropAMMSplit', minAmountOut: 4600n } });
  assert.equal((await lcx.build(await lcx.route(null, COIN, 100n), 1000, ME)).floor, 4600n);
});

test('LCX Liberty DEX calldata: anything but this swap, for this wallet, with this minimum, is refused', async () => {
  const OTHER = '0x00000000000000000000000000000000000000ee';
  const bad = async (call, re, extra = {}) => {
    for (const fn of ['swapSplit', 'swapSplitWithPropAMMSplit']) {
      const { lcx } = client({ ...extra, call: { fn, ...call } });
      await assert.rejects((async () => lcx.build(await lcx.route(null, COIN, 100n), 1000, ME))(), re, `${fn} ${JSON.stringify(call, (_, v) => typeof v === 'bigint' ? String(v) : v)}`);
    }
  };
  await bad({ recipient: OTHER }, /pays another address/);
  await bad({ minAmountOut: 4499n }, /lower minimum/);
  await bad({ totalIn: 99n }, /different swap/);
  await bad({ tokenIn: COIN, tokenOut: ZERO }, /different swap/);
  await bad({ deadline: BigInt(Math.floor(Date.now() / 1000) - 1) }, /deadline has passed/);
  await bad({}, /unexpected amount of BNB/, { swap: { value: '99' } });
  // An unknown function, or one that does not decode.
  const { lcx } = client({ swap: { data: '0x12345678' + '00'.repeat(64) } });
  await assert.rejects((async () => lcx.build(await lcx.route(null, COIN, 100n), 1000, ME))(), /unknown router function/);
  const want = { tokenIn: ZERO, tokenOut: COIN, amountIn: 100n, floor: 4500n, recipient: ME };
  const ok = calldata('swapSplit', { tokenIn: ZERO, tokenOut: COIN, totalIn: 100n, minAmountOut: 4500n, recipient: ME, deadline: soon() });
  assert.equal(checkCall(ok, want), 4500n);
  assert.throws(() => checkCall(ok.slice(0, 200), want), /does not decode/);
  // An array length the data can't hold (300M legs) is refused, not allocated.
  assert.equal(ok.slice(458, 522), '1'.padStart(64, '0')); // the legs' length word
  assert.throws(() => checkCall(ok.slice(0, 458) + (300_000_000).toString(16).padStart(64, '0') + ok.slice(522), want), /does not decode/);
  // makerSwap may trade only through Bebop, and not more than is sold.
  const maker = (m, f = {}) => checkCall(calldata('makerSwap', { tokenIn: ZERO, tokenOut: COIN, totalIn: 100n, minAmountOut: 4500n, recipient: ME, deadline: soon(), ...f }, m), want);
  assert.equal(maker(BEBOP), 4500n);
  assert.equal(maker('0xbeb0009aca35087ce7ccf11637e24dd1aad3bf2a'), 4500n);
  assert.throws(() => maker(OTHER), /unknown market maker/);
  const { lcx: viaApi } = client({ call: { fn: 'makerSwap', maker: OTHER } });
  await assert.rejects((async () => viaApi.build(await viaApi.route(null, COIN, 100n), 1000, ME))(), /unknown market maker/);
});
