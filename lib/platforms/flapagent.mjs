// Flap "ID Agent Curve" (flap.sh/apps/agent-bonding-curve, live since 2026-10-23). Researched on chain 2026-10-25.
// - Each coin starts as a market contract holding a virtual curve of non-transferable shares; the real Flap coin
//   (a ...7777 address, known in advance as predictedToken) is only created when the market's cap fills (5 BNB for BNB
//   markets). Then holders claim their coins, which keep trading on Flap's normal curve and later PancakeSwap.
// - Every trade goes through the app portal, which checks that the direct caller (msg.sender) holds a Binance Agent
//   ID: the AI wallet must call the portal itself; routers or bundling contracts are refused ("Agent ID required").
//   Selling on the curve is allowed on chain (and the Agent ID check applies to sells too).
// - Fees: 1% agent fee on buys and sells; 3% of each buy is a launch reserve paid back on sell. One wallet may hold at
//   most maxSharesPerWallet (2% of supply); a buy past it reverts, so buys are shrunk to fit.
// - Markets priced in another coin (BNCB, ...) take that coin: BNB is swapped on PancakeSwap first, the coin is
//   approved to the market (not the portal), and a sale pays that coin back, which is swapped back to BNB.
import { encodeCall, ZERO, same, isAddress } from '../abi.mjs';
import { PANCAKE, pairOf } from './pancake.mjs';
import { simulate, delivered } from '../sim.mjs';
import { FLAP_AGENT, flapAgent } from '../agentpads.mjs';

export { FLAP_AGENT };
const PHASE_OPEN = FLAP_AGENT.phaseOpen;

export async function card(rpc, market) {
  return flapAgent.parse.cards(await rpc.call(flapAgent.reads.cards([market])))[0];
}

// Accepts the market address or the coin's (predicted) address.
export async function marketOf(rpc, addr) {
  const [m, is] = await Promise.all([rpc.call(flapAgent.reads.marketOfToken(addr)).catch(() => '0x'), rpc.call(flapAgent.reads.isMarket(addr)).catch(() => '0x')]);
  return flapAgent.marketFrom(addr, m, is);
}

export async function detect(ctx, addr) {
  const market = await marketOf(ctx.rpc, addr);
  if (!market) return null;
  const c = await card(ctx.rpc, market);
  if (c.phase !== PHASE_OPEN) {
    // Launched: the real coin trades on Flap / PancakeSwap. Shares not yet claimed must be claimed first.
    return { platform: 'flap-agent', phase: 'launched', agentOnly: false, market, launchedToken: isAddress(c.token) && !same(c.token, ZERO) ? c.token : null, name: c.name, symbol: c.symbol, notTradable: true };
  }
  return { platform: 'flap-agent', phase: 'curve', agentOnly: true, market, quote: c.quote, name: c.name, symbol: c.symbol, predictedToken: c.predictedToken,
    progress: c.progress, buyTaxPct: 1, sellTaxPct: 1, decimals: 18, unit: 'shares' };
}

// Shares this wallet holds in the market (they are not an ERC20 token).
export const held = (ctx, info) => ctx.rpc.read(info.market, 'sharesOf(address)', [ctx.me], ['uint256']);

const quoteBuy = (ctx, market, gross) => ctx.rpc.read(FLAP_AGENT.portal, 'quoteBuy(address,address,uint256)', [market, ctx.me, gross], ['uint256', 'uint256', 'uint256', 'uint256']);

// Largest gross amount whose shares still fit under the per-wallet cap (quoteBuy itself ignores the cap).
async function fitCap(ctx, info, gross) {
  const [cap, have] = await Promise.all([ctx.rpc.read(info.market, 'maxSharesPerWallet()', [], ['uint256']), held(ctx, info)]);
  const room = (cap * 995n) / 1000n - have;
  if (room <= 0n) throw new Error('This wallet already holds the most one wallet may hold of this coin (2% of supply).');
  let q = await quoteBuy(ctx, info.market, gross);
  if (q[3] <= room) return { gross, q, capped: false };
  let lo = 0n, hi = gross;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2n;
    const qm = await quoteBuy(ctx, info.market, mid);
    if (qm[3] <= room) { lo = mid; q = qm; } else hi = mid;
  }
  if (lo <= 0n) throw new Error('Nothing fits under the per-wallet cap.');
  return { gross: lo, q, capped: true };
}

