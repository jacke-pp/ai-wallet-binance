// Four.meme "Binance Agent ID Exclusive" coins (public since 2026-10-25 06:00 UTC). Researched on chain 2026-10-25.
// - They live on a newer Four contract (not the classic TokenManager2) as template 1778027615735. While the coin is on
//   its curve only callers holding a Binance Agent ID may buy (checked on msg.sender, so the AI wallet must call it
//   itself), one wallet may hold at most 1% (10M coins; a bigger buy is cut short and the rest refunded), and coins
//   cannot be transferred. Selling on the curve is allowed and needs no Agent ID.
// - The buyer pays on top: 1% platform fee + the creator's tax (0-10%, buyFeeRate) + an optional opening fee that falls
//   block by block for the first 5 blocks after creation (49, 24, 14, 9, 4%).
// - At 13.4 BNB raised the coin moves to a PancakeSwap V2 pool (tokenPhase 3); from then on the PancakeSwap handler
//   trades it and anyone may hold it.
// - There is no quote function, so buys and sells are priced by simulating them on the live chain (eth_simulateV1).
import { encodeCall } from '../abi.mjs';
import { simulate, delivered, NATIVE } from '../sim.mjs';
import { FOUR_AGENT, four } from '../agentpads.mjs';

export { FOUR_AGENT };
const MAX_PER_WALLET = FOUR_AGENT.maxPerWallet;
const PHASE_CURVE = FOUR_AGENT.phase.curve, PHASE_POOL = FOUR_AGENT.phase.pool;

export async function record(rpc, token) {
  return four.parse.record(await rpc.call(four.reads.record(token)).catch(() => '0x'));
}

export const openingFeePct = four.openingFeePct;

export async function detect(ctx, token) {
  const rec = await record(ctx.rpc, token);
  if (!rec || rec.template !== FOUR_AGENT.template) return null;
  const phase = await ctx.rpc.read(token, 'tokenPhase()', [], ['uint256']);
  if (phase === PHASE_POOL) return null; // graduated: PancakeSwap handler
  if (phase !== PHASE_CURVE) return { platform: 'four-agent', phase: 'graduating', agentOnly: true, notTradable: true };
  const [buyFee, sellFee, block, allowed] = await Promise.all([
    ctx.rpc.read(token, 'buyFeeRate()', [], ['uint256']),
    ctx.rpc.read(token, 'sellFeeRate()', [], ['uint256']),
    ctx.rpc.blockNumber(),
    ctx.rpc.call(four.reads.allowed(ctx.me)).then(four.parse.allowed).catch(() => true),
  ]);
  return {
    platform: 'four-agent', phase: 'curve', agentOnly: true, creator: rec.creator, ...four.taxes(rec, block, buyFee, sellFee),
    ...(allowed ? {} : { notTradable: true, reason: 'Four has switched on a whitelist for agent coins and this wallet is not on it.' }),
  };
}

const buyData = (token, funds, minTokens) => four.tx.buy(token, funds, minTokens).data;
const sellData = (token, amount, minFunds) => four.tx.sell(token, amount, minFunds).data;
const min = (x, ctx) => (x * (10000n - ctx.slippageBps)) / 10000n;
const balanceOf = (ctx, token) => ctx.rpc.read(token, 'balanceOf(address)', [ctx.me], ['uint256']);

export async function buy(ctx, info, bnbIn) {
  if (info.notTradable) throw new Error(info.reason || 'This Four agent coin is moving to PancakeSwap right now. Try again in a few seconds.');
  const have = await balanceOf(ctx, info.token);
  if (have >= MAX_PER_WALLET) throw new Error('This wallet already holds 1% of this coin, the most one wallet may hold before it graduates.');
  const [r] = await simulate(ctx.rpc, ctx.me, [{ to: FOUR_AGENT.core, value: bnbIn, data: buyData(info.token, bnbIn, 0n) }]);
  if (!r.ok) throw new Error(`Four refuses this buy right now${r.error ? `: ${r.error}` : ''}.`);
  const out = delivered([r], info.token, ctx.me);
  const refund = delivered([r], NATIVE, ctx.me);
  const warnings = [];
  const capped = refund * 100n > bnbIn; // more than 1% back: the 1% holding cap cut the buy short (dust is rounding)
  if (capped) warnings.push(`Only ${bnbIn - refund} wei is used and the rest comes back: one wallet may hold at most 1% of this coin.`);
  if (info.openingFeePct) warnings.push(`Opening fee right now: ${info.openingFeePct}% on top (falls to 0 within 6 blocks of launch).`);
  return {
    expectedOut: out, minOut: min(out, ctx), via: 'Four.meme agent curve', warnings, ...(capped ? { spend: bnbIn - refund } : {}),
    steps: [{ label: 'buy', tx: { to: FOUR_AGENT.core, value: bnbIn, data: buyData(info.token, bnbIn, min(out, ctx)) } }],
  };
}

export async function sell(ctx, info, amount) {
  if (info.notTradable && info.phase === 'graduating') throw new Error('This Four agent coin is moving to PancakeSwap right now. Try again in a few seconds.');
  const approve = { to: info.token, value: 0n, data: encodeCall('approve(address,uint256)', [FOUR_AGENT.core, amount]) };
  const res = await simulate(ctx.rpc, ctx.me, [approve, { to: FOUR_AGENT.core, value: 0n, data: sellData(info.token, amount, 0n) }]);
  if (!res[1].ok) throw new Error(`Four refuses this sell right now${res[1].error ? `: ${res[1].error}` : ''}.`);
  const out = delivered([res[1]], NATIVE, ctx.me);
  return {
    expectedOut: out, minOut: min(out, ctx), via: 'Four.meme agent curve', approve: { token: info.token, spender: FOUR_AGENT.core, amount },
    steps: [{ label: 'sell', tx: { to: FOUR_AGENT.core, value: 0n, data: sellData(info.token, amount, min(out, ctx)) } }],
  };
}

// Safety check: buy, then sell exactly what the buy delivered, no minimums.
export async function roundTripCalls(ctx, info, bnbIn) {
  if (info.notTradable) return null;
  const buyTx = { to: FOUR_AGENT.core, value: bnbIn, data: buyData(info.token, bnbIn, 0n) };
  const [r] = await simulate(ctx.rpc, ctx.me, [buyTx]);
  const got = r.ok ? delivered([r], info.token, ctx.me) : 0n;
  if (!got) return [buyTx];
  return [buyTx,
    { to: info.token, value: 0n, data: encodeCall('approve(address,uint256)', [FOUR_AGENT.core, got]) },
    { to: FOUR_AGENT.core, value: 0n, data: sellData(info.token, got, 0n) }];
}

// New agent coins for snipes: FourCore's creation event, filtered to the agent template.
export const watch = {
  address: FOUR_AGENT.core,
  topics: FOUR_AGENT.created.topics,
  async parse(log, rpc) {
    const { token, creator } = four.parse.created(log);
    const [name, symbol] = await Promise.all([rpc.read(token, 'name()', [], ['string']).catch(() => ''), rpc.read(token, 'symbol()', [], ['string']).catch(() => '')]);
    return { token, creator, name, symbol };
  },
};
