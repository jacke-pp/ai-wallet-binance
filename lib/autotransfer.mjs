// Automatic sending: once an agent coin you bought can move, send all of it to the address you set (autoSendTo).
//   autoSendFlap   a Flap agent coin launched: claim your shares into the coin, then send the coin
//   autoSendFour   a Four agent coin you bought graduated to PancakeSwap (coins unlock): send it
//   autoSendGang   a GANG coin you bought graduated (locked() turns false): send it
//   autoClaimFlap  only claim launched Flap agent coins into this wallet, no sending
// All off by default. Each switch remembers when it was turned on and only acts on coins bought (or claimed) after
// that, so turning it on never sweeps out older holdings. Each coin is sent once: buying more of it later is yours.
// Only coins bought through aiwb (in the journal) are watched. A failed send is retried after 1, 5 and 15 minutes,
// then left for you (aiwb journal / aiwb send). If Binance asks for a tap in the App, it waits for you.
// One process runs this at a time: the trading page (aiwb ui) or `aiwb autosend run`.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { home, journal, loadConfig, lock } from './store.mjs';
import { same, isAddress } from './abi.mjs';
import { FOUR_AGENT, FLAP_AGENT } from './agentpads.mjs';
import * as flapAgent from './platforms/flapagent.mjs';

export const RETRY_MIN = [1, 5, 15];
const MIN_GAS_BNB = 3n * 10n ** 14n; // 0.0003 BNB: below this a transfer may not pay its gas
const PLATFORM_SWITCH = { 'flap-agent': 'autoSendFlap', 'four-agent': 'autoSendFour', gang: 'autoSendGang' };

