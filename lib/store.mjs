// Local files only, under ~/.ai-wallet-binance (or $AIWB_HOME). No server of ours is involved.
//   config.json   your settings: RPC node, slippage, optional spending limits
//   journal.jsonl one line per trade / mint / call (the bookkeeping)
//   snipes.json   the snipes you set up
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const home = () => process.env.AIWB_HOME || join(homedir(), '.ai-wallet-binance');
const file = name => join(home(), name);
const ensure = () => mkdirSync(home(), { recursive: true, mode: 0o700 });

function readJson(name, fallback) {
  try { return JSON.parse(readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  ensure();
  const tmp = file(`${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file(name));
}

// ---------- config ----------
// Spending limits have no defaults on purpose: you set them (`aiwb config set dailyCapBnb 0.5`).
export const DEFAULTS = { rpc: null, slippagePct: 15, baw: null };
export const CONFIG_KEYS = {
  rpc: 'your own BSC RPC url(s), comma separated; empty = free public nodes',
  slippagePct: 'how far the price may move against you, in % (default 15; new curves move fast)',
  maxPerTradeBnb: 'optional: refuse any single buy above this many BNB',
  dailyCapBnb: 'optional: refuse buys once this many BNB were spent today (UTC), snipes included',
  gasLimit: 'optional: most gas one transaction may use (21000-15000000); empty = Binance estimates it',
  speedUpAfterSec: 'optional: if a transaction is still pending after this many seconds, Binance re-sends it with more gas',
  speedUpLevel: 'LOW (gas price x1.1) or HIGH (x1.25, default) for speed-ups',
  appWaitSec: 'how long to wait for you to confirm a risky transaction in the Binance App (default 600 seconds)',
  baw: 'optional: path to the baw CLI if it is not on PATH',
  autoSendTo: 'optional: the address coins are sent to automatically (see the three switches below; all off by default)',
  autoSendFlap: 'on/off: after a Flap agent coin launches, claim your coins and send them all to autoSendTo',
  autoSendFour: 'on/off: when a Four agent coin you bought graduates (unlocks), send it all to autoSendTo',
  autoSendGang: 'on/off: when a GANG coin you bought graduates (unlocks), send it all to autoSendTo',
  autoClaimFlap: 'on/off: claim launched Flap agent coins into this wallet automatically (no sending)',
  gmgnKey: 'optional: your GMGN API key (https://gmgn.ai/ai) for GMGN charts and data on the trading page; read only, never shown',
};
// Settings that are secrets: shown only as "(set)".
export const SECRET_KEYS = ['gmgnKey'];
// The automatic switches. Each stores when it was turned on: only coins bought (or claimed) after that are sent.
export const SWITCHES = ['autoSendFlap', 'autoSendFour', 'autoSendGang', 'autoClaimFlap'];
export const publicConfig = (cfg = loadConfig()) => Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, SECRET_KEYS.includes(k) && v ? '(set)' : v]));
export const loadConfig = () => ({ ...DEFAULTS, ...readJson('config.json', {}) });
export function setConfig(key, value) {
  if (!(key in CONFIG_KEYS)) throw new Error(`unknown setting "${key}". Known: ${Object.keys(CONFIG_KEYS).join(', ')}`);
  const cfg = readJson('config.json', {});
  if (value === '' || value == null) {
    delete cfg[key];
    // No address, no sending: the send switches go off with it.
    if (key === 'autoSendTo') for (const k of SWITCHES) if (k.startsWith('autoSend')) delete cfg[k];
  }
  else if (['slippagePct', 'maxPerTradeBnb', 'dailyCapBnb', 'speedUpAfterSec', 'appWaitSec'].includes(key)) {
    const n = Number(value);
    if (!(n > 0)) throw new Error(`${key} must be a positive number`);
    if (key === 'slippagePct' && n >= 100) throw new Error('slippagePct must be below 100');
    cfg[key] = n;
  } else if (key === 'gasLimit') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 21000 || n > 15000000) throw new Error('gasLimit must be a whole number from 21000 to 15000000');
    cfg[key] = n;
  } else if (key === 'speedUpLevel') {
    const v = String(value).toUpperCase();
    if (!['LOW', 'HIGH'].includes(v)) throw new Error('speedUpLevel is LOW or HIGH');
    cfg[key] = v;
  } else if (SWITCHES.includes(key)) {
    const v = String(value).toLowerCase();
    if (!['on', 'off', 'true', 'false', '1', '0'].includes(v)) throw new Error(`${key} is on or off`);
    const on = ['on', 'true', '1'].includes(v);
    if (on && key.startsWith('autoSend') && !cfg.autoSendTo) throw new Error('Set the address to send to first: aiwb config set autoSendTo <address>');
    if (!on) delete cfg[key];
    else if (!cfg[key]) cfg[key] = new Date().toISOString(); // keep the first time it was turned on
  } else if (key === 'autoSendTo') {
    const v = String(value).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v) || /^0x0{40}$/.test(v)) throw new Error('autoSendTo must be a BNB Chain address (0x + 40 hex characters)');
    cfg[key] = v;
  } else if (key === 'gmgnKey') {
    const v = String(value).trim();
    if (!/^[\x21-\x7e]{8,200}$/.test(v)) throw new Error('that does not look like a GMGN API key');
    cfg[key] = v;
  } else cfg[key] = String(value);
  writeJson('config.json', cfg);
  return cfg;
}

// ---------- journal ----------
export function record(entry) {
  ensure();
  const line = { at: new Date().toISOString(), ...entry };
  appendFileSync(file('journal.jsonl'), JSON.stringify(line, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n', { mode: 0o600 });
  return line;
}
export function journal() {
  if (!existsSync(file('journal.jsonl'))) return [];
  return readFileSync(file('journal.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const utcDay = d => new Date(d).toISOString().slice(0, 10);
// BNB that left the wallet in buys today (UTC), counting anything that may have gone on chain.
// BNB spent on buys today (UTC). `snipesOnly`: only buys made by snipes (their own daily cap).
export function spentToday(entries = journal(), now = Date.now(), { snipesOnly = false } = {}) {
  const today = utcDay(now);
  return entries.filter(e => e.kind === 'buy' && e.status !== 'not_sent' && utcDay(e.at) === today && (!snipesOnly || String(e.source || '').startsWith('snipe:')))
    .reduce((s, e) => s + Number(e.bnb || 0), 0);
}

// Profit and loss per coin from the journal: average cost, realized result of what was sold, what is still held.
export function pnl(entries = journal()) {
  const by = new Map();
  for (const e of entries) {
    if (!['buy', 'sell', 'transfer'].includes(e.kind) || e.status !== 'ok' || !e.token) continue;
    const k = e.token.toLowerCase();
    if (e.kind === 'transfer' && !by.has(k)) continue;
    const p = by.get(k) || { token: e.token, symbol: e.symbol, boughtBnb: 0, boughtTokens: 0, soldBnb: 0, soldTokens: 0, costOfSold: 0, sentTokens: 0, trades: 0 };
    const tokens = Number(e.tokens || 0), bnb = Number(e.bnb || 0);
    // Coins sent to another address leave the books at cost: no profit or loss here.
    if (e.kind === 'transfer') { p.sentTokens += tokens; continue; }
    if (e.kind === 'buy') { p.boughtBnb += bnb; p.boughtTokens += tokens; }
    else {
      const avg = p.boughtTokens > 0 ? p.boughtBnb / p.boughtTokens : 0;
      p.soldBnb += bnb; p.soldTokens += tokens; p.costOfSold += avg * tokens;
    }
    p.symbol ||= e.symbol;
    p.trades++;
    by.set(k, p);
  }
  return [...by.values()].map(p => ({ ...p, realizedBnb: p.soldBnb - p.costOfSold, heldTokens: Math.max(0, p.boughtTokens - p.soldTokens - p.sentTokens), avgCostBnb: p.boughtTokens ? p.boughtBnb / p.boughtTokens : 0 }));
}

// ---------- snipes ----------
export const loadSnipes = () => readJson('snipes.json', []);
export const saveSnipes = list => writeJson('snipes.json', list);

// ---------- locks ----------
// One process at a time may run snipes (the terminal's `aiwb snipe run` or the page's `aiwb ui`), or a launch could be
// bought twice. Returns a release function; throws when another live process holds the lock.
export function lock(name, what = 'snipes') {
  ensure();
  const f = file(`${name}.lock`);
  const pid = Number(readJson(`${name}.lock`, {}).pid);
  if (pid && pid !== process.pid) {
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
    if (alive) throw new Error(`${what} ${what === 'snipes' ? 'are' : 'is'} already running in another aiwb (process ${pid}). Stop that one first.`);
  }
  writeFileSync(f, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
  const release = () => { try { if (Number(readJson(`${name}.lock`, {}).pid) === process.pid) unlinkSync(f); } catch {} };
  process.once('exit', release);
  return release;
}
