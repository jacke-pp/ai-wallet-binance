// Swaps between BNB and a coin, priced two ways and made the way that pays more:
// - PancakeSwap V2 along the paths the platform gives (getAmountsOut on chain);
// - KyberSwap's aggregator (kyber.mjs), which also reaches PancakeSwap V3 / Infinity and other DEX pools. Many coins,
//   and coins that curves are priced in (BNCB, NVDAB, ...), keep most of their money there with only a thin V2 BNB pool
//   beside it. 2026-10-26, 0.5 BNB: 67.98 BNCB through Kyber vs 65.69 on V2; 0.3716 oANTHROPIC vs 0.00047.
// Kyber is taken only when it pays at least 0.5% more than V2 (or V2 has no pool), and only after three checks; each
// one failing drops Kyber and V2 is used (then the thin-pool limit in depth.mjs still applies):
// - trap: 0.01 BNB bought and sold back through Kyber gets back at least half. Pools with a huge fee are set up to
//   catch aggregator sales (one took ~80% of a sale on 2026-10-15);
// - the transaction Kyber builds goes to Kyber's router and sends exactly the BNB being swapped (kyber.mjs);
// - simulated from this wallet, it delivers at least the minimum to this wallet.
import { encodeCall, same } from './abi.mjs';
import { simulate, delivered, NATIVE } from './sim.mjs';
import { PANCAKE } from './platforms/pancake.mjs';
import { KYBER } from './kyber.mjs';

export const KYBER_EDGE_BPS = 50n; // Kyber must pay this much more than V2 to be used
const PROBE = 10n ** 16n; // 0.01 BNB, quoted only
const TRAP_MIN_BPS = 5000n;
const PROBE_MS = 60_000;
const probes = new Map();
export const probeReset = () => probes.clear();

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 120);
const min = (x, ctx) => (x * (10000n - ctx.slippageBps)) / 10000n;
const afterTax = (x, taxPct) => taxPct ? (x * BigInt(Math.round((100 - taxPct) * 100))) / 10000n : x;
const v2Out = async (rpc, amount, path) => (await rpc.read(PANCAKE.router, 'getAmountsOut(uint256,address[])', [amount, path], ['uint256[]'])).at(-1);
export const approveTx = (token, spender, amount) => ({ to: token, value: 0n, data: encodeCall('approve(address,uint256)', [spender, amount]) });

// A V2 swap along `path` (BNB in when it starts with WBNB, BNB out when it ends with it).
export const v2Tx = (ctx, path, amountIn, minOut) => same(path[0], PANCAKE.wbnb)
  ? { to: PANCAKE.router, value: amountIn, data: encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [minOut, path, ctx.me, deadline()]) }
  : { to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [amountIn, minOut, path, ctx.me, deadline()]) };

// 0.01 BNB -> coin -> BNB through Kyber, kept a minute per coin. True when the round trip gets back at least half, or
// when it can't be quoted (the simulation still has to pass).
function trapFree(ctx, coin) {
  const id = coin.toLowerCase();
  const hit = probes.get(id);
  if (hit && Date.now() - hit.at < PROBE_MS) return hit.p;
  const p = ctx.kyber.route(null, coin, PROBE)
    .then(a => ctx.kyber.route(coin, null, a.amountOut))
    .then(b => b.amountOut * 10000n >= PROBE * TRAP_MIN_BPS, () => { probes.delete(id); return true; });
  probes.set(id, { at: Date.now(), p });
  return p;
}

// Build Kyber's transaction and run it in simulation. Returns { tx, minOut, expectedOut } or throws why not.
async function kyberReady(ctx, r, taxPct) {
  const coin = r.tokenIn ?? r.tokenOut;
  if (!(await trapFree(ctx, coin))) throw new Error('a small round trip through its KyberSwap route loses over half (trap pool)');
  const minOut = min(afterTax(r.amountOut, taxPct), ctx);
  const slipBps = Number(((r.amountOut - minOut) * 10000n + r.amountOut - 1n) / r.amountOut);
  const tx = await ctx.kyber.build(r, slipBps, ctx.me);
  const calls = r.tokenIn ? [approveTx(r.tokenIn, KYBER.router, r.amountIn), tx] : [tx];
  const res = await simulate(ctx.rpc, ctx.me, calls);
  const last = res.at(-1);
  if (!last.ok) throw new Error(`its transaction fails in simulation${last.error ? `: ${last.error}` : ''}`);
  const got = delivered([last], r.tokenOut ?? NATIVE, ctx.me);
  if (got < minOut) throw new Error('its transaction delivers less than the minimum in simulation');
  return { tx, minOut, expectedOut: got };
}

