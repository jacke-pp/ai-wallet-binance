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
import { encodeArgs, encodeCall } from '../abi.mjs';
import { simulate, delivered, NATIVE } from '../sim.mjs';

export const FOUR_AGENT = {
  core: '0xebe7b6c1089d9f72ad07f34e36d898e44e5e27f3',
  whitelist: '0x7b377ad70a20556f4778c4cd878a68a7e7efabbc',
  template: 1778027615735n,
};
const MAX_PER_WALLET = 10_000_000n * 10n ** 18n;
const OPENING_FEE = [null, 49, 24, 14, 9, 4]; // % by blocks since creation; block 0 unknown (never seen)
const PHASE_CURVE = 1n, PHASE_POOL = 3n;

// Raw calls for functions whose names are not published.
const BUY = '0x995ee6da';          // (token, funds, minTokens, 0, bytes)
const WL_ALLOWED = '0x371befa6';   // (templateId, wallet) -> bool
const word = (hex, i) => '0x' + hex.slice(2 + i * 64, 2 + (i + 1) * 64);

export async function record(rpc, token) {
  const raw = await rpc.call({ to: FOUR_AGENT.core, data: encodeCall('tokens(address)', [token]) }).catch(() => '0x');
  if (raw.length < 2 + 20 * 64 || BigInt(word(raw, 0)) !== 1n) return null;
  return {
    creator: '0x' + word(raw, 1).slice(26), template: BigInt(word(raw, 2)), target: BigInt(word(raw, 8)),
    createdBlock: BigInt(word(raw, 16)), openingFee: BigInt(word(raw, 19)) === 1n,
  };
}

export const openingFeePct = (rec, block) => {
  if (!rec.openingFee) return 0;
  const n = Number(block - rec.createdBlock);
  return n >= OPENING_FEE.length ? 0 : (OPENING_FEE[n] ?? 99);
};

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
    ctx.rpc.call({ to: FOUR_AGENT.whitelist, data: WL_ALLOWED + encodeArgs(['uint256', 'address'], [FOUR_AGENT.template, ctx.me]).slice(2) })
      .then(r => BigInt(r) === 1n).catch(() => true),
  ]);
  const opening = openingFeePct(rec, block);
  return {
    platform: 'four-agent', phase: 'curve', agentOnly: true, creator: rec.creator,
    buyTaxPct: 1 + Number(buyFee) / 100 + opening, sellTaxPct: 1 + Number(sellFee) / 100, openingFeePct: opening,
    ...(allowed ? {} : { notTradable: true, reason: 'Four has switched on a whitelist for agent coins and this wallet is not on it.' }),
  };
}

const buyData = (token, funds, minTokens) => BUY + encodeArgs(['address', 'uint256', 'uint256', 'uint256', 'bytes'], [token, funds, minTokens, 0n, '0x']).slice(2);
const sellData = (token, amount, minFunds) => encodeCall('sell(address,uint256,uint256,uint256,bytes)', [token, amount, minFunds, 0n, '0x']);
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
  topics: ['0x7dae4dcd1b20eb0445e7cc1d02b3e2e7f32fa63081a0e764732c269f2b8f228f', '0x' + FOUR_AGENT.template.toString(16).padStart(64, '0')],
  async parse(log, rpc) {
    const token = '0x' + log.topics[3].slice(26), creator = '0x' + log.topics[2].slice(26);
    const [name, symbol] = await Promise.all([rpc.read(token, 'name()', [], ['string']).catch(() => ''), rpc.read(token, 'symbol()', [], ['string']).catch(() => '')]);
    return { token, creator, name, symbol };
  },
};