const v2Out = async (ctx, amount, path) => (await ctx.rpc.read(PANCAKE.router, 'getAmountsOut(uint256,address[])', [amount, path], ['uint256[]'])).at(-1);
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 120);
const min = (x, ctx) => (x * (10000n - ctx.slippageBps)) / 10000n;

export async function buy(ctx, info, bnbIn) {
  if (info.notTradable) throw new Error(info.launchedToken ? `This agent coin already launched. Claim with: aiwb claim ${info.market}, then trade ${info.launchedToken}.` : 'This agent market is not open.');
  if (same(info.quote, ZERO)) {
    const { gross, q, capped } = await fitCap(ctx, info, bnbIn);
    const minShares = min(q[3], ctx);
    return {
      expectedOut: q[3], minOut: minShares, spend: gross, via: 'Flap ID Agent Curve',
      warnings: [...(capped ? [`Reduced to ${gross} wei: one wallet may hold at most 2% of this coin.`] : []), 'You get curve shares now; the coin itself arrives after the market fills and you claim it.'],
      steps: [{ label: 'buy', tx: flapAgent.tx.buy(info.market, gross, minShares) }],
    };
  }
  // Priced in another coin: BNB -> that coin on PancakeSwap V2, approve it to the market, buy with it.
  if (!(await pairOf(ctx.rpc, info.quote))) throw new Error('This agent market is priced in a coin with no PancakeSwap V2 BNB pool. Not supported yet.');
  const path = [PANCAKE.wbnb, info.quote];
  const quoteIn = await v2Out(ctx, bnbIn, path);
  const { q } = await fitCap(ctx, info, quoteIn);
  return {
    expectedOut: q[3], minOut: min(q[3], ctx), via: 'PancakeSwap (BNB to quote coin) + Flap ID Agent Curve, 3 transactions', v2Legs: [{ amountIn: bnbIn, path }],
    warnings: ['This market is priced in another coin: 3 transactions (swap, approve, buy). A sale pays that coin back and swaps it to BNB.'],
    steps: [
      { label: 'swap BNB to quote coin', tx: { to: PANCAKE.router, value: bnbIn, data: encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [min(quoteIn, ctx), path, ctx.me, deadline()]) } },
      { label: 'approval', async build(st) {
        const bal = await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256'], { block: BigInt(st.last.blockNumber) });
        st.quoteAmt = bal;
        return flapAgent.tx.approveQuote(info.quote, info.market, bal);
      } },
      { label: 'buy', async build(st) {
        const fit = await fitCap(ctx, info, st.quoteAmt);
        return flapAgent.tx.buyWithQuote(info.market, fit.gross, min(fit.q[3], ctx));
      } },
    ],
  };
}

