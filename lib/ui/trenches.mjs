// The trenches board on the trading page: coins on the three agent-only launchpads (Four, Flap ID Agent Curve, GANG),
// read straight from the chain and sorted into new / nearly full / launched. Progress is each launchpad's own number:
// BNB raised against the coin's target on Four, the market's progress on Flap, quote coin raised against the amount
// that fills the curve on GANG. Holders, market cap and logos come from Binance's public token data when it has them.
// Reads are batched (up to 20 calls a request), each launchpad is polled on its own timer and a launchpad that errors
// waits longer each time, so free public nodes keep up.
import { decode, same, ZERO } from '../abi.mjs';
import { FOUR_AGENT, four, flapAgent } from '../agentpads.mjs';
import { gangReads, curveState } from '../platforms/gang.mjs';

const BLOCK_MS = 450; // BNB Chain makes a block about every 0.45 s
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
export const SOON_PCT = 30; // a curve at least this full is "nearly full"
const FOUR_BACKFILL = 8000n; // about an hour of Four coins when the page starts
const LOG_STEP = 2000n;
const QUIET_MS = 6 * 3600e3; // Four coins with no trade for this long (and not nearly full) leave the board

const sleep = ms => new Promise(r => setTimeout(r, ms).unref?.()); // never keeps aiwb running by itself
const units = (x, d = 18) => (x == null ? null : Number(x) / 10 ** d);
const uint = raw => (raw && raw.length > 2 ? BigInt(raw.slice(0, 66)) : null);
const addr = raw => (raw && raw.length >= 66 ? '0x' + raw.slice(26, 66) : null);
const text = raw => { try { return raw && raw.length > 2 ? String(decode(['string'], raw)[0]).slice(0, 40) : ''; } catch { return ''; } };
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

