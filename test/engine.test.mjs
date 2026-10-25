import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, toWei, fromWei } from '../lib/engine.mjs';
import { createWallet } from '../lib/wallet.mjs';
import { record, journal, spentToday, pnl, setConfig, loadConfig } from '../lib/store.mjs';
import { addSnipe, matches } from '../lib/snipe.mjs';
import { encodeArgs } from '../lib/abi.mjs';

beforeEach(() => { process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-')); });

test('toWei / fromWei', () => {
  assert.equal(toWei('0.05'), 50000000000000000n);
  assert.equal(toWei('1'), 10n ** 18n);
  assert.equal(fromWei(1234500000000000000n), '1.2345');
  assert.throws(() => toWei('1e5'));
});

test('journal, daily spend and pnl', () => {
  record({ kind: 'buy', token: '0xA', symbol: 'A', bnb: '0.1', tokens: '1000', status: 'ok' });
  record({ kind: 'buy', token: '0xA', symbol: 'A', bnb: '0.1', tokens: '1000', status: 'not_sent' });
  record({ kind: 'sell', token: '0xA', symbol: 'A', bnb: '0.08', tokens: '500', status: 'ok' });
  assert.equal(journal().length, 3);
  assert.equal(spentToday(), 0.1);
  const [p] = pnl();
  assert.equal(p.boughtBnb, 0.1);
  assert.ok(Math.abs(p.realizedBnb - 0.03) < 1e-12); // sold half (cost 0.05) for 0.08
  assert.equal(p.heldTokens, 500);
});

test('config: limits have no defaults and must be positive', () => {
  assert.equal(loadConfig().dailyCapBnb, undefined);
  setConfig('dailyCapBnb', '0.5');
  assert.equal(loadConfig().dailyCapBnb, 0.5);
  assert.throws(() => setConfig('dailyCapBnb', '-1'));
  assert.throws(() => setConfig('privateKey', 'x'), /unknown setting/);
});

test('snipes need every amount from the user', () => {
  assert.throws(() => addSnipe('watch', { count: 3, bnb: 0.01, 'daily-cap': 0.05 }), /max-tax/);
  assert.throws(() => addSnipe('watch', { bnb: 0.01, 'daily-cap': 0.05, 'max-tax': 10 }), /count/);
  assert.throws(() => addSnipe('watch', { count: 3, bnb: 1, 'daily-cap': 0.5, 'max-tax': 10 }), /larger than/);
  const s = addSnipe('watch', { count: 2, bnb: 0.01, 'daily-cap': 0.05, 'max-tax': 10, creator: '0xDEV', name: 'cat,dog' });
  const coin = { platform: 'x', creator: '0xdev', name: 'Big Cat', symbol: 'CAT', token: '0x1' };
  assert.equal(matches(s, coin), true);
  assert.equal(matches(s, { ...coin, creator: '0xother' }), false);
  assert.equal(matches(s, { ...coin, name: 'Bird', symbol: 'B' }), false);
  s.bought = [{ token: '0x1' }, { token: '0x2' }];
  assert.equal(matches(s, coin), false); // count reached
});

// A fake chain + fake Binance wallet: checks the engine's guards and what it records, without any network.
function fakes({ balance = 10n ** 18n, agentId = 1n } = {}) {
  const sent = [];
  const me = '0x00000000000000000000000000000000000000aa';
  const token = '0x00000000000000000000000000000000000000bb';
  const rpc = {
    urls: ['fake'],
    code: async () => '0x6000',
    balance: async () => balance,
    read: async (to, sig) => {
      if (sig.startsWith('symbol')) return 'TST';
      if (sig.startsWith('decimals')) return 18n;
      if (sig.startsWith('balanceOf')) return agentId;
      if (sig.startsWith('allowance')) return 0n;
      throw new Error('unexpected read ' + sig);
    },
    waitReceipt: async hash => ({ status: '0x1', blockNumber: '0x10', gasUsed: '0x1', effectiveGasPrice: '0x1', logs: [{
      address: token, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + '0'.repeat(64), '0x' + me.slice(2).padStart(64, '0')],
      data: encodeArgs(['uint256'], [5n * 10n ** 18n]) }] }),
  };
  const platform = {
    detect: async () => ({ platform: 'fake', phase: 'curve', agentOnly: true, buyTaxPct: 3 }),
    buy: async (ctx, info, bnb) => ({ expectedOut: 5n, minOut: 4n, via: 'fake', steps: [{ label: 'buy', tx: { to: token, value: bnb, data: '0x01' } }] }),
    sell: async () => { throw new Error('no'); },
  };
  const run = async args => {
    if (args[1] === 'address') return { success: true, data: [{ binanceChainId: '56', address: me }] };
    if (args[1] === 'preview') { sent.push(args); return { success: true, data: { requestId: 'r1', simulationResult: { simulationCode: '000000000' } } }; }
    if (args[1] === 'execute') return { success: true, data: { status: 'BROADCASTED', txHash: '0xhash' } };
    return { success: false, error: { message: 'unexpected' } };
  };
  const wallet = createWallet({ run });
  return { rpc, wallet, platform, sent, token, me };
}

test('buy goes through preview + execute and is recorded', async () => {
  const f = fakes();
  const eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform] });
  const r = await eng.buy(f.token, '0.01');
  assert.equal(r.hash, '0xhash');
  assert.equal(r.tokens, '5');
  assert.equal(f.sent.length, 1);
  assert.ok(f.sent[0].includes('--from') && f.sent[0].includes(f.me));
  assert.equal(journal().at(-1).status, 'ok');
});

