// The trenches board: parsing what the launchpads return, and sorting coins into new / nearly full / launched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeArgs, encodeCall } from '../lib/abi.mjs';
import { FOUR_AGENT, four, flapAgent } from '../lib/agentpads.mjs';
import { GANG, curveState } from '../lib/platforms/gang.mjs';
import { createTrenches, SOON_PCT } from '../lib/ui/trenches.mjs';

const A = n => '0x' + String(n).repeat(40).slice(0, 40);
const E18 = 10n ** 18n;
const pad = v => BigInt(v).toString(16).padStart(64, '0');

test('Four trade log: raised, price and template', () => {
  const data = '0x' + [1, 0, 0, 0, 5n * E18, 0, 0, 4n * 10n ** 9n, 0, 0, 0, 0, 0, 67n * E18 / 10n, 7n * E18].map(pad).join('');
  const tr = four.parse.trade({ topics: [FOUR_AGENT.trade.topic0, '0x' + pad(BigInt(A(1))), '0x' + pad(BigInt(A(2))), '0x' + pad(FOUR_AGENT.template)], data, blockNumber: '0x10' });
  assert.equal(tr.token, A(1));
  assert.equal(tr.trader, A(2));
  assert.equal(tr.template, FOUR_AGENT.template);
  assert.equal(tr.buy, true);
  assert.equal(tr.raised, 67n * E18 / 10n);
  assert.equal(tr.price, 4n * 10n ** 9n);
  assert.equal(tr.block, 16n);
  assert.equal(four.reads.raised(A(3), A(1)).data, FOUR_AGENT.selectors.raised + pad(BigInt(A(1))));
});

test('Flap market detail: 50 words', () => {
  const w = Array(50).fill(0n);
  w[0] = BigInt(A(1)); w[1] = BigInt(A(2)); w[3] = 18n; w[4] = 5n * E18; w[5] = 2n * E18; w[7] = 4000n; w[8] = 1n; w[18] = 100n; w[19] = 100n; w[38] = 42n; w[42] = 123n;
  const d = flapAgent.parse.detail('0x' + w.map(pad).join(''));
  assert.deepEqual([d.market, d.creator, d.cap, d.pool, d.progress, d.phase, d.holders, d.startBlock, d.buyFeeBps], [A(1), A(2), 5n * E18, 2n * E18, 40, 1, 42, 123, 100]);
  assert.equal(flapAgent.parse.detail('0x1234'), null);
});

test('GANG curve record', () => {
  const raw = encodeArgs(['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'bool', 'address', 'address'], [A(2), A(3), 600n * E18, 1n, 2000n * E18, 0n, false, true, A(0), A(4)]);
  assert.deepEqual(curveState(raw), { creator: A(2), quote: A(3), raised: 600n * E18, sold: 1n, target: 2000n * E18, graduated: false, pair: A(0) });
  assert.equal(curveState(encodeArgs(['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'bool', 'address'], [A(2), A(0), 0n, 0n, 0n, 0n, false, false, A(0)])), null, 'unknown coin');
});

test('board: GANG coins land in the right column and changes are pushed', async () => {
  const coins = [A(5), A(6)];
  const curves = { [A(5)]: [100n, 1000n, false], [A(6)]: [700n, 1000n, false] };
  const answer = ({ to, data }) => {
    to = to.toLowerCase();
    if (to === GANG.launchpad && data === encodeCall('tokenCount()')) return '0x' + pad(2);
    if (to === GANG.launchpad && data.startsWith(encodeCall('allTokens(uint256)', [0n]).slice(0, 10))) return '0x' + pad(BigInt(coins[Number(BigInt('0x' + data.slice(10)))]));
    if (to === GANG.launchpad) { const c = curves['0x' + data.slice(-40)]; return encodeArgs(['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'bool', 'address'], [A(7), A(8), c[0] * E18, 0n, c[1] * E18, 0n, c[2], true, A(0)]); }
    if (data === '0x95d89b41') return encodeArgs(['string'], [to === A(8) ? 'GANG' : 'C' + to.slice(2, 3)]);
    if (data === '0x06fdde03') return encodeArgs(['string'], ['Coin']);
    return null;
  };
  const rpc = { blockNumber: async () => 1000n, logs: async () => [], batch: async calls => calls.map(answer), call: async c => answer(c) };
  const pushed = [];
  const board = createTrenches({ rpc, emit: (type, list) => pushed.push(type, ...list.map(i => ({ ...i }))) });
  board.start();
  await new Promise(r => setTimeout(r, 1500));
  curves[A(6)][2] = true; // the second one fills
  await new Promise(r => setTimeout(r, 11_500));
  board.stop();
  const byToken = Object.fromEntries(board.list().items.map(i => [i.token, i]));
  assert.equal(byToken[A(5)].stage, 'new');
  assert.equal(byToken[A(5)].progress, 10);
  assert.equal(byToken[A(5)].quote, 'GANG');
  assert.equal(byToken[A(5)].symbol, 'C5');
  assert.equal(byToken[A(6)].stage, 'launched');
  assert.ok(70 >= SOON_PCT);
  assert.ok(pushed.includes('trench'));
  assert.ok(pushed.some(i => i?.token === A(6) && i.stage === 'soon'), 'was nearly full before it launched');
});
