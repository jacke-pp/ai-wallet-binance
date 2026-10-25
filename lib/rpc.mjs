// JSON-RPC over plain fetch. Reads go to the user's own node if they set one, else to free public BSC nodes.
// Nothing here signs or sends a transaction: the Binance wallet (baw) does that.
import { decode, encodeCall, revertReason } from './abi.mjs';

// Free nodes, tried in order when one fails or rate-limits. The first three answer eth_getLogs (snipes need it) and
// eth_simulateV1 (checks and quotes need it); the BNB Chain ones only do plain reads. Tested 2026-10-25.
export const PUBLIC_BSC = [
  'https://bsc-rpc.publicnode.com',
  'https://1rpc.io/bnb',
  'https://bsc.blockrazor.xyz',
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.defibit.io',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class RpcError extends Error {
  constructor(message, data) { super(message); this.data = data; }
}

export function createRpc(urls = PUBLIC_BSC, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const list = (Array.isArray(urls) ? urls : String(urls).split(',')).map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('no RPC url');
  let best = 0, id = 0;

  async function send(method, params = []) {
    let last;
    for (let i = 0; i < list.length; i++) {
      const k = (best + i) % list.length;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        const res = await fetchImpl(list[k], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: ctl.signal })
          .finally(() => clearTimeout(timer));
        const j = await res.json();
        if (j.error) {
          // A revert is the contract's answer, not a node problem: don't try the next node.
          if (j.error.data || /revert/i.test(j.error.message || '')) throw new RpcError(j.error.message || 'execution reverted', j.error.data);
          throw new Error(j.error.message || 'rpc error');
        }
        best = k;
        return j.result;
      } catch (e) {
        if (e instanceof RpcError) throw e;
        last = e;
      }
    }
    throw new Error(`all RPC nodes failed (${last?.message || last})`);
  }

  const hex = n => '0x' + BigInt(n).toString(16);
  const blockTag = b => (b == null ? 'latest' : typeof b === 'string' ? b : hex(b));

  const rpc = {
    urls: list,
    send,
    blockNumber: async () => BigInt(await send('eth_blockNumber')),
    balance: async (a, b) => BigInt(await send('eth_getBalance', [a, blockTag(b)])),
    code: (a, b) => send('eth_getCode', [a, blockTag(b)]),
    nonce: async a => BigInt(await send('eth_getTransactionCount', [a, 'latest'])),
    // eth_call; `from` matters for gated contracts (an Agent ID check reads msg.sender).
    async call({ to, data, from, value }, block, overrides) {
      const tx = { to, data, ...(from ? { from } : {}), ...(value ? { value: hex(value) } : {}) };
      return send('eth_call', overrides ? [tx, blockTag(block), overrides] : [tx, blockTag(block)]);
    },
    // Read a view function by signature: read(token, 'balanceOf(address)', [me], ['uint256']).
    async read(to, sig, args, outTypes, opts = {}) {
      const out = await rpc.call({ to, data: encodeCall(sig, args), from: opts.from, value: opts.value }, opts.block, opts.overrides);
      const vals = decode(outTypes, out);
      return outTypes.length === 1 ? vals[0] : vals;
    },
    // Same, but a revert comes back as { error } instead of throwing.
    async tryRead(to, sig, args, outTypes, opts = {}) {
      try { return { value: await rpc.read(to, sig, args, outTypes, opts) }; } catch (e) {
        return { error: e instanceof RpcError ? (revertReason(e.data, opts.errors) || e.message) : e.message };
      }
    },
    logs: filter => send('eth_getLogs', [{ ...filter, fromBlock: blockTag(filter.fromBlock), toBlock: blockTag(filter.toBlock) }]),
    receipt: h => send('eth_getTransactionReceipt', [h]),
    tx: h => send('eth_getTransactionByHash', [h]),
    async waitReceipt(hash, { timeoutMs: t = 60_000, every = 300 } = {}) {
      const end = Date.now() + t;
      for (;;) {
        const r = await send('eth_getTransactionReceipt', [hash]).catch(() => null);
        if (r) return r;
        if (Date.now() > end) throw new Error(`no receipt for ${hash} after ${t / 1000}s (check it on bscscan)`);
        await sleep(every);
      }
    },
  };
  return rpc;
}