const stateFile = () => join(home(), 'autosend.json');
export function loadState() { try { return JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { return {}; } }
function saveState(s) {
  mkdirSync(home(), { recursive: true, mode: 0o700 });
  writeFileSync(stateFile() + '.tmp', JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  renameSync(stateFile() + '.tmp', stateFile());
}

// The coins to watch, from the journal: agent-curve buys (and Flap claims) made after the matching switch went on.
export function candidates(entries, cfg) {
  const out = new Map();
  for (const e of entries) {
    if (e.status !== 'ok' || !e.token) continue;
    const sw = e.kind === 'claim' ? 'autoSendFlap' : e.kind === 'buy' ? PLATFORM_SWITCH[e.platform] : null;
    if (!sw) continue;
    const since = cfg[sw] || (sw === 'autoSendFlap' ? cfg.autoClaimFlap : null);
    if (!since || e.at < since) continue;
    const platform = e.kind === 'claim' ? 'flap-agent' : e.platform;
    const key = `${platform}:${(e.kind === 'claim' ? e.to : e.token).toLowerCase()}`;
    if (!out.has(key)) out.set(key, { platform, addr: e.kind === 'claim' ? e.to : e.token, symbol: e.symbol, since: e.at, claimed: e.kind === 'claim' ? e.token : null });
    else if (e.kind === 'claim') out.get(key).claimed = e.token;
  }
  return [...out.values()];
}

// How a Flap agent market is read (replaceable in tests): the market, whether it launched and into which coin, shares.
const FLAP = {
  marketOf: (rpc, addr) => flapAgent.marketOf(rpc, addr),
  async launched(rpc, market) {
    const c = await flapAgent.card(rpc, market);
    return c.phase === FLAP_AGENT.phaseOpen || !c.token || /^0x0{40}$/.test(c.token) ? null : c.token;
  },
  shares: (rpc, market, me) => rpc.read(market, 'sharesOf(address)', [me], ['uint256']),
};

export function createAutoSend({ engine, rpc, config = loadConfig, log = () => {}, now = () => Date.now(), state = null, save = saveState, flap = FLAP } = {}) {
  const st = state || loadState();
  let timer = null, busy = false, release = null, lowGasWarned = false;

  const put = (key, v) => { st[key] = { ...st[key], ...v, at: new Date(now()).toISOString() }; save(st); };
  const due = r => !r || (r.status === 'retry' && now() >= (r.nextAt || 0));

  async function graduated(c) {
    if (c.platform === 'four-agent') return (await rpc.read(c.addr, 'tokenPhase()', [], ['uint256'])) === FOUR_AGENT.phase.pool;
    if (c.platform === 'gang') return (await rpc.read(c.addr, 'locked()', [], ['bool'])) === false;
    return false;
  }

  async function sendAll(key, coin, symbol, to, me) {
    const [held, bnb] = await Promise.all([rpc.read(coin, 'balanceOf(address)', [me], ['uint256']), rpc.balance(me)]);
    if (held === 0n) return put(key, { status: 'nothing', coin, note: 'nothing left in the wallet to send' });
    if (bnb < MIN_GAS_BNB) {
      if (!lowGasWarned) log(`Auto-send is waiting: the AI wallet has too little BNB for gas to send ${symbol || coin}. Top it up in the Binance App.`);
      lowGasWarned = true;
      return put(key, { status: 'retry', coin, nextAt: now() + 60_000, error: 'not enough BNB for gas' });
    }
    lowGasWarned = false;
    const tries = (st[key]?.tries || 0) + 1;
    try {
      log(`Auto-send: sending all ${symbol || coin} to ${to}...`);
      const r = await engine.transfer(coin, to, {}, { source: 'autosend' });
      put(key, { status: 'sent', coin, to, hash: r.hash, tokens: r.tokens, tries, error: undefined, nextAt: undefined });
      log(`Auto-send: sent ${r.tokens} ${r.symbol} to ${to}  https://bscscan.com/tx/${r.hash}`);
    } catch (e) {
      const wait = RETRY_MIN[tries - 1];
      put(key, { status: wait ? 'retry' : 'failed', coin, tries, error: e.message, nextAt: wait ? now() + wait * 60_000 : undefined });
      log(`Auto-send of ${symbol || coin} failed: ${e.message}${wait ? ` Trying again in ${wait} min.` : ' Gave up: send it yourself with aiwb send.'}`);
    }
  }

  // A coin is done once sent, found empty or given up on; a Flap coin only claimed is picked up again if
  // autoSendFlap goes on later.
  const settled = (r, cfg) => r && (['sent', 'nothing', 'failed'].includes(r.status) || (r.status === 'claimed' && !cfg.autoSendFlap) || !due(r) && r.status !== 'claimed');

  async function one(c, cfg, me) {
    // Flap coins are kept by market: a buy may name the market or the coin's address, a claim names the market.
    const market = c.platform === 'flap-agent' ? await flap.marketOf(rpc, c.addr) : null;
    if (c.platform === 'flap-agent' && !market) return;
    const key = `${c.platform}:${(market || c.addr).toLowerCase()}`;
    const r = st[key];
    if (settled(r, cfg)) return;
    if (c.platform === 'flap-agent') {
      const coin = await flap.launched(rpc, market);
      if (!coin) return; // not launched yet
      const shares = await flap.shares(rpc, market, me).catch(() => 0n);
      if (shares > 0n) {
        try {
          log(`Auto-claim: ${c.symbol || market} launched, claiming your coins...`);
          await engine.claim(market, { source: 'autosend' });
        } catch (e) {
          const tries = (r?.tries || 0) + 1, wait = RETRY_MIN[tries - 1];
          put(key, { status: wait ? 'retry' : 'failed', tries, error: e.message, nextAt: wait ? now() + wait * 60_000 : undefined });
          return log(`Auto-claim of ${c.symbol || market} failed: ${e.message}${wait ? ` Trying again in ${wait} min.` : ' Gave up: claim it with aiwb claim.'}`);
        }
        if (!cfg.autoSendFlap) return put(key, { status: 'claimed', coin, tries: 0 });
      } else if (!c.claimed && !r) return; // never had shares here, or sold them on the curve: nothing of ours to send
      if (!cfg.autoSendFlap || !cfg.autoSendTo) return;
      return sendAll(key, coin, c.symbol, cfg.autoSendTo, me);
    }
    if (!(await graduated(c).catch(() => false))) return;
    return sendAll(key, c.addr, c.symbol, cfg.autoSendTo, me);
  }

  // One pass over the watched coins. Returns quickly when no switch is on.
  async function tick() {
    if (busy) return;
    const cfg = config();
    const sends = cfg.autoSendTo && isAddress(cfg.autoSendTo) && (cfg.autoSendFlap || cfg.autoSendFour || cfg.autoSendGang);
    if (!sends && !cfg.autoClaimFlap) return;
    busy = true;
    try {
      const list = candidates(journal(), cfg).filter(c => c.platform === 'flap-agent' ? (cfg.autoSendFlap && sends) || cfg.autoClaimFlap : sends && cfg[PLATFORM_SWITCH[c.platform]]);
      if (!list.length) return;
      const { me } = await engine.ctxFor();
      if (cfg.autoSendTo && same(cfg.autoSendTo, me)) return log('Auto-send is off: autoSendTo is this AI wallet itself.');
      for (const c of list) await one(c, cfg, me).catch(e => log(`Auto-send check of ${c.symbol || c.addr} failed: ${e.message}`));
    } finally { busy = false; }
  }

  return {
    tick,
    state: () => st,
    // Check every `everyMs` (30 s). Takes the auto-send lock so two processes never send the same coin.
    start(everyMs = 30_000) {
      if (timer) return;
      release = lock('autosend', 'auto-send');
      timer = setInterval(() => tick().catch(e => log(`Auto-send: ${e.message}`)), everyMs);
      timer.unref?.();
      tick().catch(e => log(`Auto-send: ${e.message}`));
    },
    stop() { clearInterval(timer); timer = null; release?.(); release = null; },
  };
}
