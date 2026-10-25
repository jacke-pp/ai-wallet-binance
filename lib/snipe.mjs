// Snipes. Two kinds, both set up ahead of time and run by `aiwb snipe run` (keep it running on your computer/server):
//   token  - one coin you already know (its address): buy as soon as it can be bought and its tax is low enough.
//   watch  - new coins on agent-only launchpads: buy the ones that match (creator address, name/symbol words, time
//            window), up to N coins. "Grab the first N when the platform opens" is a watch with no filters.
// No default amounts: every snipe must say how much per coin, how many coins, the daily cap and the highest tax
// it accepts. The AI must ask you for each of these before it sets one up.
import { randomUUID } from 'node:crypto';
import { loadSnipes, saveSnipes, spentToday, lock } from './store.mjs';
import { fromWei, toWei } from './engine.mjs';
import { LAUNCHPADS } from './platforms/index.mjs';

export const SELL_WARNING = 'Heads-up: while a coin is still on its agent-only curve, Binance may refuse to let an AI wallet sell it. Expect to hold until it graduates to PancakeSwap, and only snipe what you can afford to hold.';

const need = (flags, k, what) => {
  if (flags[k] === undefined || flags[k] === true) throw new Error(`missing --${k} (${what}). There is no default: ask the user.`);
  const n = Number(flags[k]);
  if (!(n >= 0) || (k !== 'max-tax' && !(n > 0))) throw new Error(`--${k} must be a ${k === 'max-tax' ? 'non-negative' : 'positive'} number`);
  return n;
};

export function addSnipe(kind, flags, pos = []) {
  const base = {
    id: randomUUID().slice(0, 8), kind, createdAt: new Date().toISOString(), active: true, bought: [],
    bnb: need(flags, 'bnb', 'BNB to spend per coin'),
    dailyCapBnb: need(flags, 'daily-cap', 'most BNB all snipes may spend per day'),
    maxTaxPct: need(flags, 'max-tax', 'highest buy tax in % it will accept; it waits for the tax to fall to this'),
    delaySec: flags.delay ? Number(flags.delay) : 0,
    slippagePct: flags.slippage ? Number(flags.slippage) : null,
    maxSellTaxPct: flags['max-sell-tax'] != null ? Number(flags['max-sell-tax']) : null,
    gasLimit: flags['gas-limit'] ? Number(flags['gas-limit']) : null,
    speedUpAfterSec: flags['speed-up'] ? Number(flags['speed-up']) : null,
    waitSec: flags['wait'] ? Number(flags['wait']) : 120,
  };
  if (base.bnb > base.dailyCapBnb) throw new Error('--bnb is larger than --daily-cap');
  if (kind === 'token') {
    const token = pos[0];
    if (!/^0x[0-9a-fA-F]{40}$/.test(token || '')) throw new Error('usage: aiwb snipe add token <CA> --bnb <x> --daily-cap <y> --max-tax <t>');
    return { ...base, token, maxCoins: 1 };
  }
  if (kind === 'watch') {
    const platforms = String(flags.platform || 'all').split(',').map(s => s.trim());
    for (const p of platforms) if (p !== 'all' && !LAUNCHPADS[p]) throw new Error(`unknown --platform ${p}. Known: ${Object.keys(LAUNCHPADS).join(', ')}, all`);
    return {
      ...base, platforms,
      maxCoins: need(flags, 'count', 'how many coins to buy at most'),
      creator: flags.creator ? String(flags.creator).toLowerCase().split(',') : null,
      words: flags.name ? String(flags.name).toLowerCase().split(',') : null,
      from: flags.from ? Date.parse(flags.from) : null,
      until: flags.until ? Date.parse(flags.until) : null,
    };
  }
  throw new Error('kinds: token, watch');
}

