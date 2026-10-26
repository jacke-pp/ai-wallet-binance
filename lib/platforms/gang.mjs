// GANG launchpad: an Agent-ID-only bonding curve on BNB Chain (the one GANG and its coins launch on). Researched on
// chain 2026-10-25; its contract is not verified, so everything here was read from bytecode and real trades.
// - Every coin is priced in a quote coin chosen at launch: GANG, WBNB, USDT, BNCB, NVDAB, ... Buying means getting
//   that coin first (BNB is wrapped for WBNB, swapped on PancakeSwap V2 for the others), approving it to the
//   launchpad, then buy(coin, quoteAmount, minCoins): 3 transactions. A sale pays the quote coin back, which is
//   unwrapped / swapped back to BNB.
// - Only callers holding a Binance Agent ID may buy (isAgent on msg.sender, error NotAgent), so the AI wallet must call
//   the launchpad itself. One wallet may hold at most 1% (10M of 1B coins; walletRoom says how much more fits).
//   Coins are locked (not transferable) until the curve fills; selling needs an approval of the coin.
// - Fees: 1% of the quote coin on buys and on sells, paid to the launchpad's tax handler.
// - When the curve fills, the migrator puts the coin in a PancakeSwap V2 pool against its quote coin and unlocks it.
//   Coins priced in WBNB then trade on the normal PancakeSwap handler; the others go through two hops here
//   (BNB -> quote coin -> coin and back).
// - Binance's audit rates these coins 3/5 (contract not verified), and its risk screen flags every transaction touching
//   a coin rated that high. With the App setting "abnormal transaction handling" on auto-reject sales are refused; set
//   to confirm in the App, each sale goes to the App and goes through once confirmed (2026-10-25). Moving the coin to
//   another wallet is no way around it: the coin reverts transfers while locked.
// - No quote function is used: buys and sells are priced by simulating them on the live chain (eth_simulateV1).
import { encodeCall, same } from '../abi.mjs';
import { simulate, delivered, NATIVE } from '../sim.mjs';
import { PANCAKE, pairOf } from './pancake.mjs';

export const GANG = {
  launchpad: '0x1b8f3f69dfa0a7f63d308c7eb0fd38d8b099966e',
  gang: '0x0c6302401aa5325c2e36f170f52c00b1d220b405',
};
const CREATED = '0xd23a447045c377a966a79f59983bae21db7b92fead61df8ace4aea5628043791'; // (coin, creator, quote) indexed

const word = (hex, i) => '0x' + hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const min = (x, ctx) => (x * (10000n - ctx.slippageBps)) / 10000n;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 120);
const isWbnb = q => same(q, PANCAKE.wbnb);

// curves(coin): word 0 = creator, word 1 = quote coin (zero if the launchpad doesn't know the coin).
export async function curveOf(rpc, token) {
  const raw = await rpc.call({ to: GANG.launchpad, data: encodeCall('curves(address)', [token]) }).catch(() => '0x');
  if (raw.length < 2 + 2 * 64) return null;
  const quote = '0x' + word(raw, 1).slice(26);
  if (/^0x0{40}$/.test(quote)) return null;
  return { creator: '0x' + word(raw, 0).slice(26), quote };
}

// The whole curves(coin) record: word 2 = quote coin raised, 3 = coins sold, 4 = quote coin that fills the curve,
// 6 = graduated (1), 8 = its PancakeSwap pair once graduated. Read 2026-10-26.
export function curveState(raw) {
  if (!raw || raw.length < 2 + 9 * 64) return null;
  const n = i => BigInt(word(raw, i));
  const quote = '0x' + word(raw, 1).slice(26);
  if (/^0x0{40}$/.test(quote)) return null;
  return { creator: '0x' + word(raw, 0).slice(26), quote, raised: n(2), sold: n(3), target: n(4), graduated: n(6) === 1n, pair: '0x' + word(raw, 8).slice(26) };
}
// Every coin the launchpad made, oldest first: tokenCount() and allTokens(i).
export const gangReads = {
  count: () => ({ to: GANG.launchpad, data: encodeCall('tokenCount()') }),
  tokenAt: i => ({ to: GANG.launchpad, data: encodeCall('allTokens(uint256)', [BigInt(i)]) }),
  curve: token => ({ to: GANG.launchpad, data: encodeCall('curves(address)', [token]) }),
};

