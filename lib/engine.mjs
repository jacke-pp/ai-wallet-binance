// One trade, start to finish: figure out where the coin trades, check the wallet and the limits, build the call,
// let Binance simulate + sign + send it, wait for the block, read what actually arrived, write it in the journal.
import { encodeCall, decode, same, ZERO, isAddress } from './abi.mjs';
import { record, spentToday } from './store.mjs';
import { PLATFORMS } from './platforms/index.mjs';
import { worstImpact, shallowReason, DEFAULT_MAX_IMPACT_PCT } from './depth.mjs';
import { createKyber } from './kyber.mjs';

export const AGENT_ID = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F'; // Binance Agent ID (.ai names), SPACE ID registry on BSC
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WEI = 10n ** 18n;

export const toWei = (x, d = 18) => {
  const [i, f = ''] = String(x).trim().split('.');
  if (!/^\d+$/.test(i || '0') || !/^\d*$/.test(f)) throw new Error(`not a number: ${x}`);
  return BigInt(i || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0');
};
export const fromWei = (x, d = 18, p = 6) => {
  const v = BigInt(x), neg = v < 0n, a = neg ? -v : v, base = 10n ** BigInt(d);
  const s = `${a / base}.${(a % base).toString().padStart(d, '0').slice(0, p)}`.replace(/\.?0+$/, '');
  return (neg ? '-' : '') + (s || '0');
};

export function createEngine({ rpc, wallet, cfg = {}, platforms = PLATFORMS, now = () => Date.now(), onAppWait = null, kyber }) {
  // Swaps are also priced on KyberSwap's aggregator (route.mjs) unless switched off (aiwb config set aggregator off).
  if (kyber === undefined) kyber = cfg.aggregator === 'off' ? null : createKyber();
  const slippageBps = BigInt(Math.round(Number(cfg.slippagePct ?? 15) * 100));

  // Gas: Binance picks the gas price. You can cap the gas limit, and have a transaction that is still pending after
  // N seconds re-sent by Binance with a higher gas price (speed-up: LOW = x1.1, HIGH = x1.25).
  const baseGas = { gasLimit: cfg.gasLimit, speedUpAfterSec: cfg.speedUpAfterSec, speedUpLevel: cfg.speedUpLevel || 'HIGH' };

  // For looking only (info, check): works before sign-in, reading and simulating as a neutral address.
  async function lookCtx() {
    try { return await ctxFor(); } catch (e) {
      if (!['NOT_LOGGED_IN', 'NO_BAW', 'NO_ADDRESS'].includes(e.code)) throw e;
      return { rpc, kyber, me: '0x000000000000000000000000000000000000dEaD', slippageBps, gas: { ...baseGas }, noWallet: e.message };
    }
  }

  async function ctxFor(opts = {}) {
    const ctx = { rpc, kyber, me: await wallet.address(), slippageBps, gas: { ...baseGas } };
    if (opts.slippagePct != null) ctx.slippageBps = BigInt(Math.round(opts.slippagePct * 100));
    if (opts.gasLimit != null) ctx.gas.gasLimit = opts.gasLimit;
    if (opts.speedUpAfterSec != null) ctx.gas.speedUpAfterSec = opts.speedUpAfterSec;
    // Wait for a Binance App confirmation when Binance asks for one (not in snipes: appWait false).
    if (onAppWait && opts.appWait !== false) ctx.gas.app = { onWait: onAppWait, timeoutMs: (cfg.appWaitSec ?? 600) * 1000 };
    return ctx;
  }

  async function tokenMeta(token) {
    const [symbol, decimals] = await Promise.all([
      rpc.read(token, 'symbol()', [], ['string']).catch(() => '?'),
      rpc.read(token, 'decimals()', [], ['uint8']).catch(() => 18n),
    ]);
    return { symbol, decimals: Number(decimals) };
  }

  async function detect(ctx, token, { follow = true, skip = null } = {}) {
    const found = await Promise.all(platforms.map(p => p === skip ? null : p.detect(ctx, token).catch(() => null)));
    const i = found.findIndex(Boolean);
    if (i < 0) return null;
    const info = { ...found[i], token, handler: platforms[i] };
    // An agent market that already launched: trade the real coin it became (claim the shares separately).
    if (follow && info.notTradable && info.launchedToken) {
      // The launched coin can have the same address the user gave (Flap's ...7777): skip the agent handler then.
      const next = await detect(ctx, info.launchedToken, { follow: false, skip: info.handler });
      if (next) return { ...next, launchedFrom: info };
    }
    return info;
  }
  // A swap through a thin pool pays a bad price that slippage doesn't catch (see depth.mjs): refuse it above
  // maxImpactPct (default 5). force skips the check.
  async function depthGuard(plan, opts) {
    const legs = plan.swapLegs || [];
    if (!legs.length) return;
    const impact = await worstImpact(rpc, legs);
    plan.impactPct = impact;
    const limit = opts.maxImpactPct ?? cfg.maxImpactPct ?? DEFAULT_MAX_IMPACT_PCT;
    if (impact == null || impact <= limit || opts.force) return;
    const why = await shallowReason(rpc, legs).catch(() => '');
    throw Object.assign(new Error(`Refused: this trade would move the price ${impact}% (your limit is ${limit}%): the pool is too thin, even on the best route found (${plan.via}).${why ? ' ' + why : ''} Nothing was sent. Use a smaller amount, trade it in the Binance App, or raise the limit (aiwb config set maxImpactPct <n>, or --force).`), { code: 'SHALLOW_POOL', impactPct: impact, limitPct: limit });
  }
  // What this wallet holds: an ERC20 balance, or for agent curves the platform's own shares.
  const heldBy = (ctx, info, token, block) => info?.handler?.held ? info.handler.held(ctx, info) : rpc.read(token, 'balanceOf(address)', [ctx.me], ['uint256'], { block });

  // Everything the AI needs to decide: where it trades, whether this wallet may buy, taxes, what we hold.
  async function inspect(token) {
    if (!isAddress(token)) throw new Error(`not a contract address: ${token}`);
    const ctx = await lookCtx();
    const code = await rpc.code(token);
    // No code yet can still be a known agent coin (a Flap agent coin's address before it launches).
    const found = code && code !== '0x' ? null : await detect(ctx, token);
    if ((!code || code === '0x') && !found) throw new Error('No contract at this address on BNB Chain.');
    const [meta, info, hasAgentId, bnb] = ctx.noWallet ? [found ? { symbol: found.symbol || '?', decimals: 18 } : await tokenMeta(token), found || await detect(ctx, token), null, null] : await Promise.all([
      found ? { symbol: found.symbol || '?', decimals: 18 } : tokenMeta(token), found || detect(ctx, token),
      rpc.read(AGENT_ID, 'balanceOf(address)', [ctx.me], ['uint256']).then(n => n > 0n).catch(() => null),
      rpc.balance(ctx.me),
    ]);
    const held = ctx.noWallet ? null : await heldBy(ctx, info, info?.token || token).catch(() => 0n);
    if (info?.symbol && meta.symbol === '?') meta.symbol = info.symbol;
    return { token, ...meta, wallet: ctx.noWallet ? null : ctx.me, noWallet: ctx.noWallet || null, walletBnb: bnb, hasAgentId, held, info };
  }

  // Your own limits (config) count every buy; a snipe's --daily-cap counts only what snipes spent today.
  function checkLimits(bnbWei, limits = {}) {
    const bnb = Number(fromWei(bnbWei));
    const per = limits.maxPerTradeBnb ?? cfg.maxPerTradeBnb;
    if (per && bnb > per) throw new Error(`Refused: ${bnb} BNB is above your per-trade limit of ${per} BNB. Nothing was sent.`);
    const caps = [];
    if (cfg.dailyCapBnb) caps.push([cfg.dailyCapBnb, spentToday(undefined, now()), "today's limit"]);
    if (limits.snipeDailyCapBnb) caps.push([limits.snipeDailyCapBnb, spentToday(undefined, now(), { snipesOnly: true }), "the snipes' daily cap"]);
    for (const [cap, spent, what] of caps) {
      if (spent + bnb > cap + 1e-12) throw new Error(`Refused: ${what} is ${cap} BNB and ${spent.toFixed(4)} BNB is already spent (daily cap). Nothing was sent.`);
    }
  }

  // Coins received by `me` / sent from `me` in a receipt.
  function moved(rc, token, me) {
    let inn = 0n, out = 0n;
    for (const l of rc.logs || []) {
      if (l.topics?.[0] !== TRANSFER || l.topics.length !== 3 || !same(l.address, token)) continue;
      if (same('0x' + l.topics[2].slice(26), me)) inn += BigInt(l.data);
      if (same('0x' + l.topics[1].slice(26), me)) out += BigInt(l.data);
    }
    return { inn, out };
  }
  // BNB the wallet gained in this block, gas added back (Binance pays gas from the wallet). Null if the node can't say.
  async function bnbGained(rc, me) {
    try {
      const b = BigInt(rc.blockNumber);
      const [after, before] = await Promise.all([rpc.balance(me, b), rpc.balance(me, b - 1n)]);
      return after - before + BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice || 0);
    } catch { return null; }
  }

  async function waitAny(hashes, timeoutMs = 60_000) {
    const end = now() + timeoutMs;
    for (;;) {
      for (const h of hashes) { const rc = await rpc.receipt(h).catch(() => null); if (rc) return rc; }
      if (now() > end) throw new Error(`no receipt for ${hashes.join(' / ')} after ${timeoutMs / 1000}s (check it on bscscan)`);
      await new Promise(res => setTimeout(res, 300));
    }
  }

  async function send(tx, label, gas = baseGas) {
    // A transaction confirmed in the App is found in the wallet's history: only accept one with the same call.
    const app = gas.app && { ...gas.app, match: async h => { const t = await rpc.send('eth_getTransactionByHash', [h]); return !!t && same(t.to, tx.to) && (t.input || '').toLowerCase() === (tx.data || '0x').toLowerCase(); } };
    const r = await wallet.send(gas.gasLimit ? { ...tx, gasLimit: gas.gasLimit } : tx, label, app);
    const tSent = now();
    let rc = null;
    if (gas.speedUpAfterSec) {
      rc = await rpc.waitReceipt(r.hash, { timeoutMs: gas.speedUpAfterSec * 1000 }).catch(() => null);
      if (!rc) {
        // Binance refuses (30007002) when the transaction confirmed in the meantime: nothing to speed up then.
        const sp = await wallet.speedUp(r.hash, gas.speedUpLevel).catch(e => e.code === 30007002 ? { skipped: 'already confirmed' } : { error: e.message });
        r.speedUp = sp;
        rc = await waitAny([r.hash, sp?.hash].filter(Boolean));
        if (rc.transactionHash) r.hash = rc.transactionHash;
      }
    } else rc = await rpc.waitReceipt(r.hash);
    if (rc.status !== '0x1') throw Object.assign(new Error(`The ${label} was sent but reverted on chain (${r.hash}).`), { hash: r.hash, sent: true });
    return { ...r, rc, confirmMs: now() - tSent };
  }

  // Steps are { label, tx } or { label, build(state) } for ones that depend on an earlier receipt (state.last).
  async function runSteps(steps, st = {}, gas = baseGas) {
    let sent = null;
    for (const s of steps) {
      const tx = s.tx ?? await s.build(st);
      if (!tx) continue;
      sent = await send(tx, s.label, gas);
      st.last = sent.rc;
      (st.hashes ??= []).push(sent.hash);
    }
    return sent;
  }

  async function approveIfNeeded(ctx, a) {
    if (!a) return null;
    const have = await rpc.read(a.token, 'allowance(address,address)', [ctx.me, a.spender], ['uint256']).catch(() => 0n);
    if (have >= a.amount) return null;
    // Exact amount, never unlimited: a later bug or hack in the spender can't take more than this sale.
    return send({ to: a.token, value: 0n, data: encodeCall('approve(address,uint256)', [a.spender, a.amount]) }, 'approval', ctx.gas);
  }

  async function buy(token, bnbAmount, opts = {}) {
    const t0 = now();
    const bnbWei = typeof bnbAmount === 'bigint' ? bnbAmount : toWei(bnbAmount);
    if (bnbWei <= 0n) throw new Error('Amount must be above 0.');
    checkLimits(bnbWei, opts.limits);
    const ctx = await ctxFor(opts);
    // Everything that can be read at once is read at once: every second counts on a fresh curve.
    const [info, bal, hasAgentId] = await Promise.all([
      opts.info ? opts.info : detect(ctx, token), rpc.balance(ctx.me),
      rpc.read(AGENT_ID, 'balanceOf(address)', [ctx.me], ['uint256']).then(n => n > 0n).catch(() => true),
    ]);
    if (!info) throw new Error('Could not find where this coin trades (not a supported curve and no PancakeSwap V2 BNB pool). Nothing was sent.');
    if (info.notTradable) throw new Error(info.launchedToken ? `This agent coin already launched as ${info.launchedToken}. Claim with: aiwb claim ${info.market}` : 'This market is not open for trading. Nothing was sent.');
    const coin = info.token;
    if (bal < bnbWei) throw new Error(`The AI wallet has ${fromWei(bal)} BNB, less than ${fromWei(bnbWei)}. Top it up in the Binance App. Nothing was sent.`);
    if (info.agentOnly && !hasAgentId) throw new Error('This coin only sells to wallets with a Binance Agent ID (.ai name). Claim one for this wallet in the Binance App first. Nothing was sent.');
    if (opts.maxTaxPct != null && info.buyTaxPct != null && info.buyTaxPct > opts.maxTaxPct) {
      throw Object.assign(new Error(`Refused: buy tax is ${info.buyTaxPct}%, above your limit of ${opts.maxTaxPct}%. Nothing was sent.`), { code: 'TAX_HIGH' });
    }
    if (opts.maxSellTaxPct != null && info.sellTaxPct != null && info.sellTaxPct > opts.maxSellTaxPct) {
      throw Object.assign(new Error(`Refused: sell tax is ${info.sellTaxPct}%, above your limit of ${opts.maxSellTaxPct}%. Nothing was sent.`), { code: 'TAX_HIGH' });
    }
    if (info.buyFails) throw new Error('Refused: a simulated buy of this coin fails right now. Nothing was sent.');
    if (info.sellFails && !opts.force) throw new Error('Refused: a simulated sale right after buying fails, so you might not be able to sell this coin. Nothing was sent. (--force buys anyway)');
    const [plan, meta, before] = await Promise.all([
      info.handler.buy(ctx, info, bnbWei),
      info.unit === 'shares' ? { symbol: info.symbol, decimals: 18 } : tokenMeta(coin),
      info.handler.held ? heldBy(ctx, info, coin).catch(() => null) : null,
    ]);
    await depthGuard(plan, opts);
    const spend = plan.spend ?? bnbWei;
    if (opts.dryRun) return { dryRun: true, platform: info.platform, ...meta, plan };
    const entry = { kind: 'buy', token: coin, symbol: meta.symbol, platform: info.platform, unit: info.unit, bnb: fromWei(spend, 18, 18), source: opts.source || 'manual' };
    const tSend = now();
    let sent;
    try { sent = await runSteps(plan.steps, {}, ctx.gas); } catch (e) {
      record({ ...entry, status: e.sent ? 'reverted' : 'not_sent', hash: e.hash, error: e.message });
      throw e;
    }
    const got = info.handler.held && before != null
      ? (await heldBy(ctx, info, coin, BigInt(sent.rc.blockNumber)).catch(() => before)) - before
      : moved(sent.rc, coin, ctx.me).inn;
    const line = record({ ...entry, status: 'ok', hash: sent.hash, tokens: fromWei(got, meta.decimals, meta.decimals), ms: now() - t0,
      prepareMs: tSend - t0, previewMs: sent.previewMs, executeMs: sent.executeMs, confirmMs: sent.confirmMs });
    return { ...line, warnings: plan.warnings || [] };
  }

  async function sell(token, { percent, amount } = {}, opts = {}) {
    const t0 = now();
    const ctx = await ctxFor(opts);
    const info = await detect(ctx, token);
    if (!info) throw new Error('Could not find where this coin trades. Nothing was sent.');
    if (info.notTradable) throw new Error(info.launchedToken ? `This agent coin already launched as ${info.launchedToken}. Claim first: aiwb claim ${info.market}` : 'This market is not open for trading. Nothing was sent.');
    const coin = info.token;
    const [meta, held] = await Promise.all([info.unit === 'shares' ? { symbol: info.symbol, decimals: 18 } : tokenMeta(coin), heldBy(ctx, info, coin)]);
    let qty = amount != null ? toWei(amount, meta.decimals) : (held * BigInt(Math.round((percent ?? 100) * 100))) / 10000n;
    if (qty > held) qty = held;
    if (qty <= 0n) throw new Error(`This wallet holds no ${meta.symbol}. Nothing was sent.`);
    const plan = await info.handler.sell(ctx, info, qty);
    await depthGuard(plan, opts);
    if (opts.dryRun) return { dryRun: true, platform: info.platform, ...meta, qty, plan };
    const entry = { kind: 'sell', token: coin, symbol: meta.symbol, platform: info.platform, unit: info.unit, tokens: fromWei(qty, meta.decimals, meta.decimals), source: opts.source || 'manual' };
    let sent;
    try {
      await approveIfNeeded(ctx, plan.approve);
      sent = await runSteps(plan.steps, {}, ctx.gas);
    } catch (e) {
      record({ ...entry, status: e.sent ? 'reverted' : 'not_sent', hash: e.hash, error: e.message });
      throw e;
    }
    const back = (await bnbGained(sent.rc, ctx.me)) ?? plan.expectedOut;
    const line = record({ ...entry, status: 'ok', hash: sent.hash, bnb: fromWei(back, 18, 18), ms: now() - t0 });
    return { ...line, warnings: plan.warnings || [] };
  }

  // Agent markets that launched: turn this wallet's shares into the real coin.
  async function claim(addr, opts = {}) {
    const ctx = await ctxFor(opts);
    for (const p of platforms) {
      if (!p.claimTx || !p.marketOf) continue;
      const market = await p.marketOf(rpc, addr).catch(() => null);
      if (!market) continue;
      const info = await p.detect(ctx, market).catch(() => null);
      if (info && !info.notTradable) throw new Error('This agent coin has not launched yet: claim once its market fills. Until then you can sell the shares. Nothing was sent.');
      if (p.held && info && (await p.held(ctx, info).catch(() => null)) === 0n) throw new Error('This wallet has no shares in this market, so there is nothing to claim. Nothing was sent.');
      const t0 = now();
      const sent = await send(p.claimTx(market), 'claim', ctx.gas);
      const coin = info?.launchedToken || null;
      const meta = coin ? await tokenMeta(coin) : null;
      const got = coin ? moved(sent.rc, coin, ctx.me).inn : null;
      return record({ kind: 'claim', to: market, token: coin, symbol: meta?.symbol, tokens: got != null ? fromWei(got, meta.decimals, meta.decimals) : undefined,
        status: 'ok', hash: sent.hash, ms: now() - t0, source: opts.source || 'manual' });
    }
    throw new Error('Not an agent market this tool knows (nothing to claim).');
  }

  // Send coins from the AI wallet to another address: all of them (default), a percentage or an amount.
  // An ERC20 transfer through Binance like every other transaction (simulated, screened, App confirmation if asked).
  async function transfer(token, to, { percent, amount } = {}, opts = {}) {
    if (!isAddress(token)) throw new Error(`not a contract address: ${token}`);
    if (!isAddress(to) || same(to, ZERO)) throw new Error(`not a wallet address to send to: ${to}`);
    const ctx = await ctxFor(opts);
    if (same(to, ctx.me)) throw new Error('That is this AI wallet itself. Nothing was sent.');
    const [meta, held] = await Promise.all([tokenMeta(token), rpc.read(token, 'balanceOf(address)', [ctx.me], ['uint256'])]);
    let qty = amount != null ? toWei(amount, meta.decimals) : (held * BigInt(Math.round((percent ?? 100) * 100))) / 10000n;
    if (qty > held) qty = held;
    if (qty <= 0n) throw new Error(`This wallet holds no ${meta.symbol}. Nothing was sent.`);
    const tx = { to: token, value: 0n, data: encodeCall('transfer(address,uint256)', [to, qty]) };
    if (opts.dryRun) return { dryRun: true, ...meta, qty, to, preview: await wallet.preview(tx) };
    const entry = { kind: 'transfer', token, symbol: meta.symbol, to, tokens: fromWei(qty, meta.decimals, meta.decimals), source: opts.source || 'manual' };
    const t0 = now();
    try {
      const sent = await send(tx, 'transfer', ctx.gas);
      return record({ ...entry, status: 'ok', hash: sent.hash, ms: now() - t0 });
    } catch (e) {
      record({ ...entry, status: e.sent ? 'reverted' : 'not_sent', hash: e.hash, error: e.message });
      throw e;
    }
  }

  // Any contract call through the AI wallet (mints, claims...). Binance simulates it first; what fails is not sent.
  async function call({ to, data, value = 0n, label = 'contract call', dryRun = false, gasLimit, speedUpAfterSec }) {
    if (!isAddress(to)) throw new Error(`bad contract address: ${to}`);
    const { gas } = await ctxFor({ gasLimit, speedUpAfterSec });
    if (dryRun) return { dryRun: true, preview: await wallet.preview(gas.gasLimit ? { to, data, value, gasLimit: gas.gasLimit } : { to, data, value }) };
    if (value > 0n) checkLimits(value);
    const t0 = now();
    try {
      const sent = await send({ to, data, value }, label, gas);
      return record({ kind: 'call', to, label, bnb: fromWei(value, 18, 18), status: 'ok', hash: sent.hash, ms: now() - t0, selector: data.slice(0, 10) });
    } catch (e) {
      record({ kind: 'call', to, label, bnb: fromWei(value, 18, 18), status: e.sent ? 'reverted' : 'not_sent', hash: e.hash, error: e.message });
      throw e;
    }
  }

  return { rpc, aggregator: !!kyber, inspect, buy, sell, call, claim, transfer, detect, ctxFor, lookCtx, tokenMeta, heldBy };
}

export { WEI, ZERO, decode };