// market(coin) -> Binance's token data or null; migrated() -> Binance's list of Four coins that just moved to PancakeSwap
// (the chain has no cheap way to find those). Both are optional.
export function createTrenches({ rpc, market = async () => null, migrated = async () => [], emit = () => {} }) {
  const items = new Map(); // id (lower-case address the launchpad trades) -> what the page shows
  const seen = new Map(); // id -> bookkeeping the page doesn't need
  const changed = new Set();
  const quoteSyms = new Map([[ZERO, 'BNB'], [WBNB, 'BNB']]);
  let stopped = false, head = 0n, headAt = 0, bnbUsd = null;

  const calls = list => (rpc.batch ? rpc.batch(list) : Promise.all(list.map(c => Promise.resolve().then(() => rpc.call(c)).catch(() => null))));
  const timeOf = block => (block == null || !head ? null : headAt - Number(head - BigInt(block)) * BLOCK_MS);
  const book = id => seen.get(id) || (seen.set(id, {}), seen.get(id));
  async function tickHead() {
    if (Date.now() - headAt < 2000) return;
    head = await rpc.blockNumber(); headAt = Date.now();
  }
  async function quoteSym(q) {
    const k = String(q || ZERO).toLowerCase();
    if (!quoteSyms.has(k)) { const sym = text(await rpc.call({ to: k, data: '0x95d89b41' }).catch(() => null)); if (!sym) return undefined; quoteSyms.set(k, sym); } // symbol()
    return quoteSyms.get(k);
  }
  function put(id, patch) {
    const cur = items.get(id) || { id };
    let diff = !items.has(id);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && cur[k] !== v) { cur[k] = v; diff = true; }
    if (!diff) return cur;
    cur.stage = cur.launched ? 'launched' : (cur.progress ?? 0) >= SOON_PCT ? 'soon' : 'new';
    items.set(id, cur); changed.add(id);
    return cur;
  }
  function drop(id) { if (items.delete(id)) { seen.delete(id); changed.add(id); } }

  // ---- Four: creation and trade events from FourCore, filtered to the agent template ----
  let fourFrom = null;
  const fourNew = new Set();
  async function four_() {
    await tickHead();
    if (fourFrom == null) fourFrom = head > FOUR_BACKFILL ? head - FOUR_BACKFILL : 0n;
    while (fourFrom <= head && !stopped) {
      const to = fourFrom + LOG_STEP - 1n < head ? fourFrom + LOG_STEP - 1n : head;
      const logs = await rpc.logs({ address: FOUR_AGENT.core, topics: [[FOUR_AGENT.created.topic0, FOUR_AGENT.trade.topic0]], fromBlock: fourFrom, toBlock: to });
      for (const l of logs || []) {
        if (l.topics[0] === FOUR_AGENT.created.topic0) {
          if (l.topics[1] !== FOUR_AGENT.created.topics[1]) continue;
          const c = four.parse.created(l), id = c.token.toLowerCase();
          if (!items.get(id)?.symbol) fourNew.add(id);
          put(id, { platform: 'four-agent', token: c.token, coin: c.token, creator: c.creator, created: timeOf(c.block) });
        } else if (l.topics[0] === FOUR_AGENT.trade.topic0) {
          const tr = four.parse.trade(l);
          if (tr.template !== FOUR_AGENT.template) continue;
          const id = tr.token.toLowerCase(), it = items.get(id);
          if (!it?.symbol) fourNew.add(id);
          book(id).traded = timeOf(tr.block) ?? Date.now(); book(id).price = units(tr.price);
          put(id, { platform: 'four-agent', token: tr.token, coin: tr.token, raised: units(tr.raised), progress: it?.target ? Math.min(100, (units(tr.raised) / it.target) * 100) : undefined });
        }
      }
      fourFrom = to + 1n;
    }
    // Details for coins seen for the first time: the record (creator, target, vault), name, symbol, taxes.
    const ids = [...fourNew].slice(0, 40);
    if (ids.length) {
      const per = 5, res = await calls(ids.flatMap(id => [four.reads.record(id), { to: id, data: '0x06fdde03' }, { to: id, data: '0x95d89b41' }, four.reads.buyFeeRate(id), four.reads.sellFeeRate(id)]));
      const vaults = [];
      ids.forEach((id, k) => {
        const [rec, name, sym, bf, sf] = res.slice(k * per, k * per + per);
        if (!rec) return; // try again next round
        fourNew.delete(id);
        const r = four.parse.record(rec);
        if (!r || r.template !== FOUR_AGENT.template) return drop(id);
        const it = items.get(id), target = units(r.target);
        book(id).supply = units(r.supply);
        put(id, { name: it?.name || text(name), symbol: it?.symbol || text(sym), creator: r.creator, quote: 'BNB', target, created: it?.created ?? timeOf(r.createdBlock),
          buyTax: bf ? 1 + Number(uint(bf)) / 100 : null, sellTax: sf ? 1 + Number(uint(sf)) / 100 : null,
          progress: it?.raised != null && !it.launched ? Math.min(100, (it.raised / target) * 100) : undefined });
        if (it?.raised == null && !it?.launched) vaults.push([id, r.vault]);
      });
      const raised = await calls(vaults.map(([id, v]) => four.reads.raised(v, id)));
      vaults.forEach(([id], k) => { const v = units(uint(raised[k])), it = items.get(id); if (v != null && it?.target) put(id, { raised: v, progress: Math.min(100, (v / it.target) * 100) }); });
    }
    // A full curve moves to PancakeSwap: confirm with tokenPhase (3 = pool).
    const full = [...items.values()].filter(it => it.platform === 'four-agent' && !it.launched && it.progress >= 99 && Date.now() - (book(it.id).phaseAt || 0) > 15000);
    if (full.length) {
      const res = await calls(full.map(it => four.reads.phase(it.token)));
      full.forEach((it, k) => { book(it.id).phaseAt = Date.now(); if (uint(res[k]) === FOUR_AGENT.phase.pool) put(it.id, { launched: true, launchedAt: book(it.id).traded || Date.now() }); });
    }
    for (const it of items.values()) {
      if (it.platform !== 'four-agent') continue;
      const b = book(it.id);
      if (b.price != null && b.supply && bnbUsd && !b.binanceCap) put(it.id, { mcap: b.price * b.supply * bnbUsd });
      const last = b.traded || it.created || 0;
      if (!it.launched && (it.progress ?? 0) < SOON_PCT && Date.now() - last > QUIET_MS) drop(it.id);
    }
  }
  // Four coins that already moved to PancakeSwap, from Binance's list, kept to the agent template.
  const notAgent = new Set();
  async function fourLaunched() {
    const list = (await migrated().catch(() => null) || []).filter(x => /^0x[0-9a-fA-F]{40}$/.test(x?.contractAddress || '') && !notAgent.has(x.contractAddress.toLowerCase()));
    const fresh = list.filter(x => !items.get(x.contractAddress.toLowerCase())?.launched);
    const recs = await calls(fresh.map(x => four.reads.record(x.contractAddress)));
    fresh.forEach((x, k) => {
      const id = x.contractAddress.toLowerCase(), r = recs[k] && four.parse.record(recs[k]);
      if (!recs[k]) return;
      if (!r || r.template !== FOUR_AGENT.template) return notAgent.add(id);
      const n = v => (v == null || v === '' ? undefined : Number(v));
      put(id, { platform: 'four-agent', token: x.contractAddress, coin: x.contractAddress, name: String(x.name || '').slice(0, 40), symbol: String(x.symbol || '').slice(0, 40),
        creator: r.creator, quote: 'BNB', target: units(r.target), progress: 100, launched: true, launchedAt: n(x.migrateTime) ?? Date.now(), created: n(x.createTime),
        holders: n(x.holders), mcap: n(x.marketCap), icon: x.icon ? `https://bin.bnbstatic.com${x.icon}` : undefined });
      if (n(x.marketCap) != null) book(id).binanceCap = true;
      fourNew.add(id); // taxes
    });
  }

  // ---- Flap ID Agent Curve: every market the factory made, with the reader's details ----
  const flapMarkets = [];
  async function flap() {
    await tickHead();
    const n = Number(uint((await calls([flapAgent.reads.count()]))[0]) ?? 0n);
    if (n > flapMarkets.length) {
      const idx = []; for (let i = flapMarkets.length; i < n; i++) idx.push(i);
      for (const r of await calls(idx.map(i => flapAgent.reads.marketAt(i)))) { const a = addr(r); if (!a) break; flapMarkets.push(a); }
    }
    const named = flapMarkets.filter(m => !items.get(m)?.symbol);
    for (const part of chunks(named, 5)) {
      const [raw] = await calls([flapAgent.reads.cards(part)]);
      if (!raw) continue;
      for (const c of flapAgent.parse.cards(raw)) put(c.market.toLowerCase(), { platform: 'flap-agent', token: c.market, name: String(c.name).slice(0, 40), symbol: String(c.symbol).slice(0, 40), quote: await quoteSym(c.quote) });
    }
    const now = Date.now();
    const due = flapMarkets.filter(m => { const it = items.get(m), b = book(m); return it?.symbol && (!b.detailAt || (!it.launched && now - b.detailAt > 15000)); });
    const res = await calls(due.map(m => flapAgent.reads.detail(m)));
    due.forEach((m, k) => {
      const d = flapAgent.parse.detail(res[k]);
      if (!d) return;
      book(m).detailAt = now;
      const launched = d.phase !== 1;
      put(m, { creator: d.creator, raised: units(d.pool, d.decimals), target: units(d.cap, d.decimals), progress: Math.min(100, d.progress), launched,
        launchedAt: d.launchedAt ? d.launchedAt * 1000 : launched ? items.get(m)?.launchedAt ?? now : null, coin: launched && !same(d.token, ZERO) ? d.token : null,
        holders: launched ? undefined : d.holders, created: items.get(m)?.created ?? timeOf(d.startBlock), buyTax: d.buyFeeBps / 100, sellTax: d.sellFeeBps / 100 });
    });
  }

  // ---- GANG: every coin the launchpad made and its curve ----
  const gangTokens = [];
  async function gang() {
    const n = Number(uint((await calls([gangReads.count()]))[0]) ?? 0n);
    if (n > gangTokens.length) {
      const idx = []; for (let i = gangTokens.length; i < n; i++) idx.push(i);
      for (const r of await calls(idx.map(i => gangReads.tokenAt(i)))) { const a = addr(r); if (!a) break; gangTokens.push(a); }
    }
    const unnamed = gangTokens.filter(t => !items.get(t)?.symbol);
    const names = await calls(unnamed.flatMap(t => [{ to: t, data: '0x06fdde03' }, { to: t, data: '0x95d89b41' }]));
    unnamed.forEach((t, k) => { if (names[k * 2 + 1]) put(t, { platform: 'gang', token: t, coin: t, name: text(names[k * 2]), symbol: text(names[k * 2 + 1]), buyTax: 1, sellTax: 1 }); });
    const due = gangTokens.filter(t => items.get(t)?.symbol && !items.get(t).launched);
    const res = await calls(due.map(t => gangReads.curve(t)));
    for (let k = 0; k < due.length; k++) {
      const c = curveState(res[k]);
      if (!c) continue;
      const t = due[k], wasOpen = book(t).read && !items.get(t).launched;
      book(t).read = true;
      put(t, { creator: c.creator, quote: await quoteSym(c.quote), raised: units(c.raised), target: units(c.target),
        progress: c.target > 0n ? Math.min(100, (units(c.raised) / units(c.target)) * 100) : null, launched: c.graduated, launchedAt: c.graduated && wasOpen ? Date.now() : undefined });
    }
  }

  // ---- Binance's token data for the coins on the board: holders, market cap, logo, age ----
  async function binance() {
    const now = Date.now(), rank = { soon: 0, launched: 1, new: 2 };
    const next = [...items.values()].filter(it => it.coin && now - (book(it.id).marketAt || 0) > (it.stage === 'new' ? 120e3 : 60e3))
      .sort((a, b) => rank[a.stage] - rank[b.stage] || (b.created || 0) - (a.created || 0))[0];
    if (!next) return false;
    const b = book(next.id);
    b.marketAt = now;
    const m = await market(next.coin).catch(() => null);
    if (m?.bnbUsd) bnbUsd = m.bnbUsd;
    if (m) {
      if (m.marketCap != null) b.binanceCap = true;
      put(next.id, { holders: m.holders ?? undefined, mcap: m.marketCap ?? undefined, icon: m.icon || undefined, created: next.created ?? m.created ?? undefined });
    }
    return true;
  }

  async function every(fn, ms) {
    let wait = ms;
    while (!stopped) {
      try { const busy = await fn(); wait = busy === false ? ms * 2 : ms; } catch { wait = Math.min(wait * 2, 60_000); }
      await sleep(wait);
    }
  }
  function start() {
    every(four_, 3000); every(fourLaunched, 60_000); every(flap, 6000); every(gang, 10_000); every(binance, 1200);
    (async () => { while (!stopped) { await sleep(1000); if (!changed.size) continue; const ids = [...changed]; changed.clear(); emit('trench', ids.map(id => items.get(id) || { id, removed: true })); } })();
  }
  return { start, stop: () => { stopped = true; }, list: () => ({ items: [...items.values()], bnbUsd }) };
}
