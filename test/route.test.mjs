import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bestSwap, toBnbSteps, probeReset, KYBER_EDGE_BPS } from '../lib/route.mjs';
import { createKyber, KYBER } from '../lib/kyber.mjs';
import { PANCAKE } from '../lib/platforms/pancake.mjs';

beforeEach(() => probeReset());

const E = 10n ** 18n;
const ME = '0x00000000000000000000000000000000000000aa';
const COIN = '0x00000000000000000000000000000000000000c0';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const topic = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0');

// v2: what V2 pays for anything (null = no pool). sim: what the simulated swap delivers to ME (null = it reverts).
function fakeRpc(o) {
  const sims = [];
  return {
    sims, o,
    read: async (to, sig, args) => {
      if (sig.startsWith('getAmountsOut')) { if (o.v2 == null) throw new Error('no pair'); return [args[0], o.v2]; }
      if (sig.startsWith('allowance')) return 0n;
      throw new Error('unexpected ' + sig);
    },
    send: async (method, [req]) => {
      assert.equal(method, 'eth_simulateV1');
      const calls = req.blockStateCalls[0].calls;
      sims.push(calls);
      return [{ calls: calls.map((c, i) => {
        if (i < calls.length - 1) return { status: '0x1', logs: [] };
        if (o.sim == null) return { status: '0x0', logs: [], error: { message: 'execution reverted' } };
        const token = BigInt(c.value) > 0n ? COIN : NATIVE;
        return { status: '0x1', logs: [{ address: token, topics: [TRANSFER, topic(KYBER.router), topic(ME)], data: '0x' + o.sim.toString(16) }] };
      }) }];
    },
  };
}

// out: what Kyber quotes for the trade; back: what the 0.01 BNB probe gets back after a round trip.
function fakeKyber({ out, back = 10n ** 16n, fail = false, buildErr = null }) {
  const calls = [];
  const self = {
    calls, out,
    async route(tokenIn, tokenOut, amountIn) {
      calls.push(['route', tokenIn, tokenOut, amountIn]);
      if (fail) throw new Error('KyberSwap did not answer (timed out)');
      const probeSell = tokenIn && amountIn === 777n;
      const probeBuy = !tokenIn && amountIn === 10n ** 16n;
      const amountOut = probeBuy ? 777n : probeSell ? back : self.out;
      return { tokenIn, tokenOut, amountIn, amountOut, summary: {}, venues: ['pancake-v3'] };
    },
    async build(r, slip, me) {
      calls.push(['build', slip, me]);
      if (buildErr) throw new Error(buildErr);
      return { to: KYBER.router, value: r.tokenIn == null ? r.amountIn : 0n, data: '0x12345678' };
    },
  };
  return self;
}

const ctxOf = (rpc, kyber) => ({ rpc, kyber, me: ME, slippageBps: 1000n });
const buyArgs = { tokenOut: COIN, amountIn: E, v2Paths: [{ path: [PANCAKE.wbnb, COIN], name: 'PancakeSwap V2' }] };

test('KyberSwap is used when it pays at least 0.5% more, after a trap probe and a simulation; otherwise V2', async () => {
  let rpc = fakeRpc({ v2: 1000n * E, sim: 1100n * E }), k = fakeKyber({ out: 1100n * E });
  const r = await bestSwap(ctxOf(rpc, k), buyArgs);
  assert.equal(r.source, 'kyber');
  assert.equal(r.spender, KYBER.router);
  assert.equal(r.tx.to, KYBER.router);
  assert.equal(r.expectedOut, 1100n * E); // what the simulation delivered
  assert.equal(r.minOut, 990n * E);
  assert.deepEqual(k.calls.find(c => c[0] === 'build'), ['build', 1000, ME]);
  assert.equal(rpc.sims.length, 1);
  assert.ok(typeof r.leg.quote === 'function' && r.leg.coin === COIN);
  // Within the edge: V2 stays.
  const edge = (1000n * E * (10000n + KYBER_EDGE_BPS)) / 10000n - 1n;
  rpc = fakeRpc({ v2: 1000n * E, sim: edge }); k = fakeKyber({ out: edge });
  const v = await bestSwap(ctxOf(rpc, k), buyArgs);
  assert.equal(v.source, 'v2');
  assert.equal(v.tx.to, PANCAKE.router);
  assert.deepEqual(v.leg.path, [PANCAKE.wbnb, COIN]);
  assert.equal(rpc.sims.length, 0);
});

