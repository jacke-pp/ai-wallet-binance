// Coins that already graduated into a PancakeSwap V2 BNB pool (their curve limits are gone; any wallet trades them).
// Swapped through that pool, or through KyberSwap when it finds a deeper way (route.mjs).
import { encodeCall, decode, ZERO, same } from '../abi.mjs';
import { simulate, delivered, NATIVE } from '../sim.mjs';
import { bestSwap } from '../route.mjs';

export const PANCAKE = {
  router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
};

export async function pairOf(rpc, token) {
  const p = await rpc.read(PANCAKE.factory, 'getPair(address,address)', [token, PANCAKE.wbnb], ['address']).catch(() => ZERO);
  return same(p, ZERO) ? null : p;
}

export async function detect(ctx, token) {
  const pair = await pairOf(ctx.rpc, token);
  if (!pair) return null;
  const [[r0, r1], t0, tax] = await Promise.all([
    ctx.rpc.read(pair, 'getReserves()', [], ['uint112', 'uint112', 'uint32']),
    ctx.rpc.read(pair, 'token0()', [], ['address']),
    measureTax(ctx, token).catch(() => ({})),
  ]);
  const bnbReserve = same(t0, PANCAKE.wbnb) ? r0 : r1;
  return { platform: 'pancake-v2', phase: 'dex', agentOnly: false, pair, bnbReserve, ...tax };
}

const PROBE = 10n ** 15n; // 0.001 BNB, simulated only
const pct = (got, quoted) => quoted > 0n ? Math.max(0, Number(10000n - (got * 10000n) / quoted) / 100) : null;
const amountsOut = (amount, path) => ({ to: PANCAKE.router, value: 0n, data: encodeCall('getAmountsOut(uint256,address[])', [amount, path]) });

// The coin's real buy and sell tax, measured by simulating a small buy and selling it back from this wallet's address:
// what arrived vs what PancakeSwap quoted without tax. Catches taxes the contract doesn't declare, taxes that differ
// per wallet, and coins that can't be sold (sellFails).
export async function measureTax(ctx, token) {
  const buyPath = [PANCAKE.wbnb, token], sellPath = [token, PANCAKE.wbnb];
  const buyTx = { to: PANCAKE.router, value: PROBE, data: encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [0n, buyPath, ctx.me, deadline()]) };
  const [q, b] = await simulate(ctx.rpc, ctx.me, [amountsOut(PROBE, buyPath), buyTx]);
  if (!b.ok) return { buyTaxPct: null, buyFails: true, taxMeasured: true };
  const quotedIn = decode(['uint256[]'], q.returnData)[0].at(-1);
  const got = delivered([b], token, ctx.me);
  if (got <= 0n) return { buyTaxPct: 100, taxMeasured: true };
  const res = await simulate(ctx.rpc, ctx.me, [buyTx,
    { to: token, value: 0n, data: encodeCall('approve(address,uint256)', [PANCAKE.router, got]) },
    amountsOut(got, sellPath),
    { to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [got, 0n, sellPath, ctx.me, deadline()]) }]);
  const out = { buyTaxPct: pct(got, quotedIn), taxMeasured: true };
  if (!res[1].ok || !res[3].ok) return { ...out, sellTaxPct: null, sellFails: true };
  const quotedOut = decode(['uint256[]'], res[2].returnData)[0].at(-1);
  return { ...out, sellTaxPct: pct(delivered([res[3]], NATIVE, ctx.me), quotedOut) };
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 120);

// The V2 BNB pool, or KyberSwap when it pays more (route.mjs).
export async function buy(ctx, info, bnbIn) {
  const r = await bestSwap(ctx, { tokenOut: info.token, amountIn: bnbIn, v2Paths: [{ path: [PANCAKE.wbnb, info.token], name: 'PancakeSwap V2' }], taxPct: info.buyTaxPct });
  return { expectedOut: r.expectedOut, minOut: r.minOut, via: r.via, swapLegs: [r.leg], warnings: r.notes, steps: [{ label: 'buy', tx: r.tx }] };
}

export async function sell(ctx, info, amount) {
  const r = await bestSwap(ctx, { tokenIn: info.token, amountIn: amount, v2Paths: [{ path: [info.token, PANCAKE.wbnb], name: 'PancakeSwap V2' }], taxPct: info.sellTaxPct });
  return { expectedOut: r.expectedOut, minOut: r.minOut, via: r.via, swapLegs: [r.leg], warnings: r.notes, approve: { token: info.token, spender: r.spender, amount },
    steps: [{ label: 'sell', tx: r.tx }] };
}
