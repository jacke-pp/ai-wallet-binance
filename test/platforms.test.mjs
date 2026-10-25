import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingFeePct, detect as fourDetect, watch as fourWatch } from '../lib/platforms/fouragent.mjs';
import { watch as flapWatch, roundTripCalls } from '../lib/platforms/flapagent.mjs';
import { LAUNCHPADS, PLATFORMS } from '../lib/platforms/index.mjs';
import { detect as gangDetect, watch as gangWatch } from '../lib/platforms/gang.mjs';
import { encodeArgs, ZERO } from '../lib/abi.mjs';

test('Four opening fee falls block by block and only when switched on', () => {
  const rec = { createdBlock: 100n, openingFee: true };
  assert.equal(openingFeePct(rec, 100n), 99); // creation block: unknown, treated as too high
  assert.equal(openingFeePct(rec, 101n), 49);
  assert.equal(openingFeePct(rec, 104n), 9);
  assert.equal(openingFeePct(rec, 105n), 4);
  assert.equal(openingFeePct(rec, 106n), 0);
  assert.equal(openingFeePct({ ...rec, openingFee: false }, 101n), 0);
});

test('Four detect: agent template only, tax = 1% + creator tax + opening fee', async () => {
  const words = Array(24).fill(0n);
  words[0] = 1n; words[2] = 1778027615735n; words[16] = 1000n; words[19] = 1n;
  const raw = encodeArgs(Array(24).fill('uint256'), words);
  const rpc = {
    call: async ({ to }) => to.startsWith('0x7b37') ? encodeArgs(['bool'], [true]) : raw,
    read: async (to, sig) => ({ 'tokenPhase()': 1n, 'buyFeeRate()': 300n, 'sellFeeRate()': 0n })[sig],
    blockNumber: async () => 1003n,
  };
  const info = await fourDetect({ rpc, me: '0x' + 'a'.repeat(40) }, '0x' + 'b'.repeat(40));
  assert.equal(info.platform, 'four-agent');
  assert.equal(info.buyTaxPct, 1 + 3 + 14);
  assert.equal(info.sellTaxPct, 1);
  words[2] = 5n;
  const other = encodeArgs(Array(24).fill('uint256'), words);
  assert.equal(await fourDetect({ rpc: { ...rpc, call: async () => other }, me: ZERO }, ZERO), null);
});

test('launchpad watchers are registered and parse creation logs', async () => {
  assert.deepEqual(Object.keys(LAUNCHPADS).sort(), ['flap-agent', 'four-agent', 'gang']);
  assert.ok(PLATFORMS.length >= 5);
  const pad = a => '0x' + a.slice(2).padStart(64, '0');
  const rpc = { read: async (to, sig) => sig === 'name()' ? 'Cat' : 'CAT' };
  const four = await fourWatch.parse({ topics: [fourWatch.topics[0], fourWatch.topics[1], pad('0x' + '1'.repeat(40)), pad('0x' + '2'.repeat(40))] }, rpc);
  assert.equal(four.token, '0x' + '2'.repeat(40));
  assert.equal(four.creator, '0x' + '1'.repeat(40));
  const flap = await flapWatch.parse({ topics: [flapWatch.topics[0], pad('0x' + '1'.repeat(40)), pad('0x' + '3'.repeat(40)), pad('0x' + '4'.repeat(40))] }, { read: async () => { throw new Error('offline'); } });
  assert.equal(flap.market, '0x' + '3'.repeat(40));
  assert.equal(flap.predictedToken, '0x' + '4'.repeat(40));
});

test('Flap round trip is simulated only for BNB markets', () => {
  const info = { market: '0x' + '3'.repeat(40), quote: ZERO };
  assert.equal(roundTripCalls({}, info, 1n).length, 2);
  assert.equal(roundTripCalls({}, { ...info, quote: '0x' + '5'.repeat(40) }, 1n), null);
});

import { nftsTo } from '../lib/mint.mjs';
import { record, spentToday } from '../lib/store.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('mint: counts ERC721 and ERC1155 arriving at the wallet only', () => {
  const me = '0x' + 'a'.repeat(40), other = '0x' + 'b'.repeat(40), pad = a => '0x' + a.slice(2).padStart(64, '0');
  const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const T1155 = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
  const logs = [
    { address: '0xC1', topics: [T721, pad(ZERO), pad(me), pad('0x05')] },
    { address: '0xC1', topics: [T721, pad(ZERO), pad(other), pad('0x06')] },
    { address: '0xC2', topics: [T1155, pad(me), pad(ZERO), pad(me)], data: encodeArgs(['uint256', 'uint256'], [7n, 3n]) },
    { address: '0xC3', topics: [T721, pad(ZERO), pad(me)], data: '0x01' }, // ERC20 mint: not an NFT
  ];
  assert.deepEqual(nftsTo([{ logs }], me), { '0xc1': 1, '0xc2': 3 });
});

test('snipe daily cap counts only snipe buys', () => {
  process.env.AIWB_HOME = mkdtempSync(join(tmpdir(), 'aiwb-'));
  record({ kind: 'buy', bnb: '0.01', status: 'ok', source: 'manual' });
  record({ kind: 'buy', bnb: '0.002', status: 'ok', source: 'snipe:abc' });
  assert.equal(spentToday(), 0.012);
  assert.equal(spentToday(undefined, Date.now(), { snipesOnly: true }), 0.002);
});

test('GANG launchpad: recognizes its coins, reads the quote coin, parses new coins', async () => {
  const pad = a => '0x' + a.slice(2).padStart(64, '0');
  const quote = '0x' + '7'.repeat(40);
  const curve = '0x' + pad('0x' + '1'.repeat(40)).slice(2) + pad(quote).slice(2) + '0'.repeat(64 * 8);
  const rpc = { call: async () => curve, read: async (to, sig) => sig === 'locked()' ? true : 'GANG' };
  const info = await gangDetect({ rpc, me: ZERO }, '0x' + '2'.repeat(40));
  assert.equal(info.platform, 'gang');
  assert.equal(info.agentOnly, true);
  assert.equal(info.quote, quote);
  assert.equal(info.quoteSymbol, 'GANG');
  assert.equal(info.buyTaxPct, 1);
  assert.equal(await gangDetect({ rpc: { ...rpc, call: async () => '0x' + '0'.repeat(640) }, me: ZERO }, ZERO), null); // unknown coin
  // Graduated (unlocked): no coin/quote pool yet -> not ours; with the pool -> two hops on PancakeSwap.
  const grad = pair => ({ ...rpc, read: async (to, sig) => sig === 'locked()' ? false : sig.startsWith('getPair') ? pair : 'GANG' });
  assert.equal(await gangDetect({ rpc: grad(ZERO), me: ZERO }, ZERO), null);
  const dex = await gangDetect({ rpc: grad('0x' + '9'.repeat(40)), me: ZERO }, ZERO);
  assert.equal(dex.phase, 'dex');
  assert.equal(dex.agentOnly, false);
  const coin = await gangWatch.parse({ topics: [gangWatch.topics[0], pad('0x' + '2'.repeat(40)), pad('0x' + '1'.repeat(40)), pad(quote)] }, { read: async (to, sig) => sig === 'name()' ? 'Cat' : 'CAT' });
  assert.deepEqual(coin, { token: '0x' + '2'.repeat(40), creator: '0x' + '1'.repeat(40), quote, name: 'Cat', symbol: 'CAT' });
  assert.match(gangWatch.topics[0], /^0x[0-9a-f]{64}$/);
});
