import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGmgn, normalizeCandles } from '../lib/gmgn.mjs';

const CA = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';

function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const r = typeof reply === 'function' ? reply(calls.at(-1)) : reply;
    return { status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  };
  return { fn, calls };
}

test('no key: a plain message on where to get one', () => {
  assert.throws(() => createGmgn({}), /gmgn\.ai\/ai/);
});

test('read requests carry the key in the header only, plus timestamp and a fresh client_id', async () => {
  const f = fakeFetch({ body: { code: 0, data: { list: [] } } });
  const g = createGmgn({ key: 'k-123456789', fetchImpl: f.fn, now: () => 1_800_000_000_000 });
  await g.info(CA);
  await g.info(CA);
  const [a, b] = f.calls;
  assert.equal(a.url.origin + a.url.pathname, 'https://openapi.gmgn.ai/v1/token/info');
  assert.equal(a.init.headers['X-APIKEY'], 'k-123456789');
  assert.ok(!a.url.search.includes('k-123456789'));
  assert.equal(a.url.searchParams.get('chain'), 'bsc');
  assert.equal(a.url.searchParams.get('timestamp'), '1800000000');
  assert.notEqual(a.url.searchParams.get('client_id'), b.url.searchParams.get('client_id'));
});

test('kline: seconds in, milliseconds to GMGN, candles out oldest first', async () => {
  const f = fakeFetch({ body: { code: 0, data: { list: [
    { time: 1792949400000, open: '2', high: '3', low: '1', close: '2.5', volume: '10' },
    { time: 1792949340000, open: '1', high: '2', low: '1', close: '2', volume: '5' },
  ] } } });
  const g = createGmgn({ key: 'k-123456789', fetchImpl: f.fn });
  const k = await g.kline(CA, { resolution: '1m', from: 1792949000, to: 1792949500 });
  assert.equal(f.calls[0].url.searchParams.get('from'), '1792949000000');
  assert.deepEqual(k, [{ t: 1792949340, o: 1, h: 2, l: 1, c: 2, v: 5 }, { t: 1792949400, o: 2, h: 3, l: 1, c: 2.5, v: 10 }]);
  await assert.rejects(g.kline(CA, { resolution: '2m' }), /resolution/);
  await assert.rejects(g.kline('0x12', {}), /contract address/);
});

test('trenches asks for all three lists on BNB Chain', async () => {
  const f = fakeFetch({ body: { code: 0, data: { new_creation: [], near_completion: [], completed: [] } } });
  const g = createGmgn({ key: 'k-123456789', fetchImpl: f.fn });
  await g.trenches({ limit: 500 });
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(Object.keys(body).sort(), ['completed', 'near_completion', 'new_creation', 'version']);
  assert.equal(body.new_creation.limit, 80);
});

test('GMGN errors become plain messages', async () => {
  const bad = createGmgn({ key: 'k-123456789', fetchImpl: fakeFetch({ status: 401, body: { code: 401, message: 'invalid api key' } }).fn });
  await assert.rejects(bad.info(CA), e => e.code === 'BAD_KEY' && /gmgn\.ai\/ai/.test(e.message));
  const slow = createGmgn({ key: 'k-123456789', fetchImpl: fakeFetch({ status: 429, body: { code: 429, message: 'rate limit' } }).fn });
  await assert.rejects(slow.info(CA), e => e.code === 'RATE_LIMIT');
  const down = createGmgn({ key: 'k-123456789', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(down.info(CA), e => e.code === 'NO_ANSWER');
});

test('normalizeCandles takes arrays too and skips rows without a time', () => {
  assert.deepEqual(normalizeCandles([[1700000000, 1, 2, 0.5, 1.5, 9], { open: 1 }]), [{ t: 1700000000, o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }]);
});