test('a trap route, a failing simulation or a short delivery drops KyberSwap and V2 is used', async () => {
  // Round trip of the 0.01 BNB probe gets back 40%.
  let r = await bestSwap(ctxOf(fakeRpc({ v2: 10n * E, sim: 900n * E }), fakeKyber({ out: 900n * E, back: 4n * 10n ** 15n })), buyArgs);
  assert.equal(r.source, 'v2');
  assert.match(r.notes[0], /trap pool/);
  probeReset(); // the probe is kept a minute per coin
  // The swap reverts in simulation.
  r = await bestSwap(ctxOf(fakeRpc({ v2: 10n * E, sim: null }), fakeKyber({ out: 900n * E })), buyArgs);
  assert.equal(r.source, 'v2');
  assert.match(r.notes[0], /fails in simulation/);
  // It delivers less than the minimum (a different recipient, a hidden tax...).
  r = await bestSwap(ctxOf(fakeRpc({ v2: 10n * E, sim: 100n * E }), fakeKyber({ out: 900n * E })), buyArgs);
  assert.equal(r.source, 'v2');
  assert.match(r.notes[0], /less than the minimum/);
  // A bad build.
  r = await bestSwap(ctxOf(fakeRpc({ v2: 10n * E, sim: 900n * E }), fakeKyber({ out: 900n * E, buildErr: 'KyberSwap answered with an unknown router' })), buyArgs);
  assert.equal(r.source, 'v2');
  // No V2 pool and no usable Kyber route: refused.
  await assert.rejects(bestSwap(ctxOf(fakeRpc({ v2: null, sim: null }), fakeKyber({ out: 900n * E })), buyArgs), /No way to swap BNB for this coin.*Nothing was sent/);
  // No V2 pool but a good Kyber route: Kyber.
  r = await bestSwap(ctxOf(fakeRpc({ v2: null, sim: 900n * E }), fakeKyber({ out: 900n * E })), buyArgs);
  assert.equal(r.source, 'kyber');
});

test('KyberSwap down or switched off: V2 as before; sells approve the router that swaps', async () => {
  let r = await bestSwap(ctxOf(fakeRpc({ v2: 10n * E }), fakeKyber({ fail: true })), buyArgs);
  assert.equal(r.source, 'v2');
  r = await bestSwap(ctxOf(fakeRpc({ v2: 10n * E }), null), buyArgs);
  assert.equal(r.source, 'v2');
  // Sell: the simulation approves Kyber's router first, then swaps; BNB arrives.
  const rpc = fakeRpc({ v2: E, sim: 2n * E });
  const s = await bestSwap(ctxOf(rpc, fakeKyber({ out: 2n * E })), { tokenIn: COIN, amountIn: 500n * E, v2Paths: [{ path: [COIN, PANCAKE.wbnb], name: 'PancakeSwap V2' }] });
  assert.equal(s.source, 'kyber');
  assert.equal(rpc.sims[0].length, 2);
  assert.equal(rpc.sims[0][0].to, COIN); // approve(router, amount)
  assert.ok(rpc.sims[0][0].data.includes(KYBER.router.slice(2).toLowerCase()));
  assert.equal(s.expectedOut, 2n * E);
  // Priced only (the coin isn't in the wallet yet): nothing built or simulated.
  const k = fakeKyber({ out: 2n * E }), rpc2 = fakeRpc({ v2: E, sim: 2n * E });
  const p = await bestSwap(ctxOf(rpc2, k), { tokenIn: COIN, amountIn: 500n * E, v2Paths: [{ path: [COIN, PANCAKE.wbnb], name: 'PancakeSwap V2' }], build: false, taxPct: 10 });
  assert.equal(p.source, 'kyber');
  assert.equal(p.expectedOut, (2n * E * 9000n) / 10000n);
  assert.equal(rpc2.sims.length, 0);
  assert.ok(!k.calls.some(c => c[0] === 'build'));
});

