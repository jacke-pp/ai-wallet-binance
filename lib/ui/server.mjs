// `aiwb ui`: a trading page on your own computer. It is the same engine as the commands, behind a small web server that
// only listens on 127.0.0.1 and only answers requests carrying a random key made when it starts (the page gets it in
// the link that opens it). Binance's App does the sign-in (QR code) and every signature; this page never sees a key.
// Market data (price, chart) comes from Binance's public Web3 endpoints; trading goes through `baw` as always.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { check } from '../check.mjs';
import { journal, pnl, loadSnipes, saveSnipes, loadConfig } from '../store.mjs';
import { addSnipe, run as runSnipes, SELL_WARNING } from '../snipe.mjs';
import { fromWei, AGENT_ID } from '../engine.mjs';
import { isAddress } from '../abi.mjs';
import { createTrenches } from './trenches.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const qrcode = createRequire(import.meta.url)('./qrcode.cjs');
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://bin.bnbstatic.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const json = v => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const UA = { 'accept-encoding': 'identity', 'user-agent': 'binance-web3/2.0 (Skill)' };
async function getJson(url, ms = 6000, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  const opts = body ? { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: UA };
  try { return await (await fetch(url, { ...opts, signal: ctl.signal })).json(); } finally { clearTimeout(t); }
}
// Price, market cap, holders and logo from Binance's public token data (null for coins it hasn't indexed yet).
async function market(token) {
  const d = (await getJson(`https://web3.binance.com/bapi/defi/v4/public/wallet-direct/buw/wallet/market/token/dynamic/info/ai?chainId=56&contractAddress=${token}`).catch(() => null))?.data;
  const m = (await getJson(`https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/dex/market/token/meta/info/ai?chainId=56&contractAddress=${token}`).catch(() => null))?.data;
  if (!d && !m) return null;
  const n = x => (x == null || x === '' ? null : Number(x));
  return { price: n(d?.price), marketCap: n(d?.marketCap), holders: n(d?.holders), volume24h: n(d?.volume24h), change24h: n(d?.percentChange24h),
    created: n(m?.createTime), bnbUsd: n(d?.nativeTokenPrice),
    icon: m?.icon ? `https://bin.bnbstatic.com${m.icon}` : null, links: (m?.links || []).filter(l => /^https:\/\//.test(l?.link || '')).map(l => ({ label: l.label, link: l.link })).slice(0, 6) };
}
// Four.meme coins that just moved to PancakeSwap (Binance's meme-rush list, "migrated"; Four.meme is protocol 2001).
async function migratedFour() {
  const r = await getJson('https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/rank/list/ai', 8000, { chainId: '56', rankType: 30, limit: 100, protocol: [2001] });
  return Array.isArray(r?.data) ? r.data : [];
}
const INTERVALS = new Set(['1s', '1min', '5min', '15min', '1h', '4h', '1d']);
async function candles(token, interval) {
  const r = await getJson(`https://dquery.sintral.io/u-kline/v1/k-line/candles?platform=bsc&address=${token}&interval=${interval}&limit=300`).catch(() => null);
  // [open, high, low, close, volume, time ms, trades]
  return (r?.data || []).map(c => ({ o: c[0], h: c[1], l: c[2], c: c[3], v: c[4], t: c[5] }));
}

export async function startUi({ cfg, rpc, wallet, createEngine, port = 0, log = console.log }) {
  const key = randomBytes(24).toString('hex');
  let stopped = false;
  const clients = new Set();
  const emit = (type, data) => { const msg = `event: ${type}\ndata: ${json(data)}\n\n`; for (const c of clients) c.write(msg); };
  const appWaitSec = cfg.appWaitSec ?? 600;
  const engine = createEngine({ rpc, wallet, cfg, onAppWait: label => emit('app', { label, waitSec: appWaitSec, at: Date.now() }) });

  // ---- the trenches board: coins on the agent-only launchpads, new / nearly full / launched ----
  const trenches = createTrenches({ rpc, market, migrated: migratedFour, emit });

  // ---- snipes run inside this process while the page is open ----
  const snipeLog = [];
  const snipeSay = (...a) => { const line = { at: Date.now(), text: a.join(' ') }; snipeLog.push(line); snipeLog.splice(0, snipeLog.length - 100); emit('snipe', line); };
  let snipesRunning = null;
  try {
    snipesRunning = runSnipes({ engine, rpc, log: snipeSay, keepAlive: true, stopped: () => stopped }).catch(e => { snipeSay(`snipes stopped: ${e.message}`); snipesRunning = null; });
  } catch (e) { snipeSay(e.message); }

  // ---- wallet state, cached briefly ----
  let stateCache = null;
  async function state(fresh = false) {
    if (!fresh && stateCache && Date.now() - stateCache.at < 15_000) return stateCache.v;
    const v = { signedIn: false, appWaitSec, cfg: { slippagePct: cfg.slippagePct, maxPerTradeBnb: cfg.maxPerTradeBnb ?? null, dailyCapBnb: cfg.dailyCapBnb ?? null } };
    try {
      const st = await wallet.status();
      v.signedIn = st?.status === 'CONNECTED';
      if (v.signedIn) {
        v.address = await wallet.address();
        const [bnb, aid, s] = await Promise.all([rpc.balance(v.address).catch(() => null), rpc.read(AGENT_ID, 'balanceOf(address)', [v.address], ['uint256']).catch(() => null), wallet.settings().catch(() => null)]);
        v.bnb = bnb == null ? null : fromWei(bnb);
        v.agentId = aid == null ? null : aid > 0n;
        if (s) v.settings = { devMode: !!s.devMode?.enabled, devModeUntil: s.devMode?.expiresAt || null, riskyTx: s.abnormalTxnHandling || null, tradeAllTokens: !!s.tradeAllTokens, sessionEnds: s.sessionExpireTime || null };
      }
    } catch (e) { v.error = e.message; }
    stateCache = { at: Date.now(), v };
    return v;
  }

  // Curve shares of a Flap agent coin that launched and that this wallet has not claimed yet.
  async function unclaimed(info) {
    const from = info?.launchedFrom;
    if (!from?.handler?.held) return null;
    const ctx = await engine.lookCtx();
    if (ctx.noWallet) return null;
    const shares = await from.handler.held(ctx, from).catch(() => null);
    return shares ? { market: from.market, shares: fromWei(shares) } : null;
  }

  async function tokenView(ca) {
    const [inspect, mk] = await Promise.all([engine.inspect(ca), market(ca)]);
    const i = inspect.info;
    return {
      coin: i?.launchedFrom ? i.token : ca, claim: await unclaimed(i),
      token: ca, symbol: inspect.symbol, decimals: inspect.decimals, held: inspect.held == null ? null : fromWei(inspect.held, inspect.decimals, inspect.decimals),
      walletBnb: inspect.walletBnb == null ? null : fromWei(inspect.walletBnb), hasAgentId: inspect.hasAgentId,
      info: i && { platform: i.platform, phase: i.phase, agentOnly: !!i.agentOnly, notTradable: !!i.notTradable, buyTaxPct: i.buyTaxPct ?? null, sellTaxPct: i.sellTaxPct ?? null,
        openingFeePct: i.openingFeePct ?? null, progress: i.progress ?? null, quoteSymbol: i.quoteSymbol ?? null, unit: i.unit || 'coins', name: i.name ?? null, launchedToken: i.launchedToken ?? null, predictedToken: i.predictedToken ?? null, market: i.market ?? null },
      market: mk,
    };
  }

  // What the wallet holds, from the journal, with live balances and value where Binance has a price.
  async function holdings() {
    const rows = pnl().filter(p => p.heldTokens > 0).slice(-30);
    return Promise.all(rows.map(async p => {
      const [view, mk] = await Promise.all([engine.inspect(p.token).catch(() => null), market(p.token)]);
      const held = view?.held != null ? Number(fromWei(view.held, view.decimals, 8)) : p.heldTokens;
      return { ...p, held, claim: await unclaimed(view?.info), platform: view?.info?.platform || null, phase: view?.info?.phase || null, price: mk?.price ?? null, icon: mk?.icon ?? null,
        valueUsd: mk?.price != null ? held * mk.price : null };
    })).then(list => list.filter(p => p.held > 0 || Number(p.claim?.shares) > 0)); // sold outside aiwb (e.g. in the Binance App): drop it
  }

  async function trade(job, fn) {
    try {
      const r = await fn();
      stateCache = null; emit('trade', { job, ok: true, result: r });
      return r;
    } catch (e) { emit('trade', { job, ok: false, error: e.message }); throw e; }
  }

  const routes = {
    'GET /api/state': async (q) => state(q.fresh === '1'),
    'POST /api/login': async () => {
      const s = await wallet.signin();
      if (s?.status === 'ALREADY_CONNECTED') return { connected: true };
      if (!s?.urlForWeb || !s?.qrCodeId) throw new Error('Binance did not return a sign-in code. Try again.');
      const qr = qrcode(0, 'M'); qr.addData(s.urlForWeb); qr.make();
      wallet.verify(s.qrCodeId).then(() => { stateCache = null; emit('login', { ok: true }); }).catch(e => emit('login', { ok: false, error: e.message }));
      return { qrSvg: qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true }), url: s.urlForWeb, pairingCode: s.pairingCode ?? null, expireAt: s.expireAt ?? null };
    },
    'GET /api/token': async (q) => { if (!isAddress(q.ca)) throw new Error('Paste a contract address (0x followed by 40 characters).'); return tokenView(q.ca); },
    'GET /api/check': async (q) => { if (!isAddress(q.ca)) throw new Error('bad address'); return check(engine, q.ca); },
    'GET /api/candles': async (q) => { if (!isAddress(q.ca)) throw new Error('bad address'); return candles(q.ca, INTERVALS.has(q.interval) ? q.interval : '1min'); },
    // A trade can wait minutes for a confirmation in the Binance App, so its result is also pushed as an event (with the
    // page's own job id) in case the browser gives up on the request first.
    'POST /api/buy': async (_, b) => trade(b.job, () => {
      if (!isAddress(b.ca)) throw new Error('bad address');
      const bnb = Number(b.bnb);
      if (!(bnb > 0)) throw new Error('Enter how much BNB to spend.');
      return engine.buy(b.ca, String(bnb), { slippagePct: b.slippagePct ? Number(b.slippagePct) : undefined, source: 'ui' });
    }),
    'POST /api/sell': async (_, b) => trade(b.job, () => {
      if (!isAddress(b.ca)) throw new Error('bad address');
      const pct = Number(b.percent);
      if (!(pct > 0 && pct <= 100)) throw new Error('Choose how much to sell (1 to 100%).');
      return engine.sell(b.ca, { percent: pct }, { slippagePct: b.slippagePct ? Number(b.slippagePct) : undefined, source: 'ui' });
    }),
    'POST /api/claim': async (_, b) => { if (!isAddress(b.ca)) throw new Error('bad address'); return trade(b.job, () => engine.claim(b.ca)); },
    'GET /api/trenches': async () => trenches.list(),
    'GET /api/holdings': async () => holdings(),
    'GET /api/journal': async () => journal().slice(-100).reverse(),
    'GET /api/snipes': async () => ({ list: loadSnipes(), log: snipeLog, running: !!snipesRunning, warning: SELL_WARNING }),
    'POST /api/snipes': async (_, b) => {
      // Same rules as the command: every number comes from the user, nothing has a default.
      const flags = { bnb: b.bnb, 'daily-cap': b.dailyCap, 'max-tax': b.maxTax, count: b.count, platform: b.platform, name: b.name || undefined, creator: b.creator || undefined };
      for (const k of Object.keys(flags)) if (flags[k] === '' || flags[k] == null) delete flags[k];
      const s = addSnipe(b.kind === 'token' ? 'token' : 'watch', flags, b.kind === 'token' ? [b.ca] : []);
      const all = loadSnipes(); all.push(s); saveSnipes(all);
      return s;
    },
    'POST /api/snipes/stop': async (_, b) => {
      const all = loadSnipes(), s = all.find(x => x.id === b.id);
      if (!s) throw new Error('no such snipe');
      s.active = false; saveSnipes(all); return s;
    },
  };

  const okKey = v => { const a = Buffer.from(String(v || '')), b = Buffer.from(key); return a.length === b.length && timingSafeEqual(a, b); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const sec = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
    // Only this computer's own browser, by this address: blocks other websites (and DNS rebinding) from reaching it.
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403, sec); return res.end(); }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) { res.writeHead(403, sec); return res.end(); }

    if (req.method === 'GET' && FILES[url.pathname]) {
      const [f, type] = FILES[url.pathname];
      res.writeHead(200, { ...sec, 'content-type': type, 'content-security-policy': CSP });
      return res.end(readFileSync(join(here, f)));
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404, sec); return res.end(); }
    if (!okKey(req.headers['x-aiwb-key'] || url.searchParams.get('k'))) { res.writeHead(401, { ...sec, 'content-type': 'application/json' }); return res.end(json({ error: 'This page link is out of date. Open the link aiwb ui printed.' })); }

    if (url.pathname === '/api/events') {
      res.writeHead(200, { ...sec, 'content-type': 'text/event-stream', connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) { res.writeHead(404, { ...sec, 'content-type': 'application/json' }); return res.end(json({ error: 'not found' })); }
    let body = {};
    if (req.method === 'POST') {
      if (!/^application\/json/.test(req.headers['content-type'] || '')) { res.writeHead(415, sec); return res.end(); }
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) { res.writeHead(413, sec); return res.end(); } }
      try { body = JSON.parse(raw || '{}'); } catch { res.writeHead(400, sec); return res.end(); }
    }
    try {
      const out = await route(Object.fromEntries(url.searchParams), body);
      res.writeHead(200, { ...sec, 'content-type': 'application/json' });
      res.end(json(out));
    } catch (e) {
      res.writeHead(400, { ...sec, 'content-type': 'application/json' });
      res.end(json({ error: e.message, code: e.code || null }));
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const link = `http://127.0.0.1:${server.address().port}/#k=${key}`;
  trenches.start();
  return { server, link, close: () => { stopped = true; trenches.stop(); for (const c of clients) c.end(); server.close(); } };
}
