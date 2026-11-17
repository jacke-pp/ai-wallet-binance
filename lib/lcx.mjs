// LCX Liberty DEX's swap API (https://dex.lcx.com/docs), used only with your own key (free at
// https://dex.lcx.com/dashboard, saved with `aiwb config set lcxKey <key>`). Like KyberSwap it prices a swap across BNB
// Chain DEX pools and builds the transaction for its router. aiwb never trusts that transaction as is: the quote and
// the build must name the router below, the same coins, amount and minimum, and exactly the BNB being swapped, and
// route.mjs simulates it before use. Nothing about you is sent besides the key and the wallet address the coins come
// back to.
import { same, ZERO } from './abi.mjs';

export const LCX = {
  chainId: 56,
  router: '0x0000000000654902B6Ed6cC240cc81CB4c4a3dff',
  native: ZERO,
  api: 'https://swap-api.lcx.com/v1',
};
const LCX_SLIPPAGE_CAP = 2000; // the API's highest slippage

// tokenIn / tokenOut: a coin address, or null for BNB.
export function createLcx({ key, fetchImpl = globalThis.fetch, api = LCX.api, timeoutMs = 6000 } = {}) {
  async function request(path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res, j;
    try {
      res = await fetchImpl(`${api}${path}`, { method: 'POST', body: JSON.stringify(body), signal: ctl.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
      j = await res.json();
    } catch (e) {
      throw new Error(`LCX Liberty DEX did not answer (${e.name === 'AbortError' ? 'timed out' : e.message})`);
    } finally { clearTimeout(timer); }
    if (j?.success === true && j.data) return j.data;
    const code = j?.code || `HTTP ${res.status}`;
    // A refused key or a used-up quota is worth a warning. Anything else (no route, too little liquidity, a coin with a
    // transfer tax or blocked transfers: 422 transfer_tax / transfer_blocked) only means no LCX Liberty DEX route.
    if ([401, 403, 429].includes(res.status)) throw Object.assign(new Error(`LCX Liberty DEX refused the request (${code}): ${j?.message || 'check your key'}`), { notice: true });
    throw new Error(`LCX Liberty DEX: no route (${code})`);
  }

  async function quote(tokenIn, tokenOut, amountIn, slippageBps = 50) {
    const req = { chainId: LCX.chainId, tokenIn: tokenIn ?? LCX.native, tokenOut: tokenOut ?? LCX.native, amountIn: String(amountIn), slippageBps };
    const q = (await request('/quote', req)).quote;
    if (Number(q?.chainId) !== LCX.chainId || !same(q.spender, LCX.router)) throw new Error('LCX Liberty DEX answered with an unknown router');
    if (BigInt(q.input?.amount ?? -1) !== BigInt(amountIn) || !same(q.input.token, req.tokenIn) || !same(q.output?.token, req.tokenOut)) throw new Error('LCX Liberty DEX quoted a different swap');
    if (q.stale) throw new Error('LCX Liberty DEX: no route (its prices are behind the chain right now)');
    if (!(BigInt(q.output.amount ?? 0) > 0n)) throw new Error('LCX Liberty DEX: no route');
    return q;
  }

  return {
    async route(tokenIn, tokenOut, amountIn) {
      const q = await quote(tokenIn, tokenOut, amountIn);
      return { tokenIn, tokenOut, amountIn: BigInt(amountIn), amountOut: BigInt(q.output.amount), quote: q, venues: q.venues || [] };
    },
    // The swap transaction for a route from route(), paying to `me`, with at most slippageBps below the quote. The
    // slippage is fixed on a quote, so this quotes again with it. floor: the minimum the transaction enforces.
    async build(r, slippageBps, me) {
      if (slippageBps > LCX_SLIPPAGE_CAP) throw new Error(`LCX Liberty DEX takes at most ${LCX_SLIPPAGE_CAP / 100}% slippage`);
      const q = await quote(r.tokenIn, r.tokenOut, r.amountIn, slippageBps);
      const d = await request('/build', { quoteId: q.quoteId, recipient: me, slippageBps });
      const s = d.swap || {};
      if (Number(s.chainId) !== LCX.chainId || !same(s.to, LCX.router) || d.routerDeployed !== true) throw new Error('LCX Liberty DEX built a transaction for an unknown router');
      if (BigInt(d.minAmountOut ?? -1) !== BigInt(q.output.minimumAmount ?? -2)) throw new Error('LCX Liberty DEX built a transaction with a different minimum than it quoted');
      const value = BigInt(s.value ?? 0);
      if (value !== (r.tokenIn == null ? r.amountIn : 0n)) throw new Error('LCX Liberty DEX built a transaction that sends an unexpected amount of BNB');
      if (!/^0x[0-9a-fA-F]{8,}$/.test(s.data || '')) throw new Error('LCX Liberty DEX built an empty transaction');
      return { to: LCX.router, value, data: s.data, floor: BigInt(d.minAmountOut) };
    },
  };
}