test('guards: limits, Agent ID, tax, balance', async () => {
  let f = fakes();
  let eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform], cfg: { maxPerTradeBnb: 0.005 } });
  await assert.rejects(eng.buy(f.token, '0.01'), /per-trade limit/);
  eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform] });
  await assert.rejects(eng.buy(f.token, '0.01', { maxTaxPct: 2 }), /buy tax is 3%/);
  f = fakes({ agentId: 0n });
  eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform] });
  await assert.rejects(eng.buy(f.token, '0.01'), /Agent ID/);
  f = fakes({ balance: 1n });
  eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform] });
  await assert.rejects(eng.buy(f.token, '0.01'), /Top it up/);
  assert.equal(f.sent.length, 0);
});

test('Binance refusals become plain messages and nothing is executed', async () => {
  const calls = [];
  const w = createWallet({ run: async args => {
    calls.push(args[1]);
    if (args[1] === 'address') return { success: true, data: [{ binanceChainId: '56', address: '0x00000000000000000000000000000000000000aa' }] };
    if (args[1] === 'preview') return { success: false, error: { code: 351803, message: 'Transaction risk is too high' } };
    return { success: true, data: {} };
  } });
  await assert.rejects(w.send({ to: '0x00000000000000000000000000000000000000bb', data: '0x' }), /too risky/);
  assert.ok(!calls.includes('execute'));
  const w2 = createWallet({ run: async args => args[1] === 'address' ? { success: true, data: [{ binanceChainId: '56', address: '0x00000000000000000000000000000000000000aa' }] } : { success: true, data: { requestId: 'r', requireConfirmation: true } } });
  await assert.rejects(w2.send({ to: '0x00000000000000000000000000000000000000bb', data: '0x' }), /confirmed in its App/);
});

test('speed-up: a stuck buy is re-sent and the faster copy counts; a buy that just confirmed is left alone', async () => {
  const f = fakes();
  const rc = f.rpc.waitReceipt;
  let level = null;
  f.rpc.waitReceipt = async (hash, o) => o?.timeoutMs ? null : rc(hash);        // still pending after the wait
  f.rpc.receipt = async hash => hash === '0xfast' ? { ...(await rc(hash)), transactionHash: '0xfast' } : null;
  f.wallet.speedUp = async (hash, lv) => { level = lv; return { hash: '0xfast' }; };
  let eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform], cfg: { speedUpAfterSec: 1, speedUpLevel: 'LOW' } });
  const r = await eng.buy(f.token, '0.01');
  assert.equal(r.hash, '0xfast');
  assert.equal(level, 'LOW');
  f.rpc.receipt = async hash => rc(hash);
  f.wallet.speedUp = async () => { throw Object.assign(new Error('already confirmed'), { code: 30007002 }); };
  eng = createEngine({ rpc: f.rpc, wallet: f.wallet, platforms: [f.platform], cfg: { speedUpAfterSec: 1 } });
  const r2 = await eng.buy(f.token, '0.01');
  assert.equal(r2.hash, '0xhash');
});