// Does a new coin match this watch?
export function matches(s, coin, now = Date.now()) {
  if (!s.active || s.kind !== 'watch') return false;
  if (s.bought.length >= s.maxCoins) return false;
  if (!s.platforms.includes('all') && !s.platforms.includes(coin.platform)) return false;
  if (s.creator && !s.creator.includes(String(coin.creator).toLowerCase())) return false;
  if (s.words) {
    const text = `${coin.name || ''} ${coin.symbol || ''}`.toLowerCase();
    if (!s.words.some(w => text.includes(w))) return false;
  }
  if (s.from && now < s.from) return false;
  if (s.until && now > s.until) return false;
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// Wait until the coin's buy tax is at or under the limit (launch taxes fall over the first seconds), then buy.
async function snipeBuy(engine, s, token, platformHint) {
  if (s.delaySec) await sleep(s.delaySec * 1000);
  const ctx = await engine.ctxFor();
  const end = Date.now() + s.waitSec * 1000;
  for (;;) {
    const info = await engine.detect(ctx, token).catch(() => null);
    if (info && (info.buyTaxPct == null || info.buyTaxPct <= s.maxTaxPct)) {
      const spent = spentToday(undefined, Date.now(), { snipesOnly: true });
      if (spent + s.bnb > s.dailyCapBnb + 1e-12) throw new Error(`daily cap ${s.dailyCapBnb} BNB reached (snipes spent ${spent.toFixed(4)} today)`);
      return engine.buy(token, String(s.bnb), { info, maxTaxPct: s.maxTaxPct, maxSellTaxPct: s.maxSellTaxPct ?? undefined, slippagePct: s.slippagePct ?? undefined, gasLimit: s.gasLimit ?? undefined, speedUpAfterSec: s.speedUpAfterSec ?? undefined, limits: { snipeDailyCapBnb: s.dailyCapBnb }, source: `snipe:${s.id}`, appWait: false });
    }
    if (Date.now() > end) throw new Error(info ? `tax stayed at ${info.buyTaxPct}% (limit ${s.maxTaxPct}%) for ${s.waitSec}s, skipped` : `not buyable within ${s.waitSec}s, skipped`);
    await sleep(info ? 300 : 1000);
  }
}

// keepAlive: keep running with no active snipes and pick up new ones as they are added (the page does this).
export async function run({ engine, rpc, pollMs = 1000, once = false, log = say, keepAlive = false, stopped = () => false }) {
  let list = loadSnipes().filter(s => s.active);
  if (!list.length && !keepAlive) return log('no active snipes. Add one: aiwb snipe add ...');
  lock('snipes');
  log(`running ${list.length} snipe(s). ${SELL_WARNING}`);
  const busy = new Set(), inflight = new Map(); // in flight per snipe, so a burst of launches can't pass --count
  const finish = (s, entry) => {
    const all = loadSnipes(), cur = all.find(x => x.id === s.id);
    if (!cur) return;
    if (entry) cur.bought.push({ token: entry.token, hash: entry.hash, bnb: entry.bnb, at: entry.at });
    if (cur.bought.length >= cur.maxCoins) cur.active = false;
    saveSnipes(all);
  };
  const fire = (s, token, why) => {
    const key = `${s.id}:${token.toLowerCase()}`;
    if (busy.has(key) || s.bought.some(b => b.token.toLowerCase() === token.toLowerCase())) return;
    if (s.bought.length + (inflight.get(s.id) || 0) >= s.maxCoins) return;
    busy.add(key);
    inflight.set(s.id, (inflight.get(s.id) || 0) + 1);
    const done = () => inflight.set(s.id, inflight.get(s.id) - 1);
    log(`[${s.id}] ${why}: ${token}`);
    snipeBuy(engine, s, token).then(r => { done(); log(`[${s.id}] bought ${r.tokens} ${r.symbol} for ${r.bnb} BNB in ${(r.ms / 1000).toFixed(1)}s ${r.hash}`); s.bought.push({ token }); finish(s, r); })
      .catch(e => { done(); log(`[${s.id}] ${token}: ${e.message}`); if (/daily cap/.test(e.message)) busy.delete(key); });
  };

  // Single-coin snipes: check every couple of seconds whether the coin exists and trades yet.
  const tokenLoop = async () => {
    while (!stopped()) {
      for (const s of list.filter(x => x.kind === 'token' && x.active && !x.bought.length)) {
        const code = await rpc.code(s.token).catch(() => '0x');
        if (code && code !== '0x') fire(s, s.token, 'coin is live');
      }
      if (once) return;
      await sleep(2000);
      list = loadSnipes().filter(s => s.active);
    }
  };

  // Watches: read new-coin events from each launchpad, block by block.
  const watchLoop = async () => {
    let from = await rpc.blockNumber(), wait = pollMs, lastWarn = 0;
    while (!stopped()) {
      const watches = list.filter(x => x.kind === 'watch' && x.active);
      if (!watches.length) { if (once) return; await sleep(2000); continue; }
      const head = await rpc.blockNumber().catch(() => from - 1n);
      let failed = false;
      if (head >= from) {
        const to = head - from > 20n ? from + 20n : head;
        for (const [key, pad] of Object.entries(LAUNCHPADS)) {
          if (!watches.some(w => w.platforms.includes('all') || w.platforms.includes(key))) continue;
          let logs = [];
          try { logs = await rpc.logs({ fromBlock: from, toBlock: to, address: pad.watch.address, topics: pad.watch.topics }); } catch (e) {
            failed = true;
            if (Date.now() - lastWarn > 60_000) { lastWarn = Date.now(); log(`${key}: the RPC node refused (${e.message}); slowing down and retrying the same blocks. Your own RPC is faster: aiwb config set rpc <url>`); }
            break;
          }
          for (const l of logs) {
            const coin = await pad.watch.parse(l, rpc).catch(() => null);
            if (!coin) continue;
            coin.platform = key;
            for (const w of watches) if (matches(w, coin)) fire(w, coin.token, `new ${key} coin ${coin.symbol || ''} by ${coin.creator}`);
          }
        }
        if (!failed) from = to + 1n; // on failure, read the same blocks again: no coin is skipped
      }
      wait = failed ? Math.min(wait * 2, 5000) : pollMs;
      if (once) return;
      await sleep(wait);
      list = loadSnipes().filter(s => s.active);
    }
  };
  await Promise.all([tokenLoop(), watchLoop()]);
}

export async function cli({ engine, rpc, args, flags, show }) {
  const [sub, kind, ...pos] = args;
  if (!sub || sub === 'help') {
    return console.log(`Snipes (the AI must ask you for every amount; nothing has a default):

  aiwb snipe add token <CA> --bnb 0.05 --daily-cap 0.5 --max-tax 10 [--delay 1] [--wait 120]
      buy one known coin as soon as it trades and its buy tax is <= max-tax

  aiwb snipe add watch --platform ${Object.keys(LAUNCHPADS).join('|')}|all --count 20 --bnb 0.02 --daily-cap 0.5 --max-tax 10
      [--creator 0xDev,...] [--name word,...] [--from 2026-10-26T12:00Z] [--until ...] [--delay 1]
      buy new agent-only coins that match, up to --count coins. No filters = the first N to launch.

  aiwb snipe list            aiwb snipe remove <id>          aiwb snipe run   (keep it running)

${SELL_WARNING}`);
  }
  if (sub === 'add') {
    const s = addSnipe(kind, flags, pos);
    const all = loadSnipes(); all.push(s); saveSnipes(all);
    return show({ snipe: s, warning: SELL_WARNING }, `snipe ${s.id} saved: ${s.kind === 'token' ? s.token : `${s.platforms.join(',')}, up to ${s.maxCoins} coins`}, ${s.bnb} BNB each, at most ${s.dailyCapBnb} BNB/day, tax <= ${s.maxTaxPct}%${s.delaySec ? `, ${s.delaySec}s delay` : ''}.\nStart it with: aiwb snipe run\n${SELL_WARNING}`);
  }
  if (sub === 'list') {
    const all = loadSnipes();
    return show(all, all.map(s => `${s.id}  ${s.active ? 'ACTIVE' : 'done  '}  ${s.kind === 'token' ? s.token : `${s.platforms.join(',')}${s.creator ? ' creator ' + s.creator.join(',') : ''}${s.words ? ' name ' + s.words.join(',') : ''}`}  ${s.bnb} BNB x ${s.maxCoins}, cap ${s.dailyCapBnb}/day, tax<=${s.maxTaxPct}%  bought ${s.bought.length}`).join('\n') || `no snipes. Spent today: ${spentToday().toFixed(4)} BNB`);
  }
  if (sub === 'remove') {
    const id = kind;
    const all = loadSnipes(), left = all.filter(s => s.id !== id);
    if (left.length === all.length) throw new Error(`no snipe ${id}`);
    saveSnipes(left);
    return show({ removed: id }, `removed ${id}`);
  }
  if (sub === 'run') return run({ engine, rpc, once: !!flags.once });
  throw new Error('usage: aiwb snipe add|list|remove|run');
}

export { toWei, fromWei };
