// GMGN market data, read only, with your own GMGN API key (get one at https://gmgn.ai/ai, then
// `aiwb config set gmgnKey <key>`). Charts, token details, security, top holders and the trenches lists.
// Nothing here trades: GMGN orders use GMGN's own wallets, which have no Binance Agent ID, so they cannot buy
// agent-only coins. Trading stays on your Binance AI wallet.
// The key goes only to openapi.gmgn.ai, in the X-APIKEY header. It is never written to the journal or shown.
import { randomUUID } from 'node:crypto';
import { isAddress } from './abi.mjs';

export const GMGN_HOST = 'https://openapi.gmgn.ai';
export const RESOLUTIONS = ['1s', '30s', '1m', '5m', '15m', '1h', '4h', '1d'];
// The trenches lists as GMGN names them: new, about to fill its curve, moved to a DEX pool.
export const TRENCHES = ['new_creation', 'near_completion', 'completed'];
// BNB Chain quote coins the trenches list should include (as GMGN's own client sends them).
const BSC_QUOTE_TYPES = [6, 7, 1, 16, 8, 3, 9, 10, 2, 17, 18, 0];

export class GmgnError extends Error {
  constructor(message, code, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

export function createGmgn({ key, fetchImpl = globalThis.fetch, host = GMGN_HOST, timeoutMs = 10_000, chain = 'bsc', now = () => Date.now() } = {}) {
  if (!key) throw new GmgnError('No GMGN API key set. Get one at https://gmgn.ai/ai, then run: aiwb config set gmgnKey <key>', 'NO_KEY');

  async function request(method, path, query = {}, body = null) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, timestamp: Math.floor(now() / 1000), client_id: randomUUID() })) {
      if (v == null) continue;
      for (const item of Array.isArray(v) ? v : [v]) params.append(k, String(item));
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res, text;
    try {
      res = await fetchImpl(`${host}${path}?${params}`, {
        method, signal: ctl.signal,
        headers: { 'X-APIKEY': key, 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
      text = await res.text();
    } catch (e) {
      throw new GmgnError(`GMGN did not answer (${e.name === 'AbortError' ? 'timed out' : e.message}). Check your network or proxy.`, 'NO_ANSWER');
    } finally { clearTimeout(timer); }
    let j;
    try { j = JSON.parse(text); } catch { throw new GmgnError(`GMGN answered HTTP ${res.status} without data.`, 'BAD_ANSWER', { status: res.status }); }
    if (j.code !== 0) {
      const msg = j.message || j.error || `code ${j.code}`;
      if (res.status === 401 || res.status === 403 || /api.?key|unauthori[sz]ed|forbidden/i.test(msg)) throw new GmgnError(`GMGN refused the API key (${msg}). Check it at https://gmgn.ai/ai.`, 'BAD_KEY', { status: res.status });
      if (res.status === 429 || /rate|limit|quota/i.test(msg)) throw new GmgnError(`GMGN rate limit reached (${msg}). Try again in a moment.`, 'RATE_LIMIT', { status: res.status });
      throw new GmgnError(`GMGN: ${msg}`, 'GMGN_ERROR', { status: res.status, apiCode: j.code });
    }
    return j.data;
  }

  const ca = a => { if (!isAddress(a)) throw new GmgnError(`not a contract address: ${a}`, 'BAD_ADDRESS'); return a; };
  const get = (path, address, extra = {}) => request('GET', path, { chain, address: ca(address), ...extra });

  return {
    request,
    // Candles in USD, at most 100 per call: resolution 1s/30s/1m/5m/15m/1h/4h/1d; from / to in Unix seconds
    // (optional; GMGN itself takes milliseconds). Without them GMGN returns the latest 100.
    async kline(address, { resolution = '1m', from, to } = {}) {
      if (!RESOLUTIONS.includes(resolution)) throw new GmgnError(`resolution is one of ${RESOLUTIONS.join(', ')}`, 'BAD_RESOLUTION');
      const ms = x => (x == null ? undefined : Math.floor(Number(x) * 1000));
      return normalizeCandles(await get('/v1/market/token_kline', address, { resolution, from: ms(from), to: ms(to) }));
    },
    info: address => get('/v1/token/info', address),
    security: address => get('/v1/token/security', address),
    pool: address => get('/v1/token/pool_info', address),
    holders: (address, extra = {}) => get('/v1/market/token_top_holders', address, extra),
    traders: (address, extra = {}) => get('/v1/market/token_top_traders', address, extra),
    // New / about to fill / filled coins on launchpads. `platforms` narrows it (GMGN's launchpad names).
    trenches({ types = TRENCHES, platforms, limit = 80, filters = {} } = {}) {
      const section = { filters: ['offchain', 'onchain'], launchpad_platform_v2: true, limit: Math.min(80, limit), ...filters };
      if (platforms?.length) section.launchpad_platform = platforms;
      if (chain === 'bsc') section.quote_address_type = BSC_QUOTE_TYPES;
      const body = { version: 'v2' };
      for (const t of types) body[t] = { ...section };
      return request('POST', '/v1/trenches', { chain }, body);
    },
    search: q => request('GET', '/v1/market/search', { q, chain }),
  };
}

// GMGN candles come as a list of objects (time in ms or s, open/high/low/close/volume as strings or numbers).
// Returned as [{ t: seconds, o, h, l, c, v }] oldest first, the shape the trading page's chart uses.
export function normalizeCandles(data) {
  const list = Array.isArray(data) ? data : data?.list || data?.candles || data?.klines || [];
  const out = [];
  for (const k of list) {
    const row = Array.isArray(k) ? { time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] } : k;
    let t = Number(row.time ?? row.timestamp ?? row.t);
    if (!(t > 0)) continue;
    if (t > 1e12) t = Math.floor(t / 1000);
    const n = x => Number(x);
    out.push({ t, o: n(row.open ?? row.o), h: n(row.high ?? row.h), l: n(row.low ?? row.l), c: n(row.close ?? row.c), v: n(row.volume ?? row.v ?? 0) });
  }
  return out.sort((a, b) => a.t - b.t);
}