export async function sell(ctx, info, shares) {
  if (info.notTradable) throw new Error(info.launchedToken ? `This agent coin already launched. Claim with: aiwb claim ${info.market}, then sell ${info.launchedToken}.` : 'This agent market is not open.');
  const have = await held(ctx, info);
  if (have <= 0n) throw new Error('This wallet holds no shares of this agent coin.');
  const bps = flapAgent.sellBps(shares, have);
  // Selling part of a position gets at least that share of the sell-everything quote (the curve is convex).
  const [, , , outAll] = await ctx.rpc.read(FLAP_AGENT.portal, 'quoteSellAll(address,address)', [info.market, ctx.me], ['uint256', 'uint256', 'uint256', 'uint256']);
  const out = (outAll * bps) / 10000n;
  const sellStep = { label: 'sell', tx: flapAgent.tx.sellBps(info.market, bps, min(out, ctx)) };
  if (same(info.quote, ZERO)) return { expectedOut: out, minOut: min(out, ctx), via: 'Flap ID Agent Curve', steps: [sellStep] };
  const path = [info.quote, PANCAKE.wbnb];
  const bnbOut = await v2Out(ctx, out, path).catch(() => 0n);
  let before = 0n;
  return {
    expectedOut: bnbOut, minOut: min(bnbOut, ctx), via: 'Flap ID Agent Curve + PancakeSwap (quote coin to BNB), up to 3 transactions', v2Legs: [{ amountIn: out, path }],
    steps: [
      { label: 'sell', async build() { before = await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256']); return sellStep.tx; } },
      { label: 'approval', async build(st) {
        const got = (await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256'], { block: BigInt(st.last.blockNumber) })) - before;
        st.quoteBack = got;
        const allowance = await ctx.rpc.read(info.quote, 'allowance(address,address)', [ctx.me, PANCAKE.router], ['uint256']);
        return allowance >= got ? null : { to: info.quote, value: 0n, data: encodeCall('approve(address,uint256)', [PANCAKE.router, got]) };
      } },
      { label: 'swap quote coin to BNB', async build(st) {
        const exp = await v2Out(ctx, st.quoteBack, path);
        return { to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [st.quoteBack, min(exp, ctx), path, ctx.me, deadline()]) };
      } },
    ],
  };
}

// Safety check: buy then sell everything back, no minimums; the check measures the BNB returned.
// Markets priced in another coin add the swaps around it (`buys` = calls that make up the buy). Amounts are worked out
// on one block with 0.5% held back at each hand-over, as the quote coin's price moves a little before the check runs.
export async function roundTripCalls(ctx, info, bnbIn) {
  if (info.notTradable) return null;
  const sellAll = { to: FLAP_AGENT.portal, value: 0n, data: encodeCall('sellBps(address,uint256,uint256)', [info.market, 10000n, 0n]) };
  if (same(info.quote, ZERO)) return [{ to: FLAP_AGENT.portal, value: bnbIn, data: encodeCall('buy(address,uint256)', [info.market, 0n]) }, sellAll];
  const block = await ctx.rpc.blockNumber();
  const keep = x => (x * 995n) / 1000n;
  const swapIn = { to: PANCAKE.router, value: bnbIn, data: encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [0n, [PANCAKE.wbnb, info.quote], ctx.me, deadline()]) };
  const [q] = await simulate(ctx.rpc, ctx.me, [swapIn], { block });
  const quoteAmt = q.ok ? keep(delivered([q], info.quote, ctx.me)) : 0n;
  const buyCalls = [swapIn, { to: info.quote, value: 0n, data: encodeCall('approve(address,uint256)', [info.market, quoteAmt]) },
    { to: FLAP_AGENT.portal, value: 0n, data: encodeCall('buyWithQuote(address,uint256,uint256)', [info.market, quoteAmt, 0n]) }];
  if (!quoteAmt) return { calls: buyCalls, buys: 3 };
  const res = await simulate(ctx.rpc, ctx.me, [...buyCalls, sellAll], { block });
  const back = res[3].ok ? keep(delivered([res[3]], info.quote, ctx.me)) : 0n;
  if (!back) return { calls: [...buyCalls, sellAll], buys: 3 };
  return { calls: [...buyCalls, sellAll, { to: info.quote, value: 0n, data: encodeCall('approve(address,uint256)', [PANCAKE.router, back]) },
    { to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [back, 0n, [info.quote, PANCAKE.wbnb], ctx.me, deadline()]) }], buys: 3 };
}

// After launch: claim the coins this wallet's shares turned into.
export const claimTx = flapAgent.tx.claim;

// New markets for snipes: MarketCreated(creator, market, predictedToken, pair, configHash) from the factory.
export const watch = {
  address: FLAP_AGENT.factory,
  topics: FLAP_AGENT.created.topics,
  async parse(log, rpc) {
    const { market, creator, predictedToken: predicted } = flapAgent.parse.created(log);
    const c = await card(rpc, market).catch(() => null);
    return { token: market, market, predictedToken: predicted, creator, name: c?.name, symbol: c?.symbol };
  },
};