test('swapping a sale\'s quote coin back: approval for the chosen router, rebuilt the same way when old', async () => {
  const rpc = fakeRpc({ v2: E, sim: 2n * E }), k = fakeKyber({ out: 2n * E });
  const [approve, swap] = toBnbSteps(ctxOf(rpc, k), COIN, 'BNCB');
  const st = { quoteBack: 500n * E };
  const a = await approve.build(st);
  assert.equal(a.to, COIN);
  assert.ok(a.data.includes(KYBER.router.slice(2).toLowerCase()));
  assert.equal((await swap.build(st)).to, KYBER.router);
  st.swap.at -= 120_000;
  rpc.o.v2 = 50n * E; // V2 now pays more, but only Kyber's router was approved: a stale route is rebuilt on Kyber
  const t = await swap.build(st);
  assert.equal(t.to, KYBER.router);
  assert.equal(st.swap.source, 'kyber');
  // Fresh, the same prices would pick V2 and approve its router.
  const st2 = { quoteBack: 500n * E };
  const a2 = await approve.build(st2);
  assert.ok(a2.data.includes(PANCAKE.router.slice(2).toLowerCase()));
  assert.equal((await swap.build(st2)).to, PANCAKE.router);
});

test('Kyber client: checks the router and the BNB sent, sends the wallet as recipient', async () => {
  const seen = [];
  const answer = (routerAddress, extra = {}) => async (url, init) => {
    seen.push({ url, init });
    if (url.includes('/routes?')) return { json: async () => ({ code: 0, data: { routerAddress, routeSummary: { amountOut: '5000', route: [[{ exchange: 'pancake-v3' }]] } } }) };
    return { json: async () => ({ code: 0, data: { routerAddress, data: '0xdeadbeef00', transactionValue: '100', ...extra } }) };
  };
  let k = createKyber({ fetchImpl: answer(KYBER.router) });
  const r = await k.route(null, COIN, 100n);
  assert.equal(r.amountOut, 5000n);
  assert.deepEqual(r.venues, ['pancake-v3']);
  assert.match(seen[0].url, /tokenIn=0xEeee.*tokenOut=0x0+c0.*amountIn=100/);
  assert.equal(seen[0].init.headers['X-Client-Id'], 'aiwb');
  const tx = await k.build(r, 1500, ME);
  assert.deepEqual(tx, { to: KYBER.router, value: 100n, data: '0xdeadbeef00' });
  const body = JSON.parse(seen[1].init.body);
  assert.equal(body.recipient, ME);
  assert.equal(body.sender, ME);
  assert.equal(body.slippageTolerance, 1500);
  assert.equal(body.ignoreCappedSlippage, false);
  // Wrong router, wrong BNB amount: refused.
  k = createKyber({ fetchImpl: answer('0x0000000000000000000000000000000000000bad') });
  await assert.rejects(k.route(null, COIN, 100n), /unknown router/);
  k = createKyber({ fetchImpl: answer(KYBER.router, { transactionValue: '999' }) });
  await assert.rejects(k.build(r, 100, ME), /unexpected amount of BNB/);
  k = createKyber({ fetchImpl: answer(KYBER.router, { transactionValue: '100', data: '0x' }) });
  await assert.rejects(k.build(r, 100, ME), /empty transaction/);
});