export async function detect(ctx, token) {
  const c = await curveOf(ctx.rpc, token);
  if (!c) return null;
  // Coins stay locked while on the curve; once it fills they are unlocked and trade on a DEX pool.
  const locked = await ctx.rpc.read(token, 'locked()', [], ['bool']).catch(() => true);
  if (!locked && isWbnb(c.quote)) return null; // graduated into a coin/WBNB pool: the PancakeSwap handler trades it
  const qsym = isWbnb(c.quote) ? 'BNB' : await ctx.rpc.read(c.quote, 'symbol()', [], ['string']).catch(() => 'quote coin');
  if (!locked) {
    const pair = await ctx.rpc.read(PANCAKE.factory, 'getPair(address,address)', [token, c.quote], ['address']).catch(() => null);
    if (!pair || /^0x0{40}$/.test(pair)) return null;
    return { platform: 'gang', phase: 'dex', agentOnly: false, creator: c.creator, quote: c.quote, quoteSymbol: qsym, pair };
  }
  return { platform: 'gang', phase: 'curve', agentOnly: true, creator: c.creator, quote: c.quote, quoteSymbol: qsym, buyTaxPct: 1, sellTaxPct: 1 };
}

const toQuote = (ctx, quote, bnb) => isWbnb(quote)
  ? { to: PANCAKE.wbnb, value: bnb, data: encodeCall('deposit()') }
  : { to: PANCAKE.router, value: bnb, data: encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [0n, [PANCAKE.wbnb, quote], ctx.me, deadline()]) };
const approveTx = (token, spender, amount) => ({ to: token, value: 0n, data: encodeCall('approve(address,uint256)', [spender, amount]) });
const buyTx = (token, amount, minOut) => ({ to: GANG.launchpad, value: 0n, data: encodeCall('buy(address,uint256,uint256)', [token, amount, minOut]) });
const sellTx = (token, amount, minOut) => ({ to: GANG.launchpad, value: 0n, data: encodeCall('sell(address,uint256,uint256)', [token, amount, minOut]) });

// BNB -> quote coin -> curve, simulated together. Returns the quote amount and coins it buys.
async function simBuy(ctx, info, bnb, block) {
  const [q] = await simulate(ctx.rpc, ctx.me, [toQuote(ctx, info.quote, bnb)], { block });
  if (!q.ok) throw new Error(`Could not get ${info.quoteSymbol} for BNB right now${q.error ? `: ${q.error}` : ''}.`);
  const quoteAmt = isWbnb(info.quote) ? bnb : delivered([q], info.quote, ctx.me);
  const res = await simulate(ctx.rpc, ctx.me, [toQuote(ctx, info.quote, bnb), approveTx(info.quote, GANG.launchpad, quoteAmt), buyTx(info.token, quoteAmt, 0n)], { block });
  if (!res[2].ok) throw new Error(`The GANG launchpad refuses this buy right now${res[2].error ? `: ${res[2].error}` : ''}.`);
  return { quoteAmt, out: delivered([res[2]], info.token, ctx.me) };
}

// Graduated coins priced in another coin: two hops on PancakeSwap V2.
const hops = info => ({ in: [PANCAKE.wbnb, info.quote, info.token], out: [info.token, info.quote, PANCAKE.wbnb] });
const amountsOut = async (ctx, amount, path) => (await ctx.rpc.read(PANCAKE.router, 'getAmountsOut(uint256,address[])', [amount, path], ['uint256[]'])).at(-1);
const swapIn = (ctx, info, bnb, minOut) => ({ to: PANCAKE.router, value: bnb, data: encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [minOut, hops(info).in, ctx.me, deadline()]) });
const swapOut = (ctx, info, amount, minOut) => ({ to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [amount, minOut, hops(info).out, ctx.me, deadline()]) });

async function buyDex(ctx, info, bnbIn) {
  const out = await amountsOut(ctx, bnbIn, hops(info).in);
  return { expectedOut: out, minOut: min(out, ctx), via: `PancakeSwap V2 (BNB to ${info.quoteSymbol} to coin)`, v2Legs: [{ amountIn: bnbIn, path: hops(info).in }], steps: [{ label: 'buy', tx: swapIn(ctx, info, bnbIn, min(out, ctx)) }] };
}

async function sellDex(ctx, info, amount) {
  const out = await amountsOut(ctx, amount, hops(info).out);
  return { expectedOut: out, minOut: min(out, ctx), via: `PancakeSwap V2 (coin to ${info.quoteSymbol} to BNB)`, v2Legs: [{ amountIn: amount, path: hops(info).out }], approve: { token: info.token, spender: PANCAKE.router, amount },
    steps: [{ label: 'sell', tx: swapOut(ctx, info, amount, min(out, ctx)) }] };
}

