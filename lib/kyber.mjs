// KyberSwap's public aggregator API (no key): it prices a swap across every BNB Chain DEX it knows (PancakeSwap V3 and
// Infinity, Uniswap, Thena, ...) and builds the transaction for its router. aiwb never trusts that transaction as is:
// it must go to the router below and send exactly the BNB being swapped, and route.mjs simulates it before use.
// Nothing about you is sent besides the wallet address the coins come back to.
import { same } from './abi.mjs';

export const KYBER = {
  router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', // MetaAggregationRouterV2
  native: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  api: 'https://aggregator-api.kyberswap.com/bsc/api/v1',
};
// Kyber caps slippage at 20% unless told otherwise; aiwb's own limit (and a coin's tax) can be above that.
const KYBER_SLIPPAGE_CAP = 2000;

// tokenIn / tokenOut: a coin address, or null for BNB.
export function createKyber({ fetchImpl = globalThis.fetch, api = KYBER.api, timeoutMs = 6000 } = {}) {
  async function request(path, init = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let j;
    try {
      const res = await fetchImpl(`${api}${path}`, { ...init, signal: ctl.signal, headers: { 'X-Client-Id': 'aiwb', 'Content-Type': 'application/json' } });
      j = await res.json();
    } catch (e) {
      throw new Error(`KyberSwap did not answer (${e.name === 'AbortError' ? 'timed out' : e.message})`);
    } finally { clearTimeout(timer); }
    if (j?.code !== 0 || !j.data) throw new Error(`KyberSwap: ${j?.message || 'no route'}`);
    if (!same(j.data.routerAddress, KYBER.router)) throw new Error('KyberSwap answered with an unknown router');
    return j.data;
  }

  return {
    async route(tokenIn, tokenOut, amountIn) {
      const q = new URLSearchParams({ tokenIn: tokenIn ?? KYBER.native, tokenOut: tokenOut ?? KYBER.native, amountIn: String(amountIn), gasInclude: 'true' });
      const d = await request(`/routes?${q}`);
      const s = d.routeSummary;
      if (!s?.amountOut) throw new Error('KyberSwap: no route');
      return { tokenIn, tokenOut, amountIn: BigInt(amountIn), amountOut: BigInt(s.amountOut), summary: s, venues: [...new Set((s.route || []).flat().map(x => x.exchange))] };
    },
    // The swap transaction for a route from route(), paying to `me`, with at most slippageBps below the quote.
    async build(r, slippageBps, me) {
      const d = await request('/route/build', {
        method: 'POST',
        body: JSON.stringify({ routeSummary: r.summary, sender: me, recipient: me, slippageTolerance: slippageBps, ignoreCappedSlippage: slippageBps > KYBER_SLIPPAGE_CAP, deadline: Math.floor(Date.now() / 1000) + 120, source: 'aiwb' }),
      });
      const value = BigInt(d.transactionValue ?? 0);
      if (value !== (r.tokenIn == null ? r.amountIn : 0n)) throw new Error('KyberSwap built a transaction that sends an unexpected amount of BNB');
      if (!/^0x[0-9a-fA-F]{8,}$/.test(d.data || '')) throw new Error('KyberSwap built an empty transaction');
      return { to: KYBER.router, value, data: d.data };
    },
  };
}
