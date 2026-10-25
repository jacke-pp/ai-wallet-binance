// Safety check before buying, run on your own machine:
//   1. Binance's public token audit (honeypot, taxes, contract risks) - Binance's service, not ours.
//   2. A round trip simulated on the live chain from your own wallet address: buy a little, approve, sell it all back.
//      Shows what really arrives and what comes back, so hidden taxes and coins that can't be sold show up.
// Nothing is signed or sent.
import { randomUUID } from 'node:crypto';
import { encodeCall } from './abi.mjs';
import { simulate, delivered, NATIVE } from './sim.mjs';
import { fromWei } from './engine.mjs';

// The audit reports taxes as fractions (0.02 = 2%).
const frac = x => x == null || x === '' ? null : Math.round(Number(x) * 10000) / 100;

export async function binanceAudit(token, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchImpl('https://web3.binance.com/bapi/defi/v1/public/wallet-direct/security/token/audit', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', source: 'agent', 'accept-encoding': 'identity', 'user-agent': 'binance-web3/1.4 (Skill)' },
      body: JSON.stringify({ binanceChainId: '56', contractAddress: token.toLowerCase(), requestId: randomUUID() }),
    }).finally(() => clearTimeout(t));
    const j = await res.json();
    const d = j?.data;
    if (!d?.hasResult || !d?.isSupported) return { available: false };
    const hits = (d.riskItems || []).flatMap(i => (i.details || []).filter(x => x.isHit).map(x => ({ group: i.id, title: x.title, type: x.riskType })));
    return { available: true, level: d.riskLevel, levelName: d.riskLevelEnum, buyTax: frac(d.extraInfo?.buyTax), sellTax: frac(d.extraInfo?.sellTax), verified: d.extraInfo?.isVerified ?? null, hits };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

export async function roundTrip(engine, token, bnbWei) {
  const ctx = await engine.lookCtx();
  const info = await engine.detect(ctx, token);
  if (!info) return { ran: false, reason: 'no supported market for this coin' };
  if (info.notTradable) return { ran: false, reason: 'market not open for trading' };
  if (ctx.noWallet && info.agentOnly) return { ran: false, reason: 'only AI wallets with an Agent ID can buy this: sign in (aiwb login) so the check runs from your wallet' };
  if (info.handler.roundTripCalls) {
    const calls = await info.handler.roundTripCalls(ctx, info, bnbWei);
    if (!calls) return { ran: false, reason: 'round trip not simulated for markets priced in another coin' };
    const res = await simulate(ctx.rpc, ctx.me, calls);
    if (!res[0].ok) return { ran: true, buyOk: false, reason: res[0].error || 'buy reverts' };
    const sells = res.slice(1);
    if (!sells.length) return { ran: true, buyOk: false, reason: 'the buy delivered no coins' };
    const bad = sells.find(r => !r.ok);
    if (bad) return { ran: true, buyOk: true, sellOk: false, reason: bad.error || 'sell reverts' };
    const back = delivered(sells, NATIVE, ctx.me);
    return { ran: true, buyOk: true, sellOk: true, back, keepPct: Number((back * 10000n) / bnbWei) / 100 };
  }
  const buyPlan = await info.handler.buy({ ...ctx }, info, bnbWei);
  if (buyPlan.steps.some(s => !s.tx)) return { ran: false, reason: 'multi-step market, round trip not simulated' };
  const buyCalls = buyPlan.steps.map(s => s.tx);
  const bought = await simulate(ctx.rpc, ctx.me, buyCalls);
  if (!bought.every(r => r.ok)) return { ran: true, buyOk: false, reason: bought.find(r => !r.ok)?.error || 'buy reverts' };
  const got = delivered(bought, info.token, ctx.me);
  if (got <= 0n) return { ran: true, buyOk: false, reason: 'the buy delivered no coins' };
  // Sell what the buy delivered, with no minimum (we only measure what comes back).
  let sellPlan;
  try { sellPlan = await info.handler.sell({ ...ctx, slippageBps: 10000n }, info, got); } catch (e) {
    return { ran: true, buyOk: true, got, sellOk: null, reason: `could not plan the sell back: ${e.message}` };
  }
  const calls = [...buyCalls];
  if (sellPlan.approve) calls.push({ to: info.token, value: 0n, data: encodeCall('approve(address,uint256)', [sellPlan.approve.spender, got]) });
  calls.push(...sellPlan.steps.map(s => s.tx));
  const all = await simulate(ctx.rpc, ctx.me, calls);
  const sellRes = all.slice(buyCalls.length);
  if (!sellRes.every(r => r.ok)) return { ran: true, buyOk: true, got, expected: buyPlan.expectedOut, sellOk: false, reason: sellRes.find(r => !r.ok)?.error || 'sell reverts' };
  const back = delivered(sellRes, NATIVE, ctx.me);
  return { ran: true, buyOk: true, sellOk: true, got, expected: buyPlan.expectedOut, back, keepPct: Number((back * 10000n) / bnbWei) / 100 };
}

