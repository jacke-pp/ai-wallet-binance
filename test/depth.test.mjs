import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { priceImpact, poolsOf, worstImpact, shallowReason, V3_FACTORY, DOLLARS } from '../lib/depth.mjs';
import { PANCAKE } from '../lib/platforms/pancake.mjs';
import { createEngine } from '../lib/engine.mjs';
import { createWallet } from '../lib/wallet.mjs';

beforeEach(() => { process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-')); });

const E = 10n ** 18n;
const COIN = '0x00000000000000000000000000000000000000c0';
const V2_PAIR = '0x00000000000000000000000000000000000000a2';
const V3_POOL = '0x00000000000000000000000000000000000000a3';
const USDT_PAIR = '0x00000000000000000000000000000000000000a4';
const key = (a, b) => [a, b].map(x => x.toLowerCase()).sort().join('-');

// A chain with constant-product V2 pools: reserves[key(a, b)] = { [a]: x, [b]: y }, 0.25% fee like PancakeSwap V2.
function chain(reserves, extra = {}) {
  const swap = (amount, path) => {
    let x = amount;
    for (let i = 0; i < path.length - 1; i++) {
      const r = reserves[key(path[i], path[i + 1])];
      if (!r) throw new Error('no pair');
      const rin = r[path[i].toLowerCase()], rout = r[path[i + 1].toLowerCase()];
      const inFee = x * 9975n;
      x = (inFee * rout) / (rin * 10000n + inFee);
    }
    return x;
  };
  return {
    read: async (to, sig, args) => {
      if (sig.startsWith('getAmountsOut')) return [args[0], swap(args[0], args[1])];
      if (extra[sig]) return extra[sig](to, args);
      throw new Error('unexpected ' + sig);
    },
  };
}

test('price impact: a thin pool moves the price, a deep one barely does', async () => {
  const thin = chain({ [key(PANCAKE.wbnb, COIN)]: { [PANCAKE.wbnb.toLowerCase()]: 1n * E, [COIN]: 1000n * E } });
  const deep = chain({ [key(PANCAKE.wbnb, COIN)]: { [PANCAKE.wbnb.toLowerCase()]: 1000n * E, [COIN]: 1000000n * E } });
  const path = [PANCAKE.wbnb, COIN];
  const a = await priceImpact(thin, E / 2n, path); // half the pool: about a third worse
  assert.ok(a > 30 && a < 36, `thin ${a}`);
  const b = await priceImpact(deep, E / 2n, path);
  assert.ok(b < 0.1, `deep ${b}`);
  assert.equal(await worstImpact(thin, []), null);
  assert.equal(Math.round(await worstImpact(thin, [{ amountIn: E / 2n, path }, { amountIn: E / 1000n, path }])), Math.round(a));
});

test('pools: V2 and V3 against BNB and dollars, deepest first, in BNB', async () => {
  const W = PANCAKE.wbnb.toLowerCase(), U = DOLLARS.USDT.toLowerCase();
  const rpc = chain({ [key(W, U)]: { [W]: 1000n * E, [U]: 600000n * E } }, {
    'getPair(address,address)': (to, [a, b]) => b.toLowerCase() === W ? V2_PAIR : b.toLowerCase() === U ? USDT_PAIR : '0x' + '0'.repeat(40),
    'getPool(address,address,uint24)': (to, [a, b, fee]) => to === V3_FACTORY && b.toLowerCase() === W && fee === 2500 ? V3_POOL : '0x' + '0'.repeat(40),
    'balanceOf(address)': (token, [who]) => ({ [V2_PAIR]: 2n * E, [V3_POOL]: 300n * E, [USDT_PAIR]: 6000n * E })[who] ?? 0n,
    'symbol()': () => 'C',
  });
  const pools = await poolsOf(rpc, COIN);
  assert.deepEqual(pools.map(p => [p.dex, p.quote, p.fee ?? null, Math.round(p.depthBnb)]), [
    ['PancakeSwap V3', 'BNB', 0.25, 300], ['PancakeSwap V2', 'USDT', null, 10], ['PancakeSwap V2', 'BNB', null, 2]]);
  const why = await shallowReason(rpc, [{ amountIn: E, path: [PANCAKE.wbnb, COIN] }]);
  assert.match(why, /V2 BNB pool holds about 2 BNB, but its deepest pool is PancakeSwap V3 BNB 0.25% with about 300 BNB/);
});

function fakeEngine({ cfg = {}, legs, reserves }) {
  const me = '0x00000000000000000000000000000000000000aa';
  const sent = [];
  const base = chain(reserves, {
    'symbol()': () => 'C', 'decimals()': () => 18n, 'balanceOf(address)': () => 1n,
    'getPair(address,address)': () => V2_PAIR, 'getPool(address,address,uint24)': () => '0x' + '0'.repeat(40),
  });
  const rpc = { ...base, urls: ['fake'], code: async () => '0x6000', balance: async () => 10n * E };
  const platform = {
    detect: async () => ({ platform: 'fake-dex', phase: 'dex', agentOnly: false }),
    buy: async (ctx, info, bnb) => ({ expectedOut: 5n, minOut: 4n, via: 'fake', swapLegs: legs(bnb), steps: [{ label: 'buy', tx: { to: COIN, value: bnb, data: '0x01' } }] }),
  };
  const run = async args => {
    if (args[1] === 'address') return { success: true, data: [{ binanceChainId: '56', address: me }] };
    sent.push(args);
    return { success: false, error: { message: 'stop here' } };
  };
  return { eng: createEngine({ rpc, wallet: createWallet({ run }), cfg, platforms: [platform] }), sent };
}

test('a buy through a thin V2 pool is refused before anything is sent; force and a higher limit let it through', async () => {
  const reserves = { [key(PANCAKE.wbnb, COIN)]: { [PANCAKE.wbnb.toLowerCase()]: 1n * E, [COIN]: 1000n * E } };
  const legs = bnb => [{ amountIn: bnb, path: [PANCAKE.wbnb, COIN] }];
  let f = fakeEngine({ legs, reserves });
  await assert.rejects(f.eng.buy(COIN, '0.5'), e => e.code === 'SHALLOW_POOL' && /Nothing was sent/.test(e.message) && e.limitPct === 5);
  assert.equal(f.sent.length, 0);
  const dry = await f.eng.buy(COIN, '0.01', { dryRun: true }); // 1% of the pool: fine
  assert.ok(dry.plan.impactPct > 0 && dry.plan.impactPct < 5);
  await assert.rejects(f.eng.buy(COIN, '0.5', { force: true }), /stop here/); // went on to Binance
  f = fakeEngine({ legs, reserves, cfg: { maxImpactPct: 50 } });
  await assert.rejects(f.eng.buy(COIN, '0.5'), /stop here/);
  // Curves with no V2 swap are not measured.
  f = fakeEngine({ legs: () => [], reserves });
  await assert.rejects(f.eng.buy(COIN, '0.5'), /stop here/);
});

test('a route priced by quote() (KyberSwap) is measured the same way', async () => {
  const rpc = chain({});
  // A pool holding 1000 BNB-worth: x*y=k without fees.
  const quote = async a => (a * 1000000n * E) / (1000n * E + a);
  const leg = { amountIn: 10n * E, coin: COIN, quote };
  const pct = await worstImpact(rpc, [leg]);
  assert.ok(pct > 0.9 && pct < 1.1, `1% of the pool moves it ~1%: ${pct}`);
  assert.equal(await worstImpact(rpc, [{ ...leg, quote: async () => { throw new Error('down'); } }]), null);
});