// The best way to swap amountIn of tokenIn for tokenOut (null = BNB). v2Paths: [{ path, name }] the platform trades on
// PancakeSwap V2. taxPct: the coin's own tax on this swap. build false: price and pick only (the wallet doesn't hold
// tokenIn yet, so nothing can be simulated); call again with build when it does. only: 'v2' or 'kyber' rebuilds a
// route the same way (its approval is for that router).
// Returns { source, via, expectedOut, minOut, tx, spender, leg, notes }. leg feeds the thin-pool limit (depth.mjs).
export async function bestSwap(ctx, { tokenIn = null, tokenOut = null, amountIn, v2Paths = [], taxPct = 0, build = true, only = null }) {
  const jobs = (only === 'kyber' ? [] : v2Paths).map(p => v2Out(ctx.rpc, amountIn, p.path).then(out => ({ source: 'v2', via: p.name, path: p.path, amountOut: out })));
  const useKyber = !!ctx.kyber && amountIn > 0n && only !== 'v2';
  if (useKyber) jobs.push(ctx.kyber.route(tokenIn, tokenOut, amountIn).then(r => ({ source: 'kyber', via: `KyberSwap (${r.venues.join(', ') || 'aggregator'})`, ...r })));
  const ok = (await Promise.allSettled(jobs)).filter(x => x.status === 'fulfilled' && x.value.amountOut > 0n).map(x => x.value);
  const v2 = ok.filter(x => x.source === 'v2').sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0];
  const k = ok.find(x => x.source === 'kyber');
  const notes = [];
  if (k && (!v2 || k.amountOut * 10000n >= v2.amountOut * (10000n + KYBER_EDGE_BPS))) {
    const coin = tokenIn ?? tokenOut;
    const leg = { amountIn, coin, via: k.via, quote: a => ctx.kyber.route(tokenIn, tokenOut, a).then(x => x.amountOut) };
    const expectedOut = afterTax(k.amountOut, taxPct);
    if (!build || ctx.noWallet) return { source: 'kyber', via: k.via, expectedOut, minOut: min(expectedOut, ctx), spender: KYBER.router, leg, notes, route: k };
    try {
      const ready = await kyberReady(ctx, k, taxPct);
      return { source: 'kyber', via: k.via, ...ready, spender: KYBER.router, leg, notes, route: k };
    } catch (e) {
      notes.push(`KyberSwap's route was not used: ${e.message}.`);
    }
  } else if (useKyber && !k && !ok.length) notes.push('KyberSwap found no route either.');
  if (!v2) throw new Error(`No way to swap ${tokenIn ? 'this coin for BNB' : 'BNB for this coin'} right now (no PancakeSwap V2 pool${useKyber ? ', and KyberSwap has no usable route' : ''}).${notes.length ? ' ' + notes.join(' ') : ''} Nothing was sent.`);
  const expectedOut = afterTax(v2.amountOut, taxPct);
  const minOut = min(expectedOut, ctx);
  return { source: 'v2', via: v2.via, expectedOut, minOut, tx: v2Tx(ctx, v2.path, amountIn, minOut), spender: PANCAKE.router, leg: { amountIn, path: v2.path }, notes };
}

// BNB -> a coin a curve is priced in (BNCB, NVDAB, ...) and back: its V2 BNB pool, or KyberSwap when it pays more.
export const toCoin = (ctx, coin, bnb, opts = {}) => bestSwap(ctx, { tokenOut: coin, amountIn: bnb, v2Paths: [{ path: [PANCAKE.wbnb, coin], name: 'PancakeSwap V2' }], ...opts });
export const toBnb = (ctx, coin, amount, opts = {}) => bestSwap(ctx, { tokenIn: coin, amountIn: amount, v2Paths: [{ path: [coin, PANCAKE.wbnb], name: 'PancakeSwap V2' }], ...opts });

// The steps that swap what a sale paid in such a coin (state.quoteBack, set by the step before) back to BNB: priced
// and built once it arrived, approval only if needed. A route built over 90 s before its swap goes out (an App
// confirmation in between) is built again the same way.
export function toBnbSteps(ctx, coin, symbol) {
  return [
    { label: 'approval', async build(st) {
      st.swap = { ...(await toBnb(ctx, coin, st.quoteBack)), at: Date.now() };
      const allowance = await ctx.rpc.read(coin, 'allowance(address,address)', [ctx.me, st.swap.spender], ['uint256']);
      return allowance >= st.quoteBack ? null : approveTx(coin, st.swap.spender, st.quoteBack);
    } },
    { label: `swap ${symbol} to BNB`, async build(st) {
      if (Date.now() - st.swap.at > 90_000) st.swap = await toBnb(ctx, coin, st.quoteBack, { only: st.swap.source });
      return st.swap.tx;
    } },
  ];
}