export async function check(engine, token, { probeBnb = 10n ** 15n, fetchImpl } = {}) {
  const [inspect, audit] = await Promise.all([engine.inspect(token), binanceAudit(token, { fetchImpl })]);
  let trip;
  try { trip = await roundTrip(engine, token, probeBnb); } catch (e) { trip = { ran: false, reason: e.message }; }
  const flags = [];
  if (audit.available && audit.level >= 4) flags.push({ level: 'block', text: `Binance audit rates it HIGH risk (${audit.level}/5): ${audit.hits.map(h => h.title).join('; ')}` });
  else if (audit.available && audit.level >= 2) flags.push({ level: 'warn', text: `Binance audit: MEDIUM risk (${audit.level}/5): ${audit.hits.map(h => h.title).join('; ')}` });
  if (trip.ran && trip.buyOk === false) flags.push({ level: 'block', text: `A test buy fails right now: ${trip.reason}` });
  if (trip.sellOk === false) flags.push({ level: 'block', text: `A test sell right after buying fails: ${trip.reason}. It may be impossible to sell.` });
  if (trip.sellOk && trip.keepPct < 50) flags.push({ level: 'block', text: `Buying and selling back 0.001 BNB returns only ${trip.keepPct}%. Very high tax or a trap.` });
  else if (trip.sellOk && trip.keepPct < 80) flags.push({ level: 'warn', text: `Buying and selling back 0.001 BNB returns ${trip.keepPct}% (taxes/fees are high).` });
  const i = inspect.info;
  if (i?.sellFails) flags.push({ level: 'block', text: 'A simulated sale right after buying fails from your wallet. You may not be able to sell it.' });
  if (i?.sellTaxPct >= 25) flags.push({ level: 'block', text: `Sell tax is ${i.sellTaxPct}%.` });
  else if (i?.sellTaxPct >= 10) flags.push({ level: 'warn', text: `Sell tax is ${i.sellTaxPct}%.` });
  if (i?.buyTaxPct >= 25 && !i.openingFeePct) flags.push({ level: 'warn', text: `Buy tax is ${i.buyTaxPct}%.` });
  if (i?.taxMeasured && audit.available) {
    const off = [['buy', i.buyTaxPct, audit.buyTax], ['sell', i.sellTaxPct, audit.sellTax]].filter(([, m, a]) => m != null && a != null && Math.abs(m - a) > 2);
    if (off.length) flags.push({ level: 'warn', text: `Measured tax differs from Binance's audit (${off.map(([k, m, a]) => `${k} ${m}% vs ${a}%`).join(', ')}): the tax may change by wallet or over time.` });
  }
  if (inspect.info?.agentOnly) flags.push({ level: 'info', text: 'Agent-only curve: only wallets with a Binance Agent ID can buy before it graduates. Binance may also refuse to let an AI wallet sell it until it has a DEX pool, so you may have to hold until graduation.' });
  if (inspect.noWallet) flags.push({ level: 'info', text: 'Not signed in: simulated as a neutral address, not your wallet (some coins treat wallets differently). Run aiwb login for a check from your own wallet.' });
  if (inspect.info?.agentOnly && inspect.hasAgentId === false) flags.push({ level: 'block', text: 'This wallet has no Agent ID (.ai name), so it cannot buy this coin. Claim one in the Binance App.' });
  return {
    token, symbol: inspect.symbol, platform: inspect.info?.platform || null, phase: inspect.info?.phase || null,
    verdict: flags.some(f => f.level === 'block') ? 'do-not-buy' : flags.some(f => f.level === 'warn') ? 'careful' : 'no-red-flags',
    flags, audit, roundTrip: trip.ran ? { ...trip, got: trip.got != null ? fromWei(trip.got, inspect.decimals) : undefined, expected: trip.expected != null ? fromWei(trip.expected, inspect.decimals) : undefined, back: trip.back != null ? fromWei(trip.back) : undefined } : trip,
  };
}