const SELL_NOTE = 'Binance flags sales on this curve as risky: set "abnormal transaction handling" to confirm in the App (AI wallet settings), then confirm each sale there. On auto-reject you hold until the curve fills.';

export async function buy(ctx, info, bnbIn) {
  if (info.phase === 'dex') return buyDex(ctx, info, bnbIn);
  if (!isWbnb(info.quote) && !(await pairOf(ctx.rpc, info.quote))) throw new Error(`This coin is priced in ${info.quoteSymbol}, which has no PancakeSwap V2 BNB pool. Not supported yet.`);
  const room = await ctx.rpc.read(GANG.launchpad, 'walletRoom(address,address)', [info.token, ctx.me], ['uint256']);
  if (room <= 0n) throw new Error('This wallet already holds 1% of this coin, the most one wallet may hold before the curve fills.');
  let bnb = bnbIn, s = await simBuy(ctx, info, bnb);
  const warnings = [SELL_NOTE];
  if (s.out > room) {
    bnb = (bnbIn * room * 98n) / (s.out * 100n);
    s = await simBuy(ctx, info, bnb);
    warnings.push(`Reduced to ${bnb} wei: one wallet may hold at most 1% of this coin.`);
  }
  const via = isWbnb(info.quote) ? 'GANG launchpad (wrap BNB, approve, buy)' : `PancakeSwap (BNB to ${info.quoteSymbol}) + GANG launchpad, 3 transactions`;
  if (!isWbnb(info.quote)) warnings.push(`This coin is priced in ${info.quoteSymbol}: 3 transactions (swap, approve, buy). A sale pays ${info.quoteSymbol} back and swaps it to BNB.`);
  if (isWbnb(info.quote)) {
    return { expectedOut: s.out, minOut: min(s.out, ctx), spend: bnb, via, warnings,
      steps: [{ label: 'wrap BNB', tx: toQuote(ctx, info.quote, bnb) }, { label: 'approval', tx: approveTx(info.quote, GANG.launchpad, bnb) }, { label: 'buy', tx: buyTx(info.token, bnb, min(s.out, ctx)) }] };
  }
  const swap = encodeCall('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)', [min(s.quoteAmt, ctx), [PANCAKE.wbnb, info.quote], ctx.me, deadline()]);
  let before = 0n;
  return {
    expectedOut: s.out, minOut: min(s.out, ctx), spend: bnb, via, warnings, v2Legs: [{ amountIn: bnb, path: [PANCAKE.wbnb, info.quote] }],
    steps: [
      { label: `swap BNB to ${info.quoteSymbol}`, async build() { before = await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256']); return { to: PANCAKE.router, value: bnb, data: swap }; } },
      { label: 'approval', async build(st) {
        st.quoteAmt = (await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256'], { block: BigInt(st.last.blockNumber) })) - before;
        return approveTx(info.quote, GANG.launchpad, st.quoteAmt);
      } },
      // The swap may deliver a little more or less than simulated: keep the same minimum price per quote coin.
      { label: 'buy', build: st => buyTx(info.token, st.quoteAmt, min((s.out * st.quoteAmt) / s.quoteAmt, ctx)) },
    ],
  };
}

export async function sell(ctx, info, amount) {
  if (info.phase === 'dex') return sellDex(ctx, info, amount);
  const res = await simulate(ctx.rpc, ctx.me, [approveTx(info.token, GANG.launchpad, amount), sellTx(info.token, amount, 0n)]);
  if (!res[1].ok) throw new Error(`The GANG launchpad refuses this sell right now${res[1].error ? `: ${res[1].error}` : ''}.`);
  const quoteOut = delivered([res[1]], info.quote, ctx.me);
  const approve = { token: info.token, spender: GANG.launchpad, amount };
  let before = 0n;
  const sellStep = { label: 'sell', async build() { before = await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256']); return sellTx(info.token, amount, min(quoteOut, ctx)); } };
  const got = async st => (await ctx.rpc.read(info.quote, 'balanceOf(address)', [ctx.me], ['uint256'], { block: BigInt(st.last.blockNumber) })) - before;
  if (isWbnb(info.quote)) {
    return { expectedOut: quoteOut, minOut: min(quoteOut, ctx), via: 'GANG launchpad (sell, unwrap WBNB)', approve,
      steps: [sellStep, { label: 'unwrap WBNB', build: async st => ({ to: PANCAKE.wbnb, value: 0n, data: encodeCall('withdraw(uint256)', [await got(st)]) }) }] };
  }
  const path = [info.quote, PANCAKE.wbnb];
  const bnbOut = (await ctx.rpc.read(PANCAKE.router, 'getAmountsOut(uint256,address[])', [quoteOut, path], ['uint256[]']).catch(() => [0n])).at(-1);
  return {
    expectedOut: bnbOut, minOut: min(bnbOut, ctx), via: `GANG launchpad + PancakeSwap (${info.quoteSymbol} to BNB), up to 3 transactions`, approve, v2Legs: [{ amountIn: quoteOut, path }],
    steps: [
      sellStep,
      { label: 'approval', async build(st) {
        st.quoteBack = await got(st);
        const allowance = await ctx.rpc.read(info.quote, 'allowance(address,address)', [ctx.me, PANCAKE.router], ['uint256']);
        return allowance >= st.quoteBack ? null : approveTx(info.quote, PANCAKE.router, st.quoteBack);
      } },
      { label: `swap ${info.quoteSymbol} to BNB`, async build(st) {
        const exp = (await ctx.rpc.read(PANCAKE.router, 'getAmountsOut(uint256,address[])', [st.quoteBack, path], ['uint256[]'])).at(-1);
        return { to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [st.quoteBack, min(exp, ctx), path, ctx.me, deadline()]) };
      } },
    ],
  };
}

// Safety check: BNB -> quote -> coin, sell it all, quote -> BNB, no minimums. `buys` = how many calls make up the buy.
// Amounts are worked out on one block, then 0.5% is held back at each hand-over: the check itself runs a moment later
// and the quote coin's price moves in between (so the result reads up to ~1% low, never falsely "can't sell").
export async function roundTripCalls(ctx, info, bnbIn) {
  if (info.phase === 'dex') {
    const [r] = await simulate(ctx.rpc, ctx.me, [swapIn(ctx, info, bnbIn, 0n)]);
    const got = r.ok ? (delivered([r], info.token, ctx.me) * 995n) / 1000n : 0n;
    return got ? [swapIn(ctx, info, bnbIn, 0n), approveTx(info.token, PANCAKE.router, got), swapOut(ctx, info, got, 0n)] : [swapIn(ctx, info, bnbIn, 0n)];
  }
  const block = await ctx.rpc.blockNumber();
  const keep = x => (x * 995n) / 1000n;
  const sim = await simBuy(ctx, info, bnbIn, block).catch(() => ({ quoteAmt: 0n, out: 0n }));
  const quoteAmt = isWbnb(info.quote) ? sim.quoteAmt : keep(sim.quoteAmt), out = keep(sim.out);
  const buyCalls = [toQuote(ctx, info.quote, bnbIn), approveTx(info.quote, GANG.launchpad, quoteAmt), buyTx(info.token, quoteAmt, 0n)];
  if (!out) return { calls: buyCalls, buys: 3 };
  const sold = [...buyCalls, approveTx(info.token, GANG.launchpad, out), sellTx(info.token, out, 0n)];
  const res = await simulate(ctx.rpc, ctx.me, sold, { block });
  const back = res[4].ok ? keep(delivered([res[4]], info.quote, ctx.me)) : 0n;
  if (!back) return { calls: sold, buys: 3 };
  const toBnb = isWbnb(info.quote)
    ? [{ to: PANCAKE.wbnb, value: 0n, data: encodeCall('withdraw(uint256)', [back]) }]
    : [approveTx(info.quote, PANCAKE.router, back), { to: PANCAKE.router, value: 0n, data: encodeCall('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', [back, 0n, [info.quote, PANCAKE.wbnb], ctx.me, deadline()]) }];
  return { calls: [...sold, ...toBnb], buys: 3 };
}

// New coins for snipes: the launchpad's creation event (coin, creator, quote).
export const watch = {
  address: GANG.launchpad,
  topics: [CREATED],
  async parse(log, rpc) {
    const token = '0x' + log.topics[1].slice(26), creator = '0x' + log.topics[2].slice(26), quote = '0x' + log.topics[3].slice(26);
    const [name, symbol] = await Promise.all([rpc.read(token, 'name()', [], ['string']).catch(() => ''), rpc.read(token, 'symbol()', [], ['string']).catch(() => '')]);
    return { token, creator, quote, name, symbol };
  },
};
