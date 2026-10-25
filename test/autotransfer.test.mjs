import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { record, setConfig, loadConfig, publicConfig, pnl, journal } from '../lib/store.mjs';
import { createAutoSend, candidates } from '../lib/autotransfer.mjs';
import { FOUR_AGENT } from '../lib/agentpads.mjs';

beforeEach(() => { process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-')); });

const ME = '0x00000000000000000000000000000000000000aa';
const TO = '0x00000000000000000000000000000000000000cc';
const FOUR = '0x0000000000000000000000000000000000004444';
const GANG = '0x000000000000000000000000000000000000ba96';
const later = iso => new Date(Date.parse(iso) + 1000).toISOString();

test('switches: off by default, need an address, remember when they went on, key never shown', () => {
  assert.equal(loadConfig().autoSendFour, undefined);
  assert.throws(() => setConfig('autoSendFour', 'on'), /autoSendTo/);
  assert.throws(() => setConfig('autoSendTo', '0x123'), /address/);
  setConfig('autoSendTo', TO);
  setConfig('autoSendFour', 'on');
  const since = loadConfig().autoSendFour;
  assert.match(since, /^\d{4}-\d\d-\d\dT/);
  setConfig('autoSendFour', 'on');
  assert.equal(loadConfig().autoSendFour, since); // turning it on again keeps the first time
  setConfig('autoSendFour', 'off');
  assert.equal(loadConfig().autoSendFour, undefined);
  setConfig('autoSendGang', 'on');
  setConfig('autoSendTo', '');
  assert.equal(loadConfig().autoSendGang, undefined); // no address, no sending
  setConfig('autoClaimFlap', 'on'); // claiming alone needs no address
  assert.ok(loadConfig().autoClaimFlap);
  setConfig('gmgnKey', 'abcdefgh12345678');
  assert.equal(publicConfig().gmgnKey, '(set)');
  assert.ok(!JSON.stringify(publicConfig()).includes('abcdefgh12345678'));
});

test('only agent-curve coins bought after the switch went on are watched', () => {
  const cfg = { autoSendTo: TO, autoSendFour: '2026-10-26T00:00:00.000Z' };
  const entries = [
    { at: '2026-10-25T23:00:00.000Z', kind: 'buy', status: 'ok', platform: 'four-agent', token: '0x01' }, // before: no
    { at: '2026-10-26T01:00:00.000Z', kind: 'buy', status: 'ok', platform: 'four-agent', token: FOUR },
    { at: '2026-10-26T01:00:01.000Z', kind: 'buy', status: 'ok', platform: 'four-agent', token: FOUR }, // same coin once
    { at: '2026-10-26T01:00:00.000Z', kind: 'buy', status: 'ok', platform: 'pancake-v2', token: '0x02' }, // not a curve
    { at: '2026-10-26T01:00:00.000Z', kind: 'buy', status: 'not_sent', platform: 'four-agent', token: '0x03' },
    { at: '2026-10-26T01:00:00.000Z', kind: 'buy', status: 'ok', platform: 'gang', token: GANG }, // switch off
  ];
  assert.deepEqual(candidates(entries, cfg).map(c => c.addr), [FOUR]);
});

function fakeChain({ phase = FOUR_AGENT.phase.pool, held = 5n * 10n ** 18n, bnb = 10n ** 17n } = {}) {
  const chain = { phase, held, bnb, locked: true };
  const rpc = {
    async read(to, sig) {
      if (sig === 'tokenPhase()') return chain.phase;
      if (sig === 'locked()') return chain.locked;
      if (sig === 'balanceOf(address)') return chain.held;
      throw new Error(`unexpected read ${sig}`);
    },
    balance: async () => chain.bnb,
  };
  const sent = [];
  const engine = {
    ctxFor: async () => ({ me: ME }),
    async transfer(token, to) {
      if (chain.fail) { chain.fail--; throw new Error('Binance: busy'); }
      sent.push({ token, to });
      chain.held = 0n;
      return { hash: '0xh' + sent.length, tokens: '5', symbol: 'C' };
    },
  };
  return { chain, rpc, engine, sent };
}

test('a Four coin is sent once when it graduates, never before', async () => {
  setConfig('autoSendTo', TO);
  setConfig('autoSendFour', 'on');
  record({ at: later(loadConfig().autoSendFour), kind: 'buy', status: 'ok', platform: 'four-agent', token: FOUR, symbol: 'C' });
  const f = fakeChain({ phase: FOUR_AGENT.phase.curve });
  const logs = [];
  const auto = createAutoSend({ engine: f.engine, rpc: f.rpc, log: m => logs.push(m) });
  await auto.tick();
  assert.equal(f.sent.length, 0); // still on the curve
  f.chain.phase = FOUR_AGENT.phase.pool;
  await auto.tick();
  assert.deepEqual(f.sent, [{ token: FOUR, to: TO }]);
  f.chain.held = 7n; // bought more later: that is the user's
  await auto.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(auto.state()[`four-agent:${FOUR}`].status, 'sent');
  assert.ok(existsSync(join(process.env.AIWB_HOME, 'autosend.json')));
});

test('a GANG coin waits for unlock; failures retry after 1, 5, 15 min then stop', async () => {
  setConfig('autoSendTo', TO);
  setConfig('autoSendGang', 'on');
  record({ at: later(loadConfig().autoSendGang), kind: 'buy', status: 'ok', platform: 'gang', token: GANG, symbol: 'G' });
  const f = fakeChain();
  let t = Date.now();
  const auto = createAutoSend({ engine: f.engine, rpc: f.rpc, now: () => t });
  await auto.tick();
  assert.equal(f.sent.length, 0); // locked
  f.chain.locked = false;
  f.chain.fail = 4;
  await auto.tick();
  const r = () => auto.state()[`gang:${GANG}`];
  assert.equal(r().status, 'retry');
  await auto.tick(); // too early
  assert.equal(r().tries, 1);
  for (const min of [1, 5, 15]) { t += min * 60_000; await auto.tick(); }
  assert.equal(r().status, 'failed');
  assert.equal(r().tries, 4);
  assert.equal(f.sent.length, 0);
});

test('low gas waits without using up a try; sending to itself is refused', async () => {
  setConfig('autoSendTo', TO);
  setConfig('autoSendFour', 'on');
  record({ at: later(loadConfig().autoSendFour), kind: 'buy', status: 'ok', platform: 'four-agent', token: FOUR });
  const f = fakeChain({ bnb: 10n });
  const logs = [];
  let t = Date.now();
  const auto = createAutoSend({ engine: f.engine, rpc: f.rpc, log: m => logs.push(m), now: () => t });
  await auto.tick();
  assert.equal(auto.state()[`four-agent:${FOUR}`].tries, undefined);
  assert.match(logs.join(' '), /too little BNB/);
  f.chain.bnb = 10n ** 17n;
  t += 61_000;
  await auto.tick();
  assert.equal(f.sent.length, 1);

  setConfig('autoSendTo', ME);
  setConfig('autoSendFour', 'on');
  const g = fakeChain();
  const logs2 = [];
  await createAutoSend({ engine: g.engine, rpc: g.rpc, log: m => logs2.push(m), state: {} }).tick();
  assert.equal(g.sent.length, 0);
});

test('transfers leave the profit and loss books at cost', () => {
  record({ kind: 'buy', token: FOUR, symbol: 'C', bnb: '0.1', tokens: '1000', status: 'ok' });
  record({ kind: 'transfer', token: FOUR, symbol: 'C', tokens: '400', to: TO, status: 'ok' });
  const [p] = pnl();
  assert.equal(p.heldTokens, 600);
  assert.equal(p.realizedBnb, 0);
  assert.equal(journal().length, 2);
});

test('Flap: once the market launches, claim the shares and send the coin; claim-only keeps it here', async () => {
  const MARKET = '0x000000000000000000000000000000000000f1a9', COIN = '0x0000000000000000000000000000000000007777';
  setConfig('autoSendTo', TO);
  setConfig('autoSendFlap', 'on');
  record({ at: later(loadConfig().autoSendFlap), kind: 'buy', status: 'ok', platform: 'flap-agent', token: COIN, symbol: 'F', unit: 'shares' });
  const f = fakeChain();
  const fl = { launched: null, shares: 10n };
  const flap = { marketOf: async () => MARKET, launched: async () => fl.launched, shares: async () => fl.shares };
  const claims = [];
  f.engine.claim = async m => { claims.push(m); fl.shares = 0n; return { hash: '0xc' }; };
  const auto = createAutoSend({ engine: f.engine, rpc: f.rpc, flap });
  await auto.tick();
  assert.equal(claims.length + f.sent.length, 0); // still on the curve
  fl.launched = COIN;
  await auto.tick();
  assert.deepEqual(claims, [MARKET]);
  assert.deepEqual(f.sent, [{ token: COIN, to: TO }]);
  await auto.tick();
  assert.equal(f.sent.length, 1);

  // Claim only: autoSendFlap off, autoClaimFlap on.
  setConfig('autoSendFlap', 'off');
  setConfig('autoClaimFlap', 'on');
  record({ at: later(loadConfig().autoClaimFlap), kind: 'buy', status: 'ok', platform: 'flap-agent', token: COIN });
  const g = fakeChain();
  const claims2 = [];
  g.engine.claim = async m => { claims2.push(m); return { hash: '0xc' }; };
  const st = {};
  await createAutoSend({ engine: g.engine, rpc: g.rpc, flap: { marketOf: async () => MARKET, launched: async () => COIN, shares: async () => 3n }, state: st, save: () => {} }).tick();
  assert.deepEqual(claims2, [MARKET]);
  assert.equal(g.sent.length, 0);
  assert.equal(st[`flap-agent:${MARKET}`].status, 'claimed');
});
