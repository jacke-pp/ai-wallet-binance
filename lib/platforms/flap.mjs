// Flap's own bonding curve (Flap Portal). Agent coins land here once their agent-only stage fills, and many ordinary
// Flap coins trade here too. Status 1 = on the curve (handled here), 4 = moved to a DEX pool (PancakeSwap handler).
// Coins priced in another coin are traded through the Portal's own BNB swap when it offers one; otherwise skipped.
import { encodeCall, ZERO, same } from '../abi.mjs';

export const FLAP_PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';
const STATE = '(uint8,uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,address,bool,bytes32,uint256,uint256,address,uint256,uint8,uint8)';

export async function state(rpc, token) {
  const s = await rpc.read(FLAP_PORTAL, 'getTokenV8Safe(address)', [token], [STATE]);
  return { status: Number(s[0]), quote: s[9], nativeSwap: s[10], buyTax: s[12], sellTax: s[13], progress: s[15] };
}

export async function detect(ctx, token) {
  const s = await state(ctx.rpc, token).catch(() => null);
  if (!s || s.status !== 1) return null;
  if (!same(s.quote, ZERO) && !s.nativeSwap) return null;
  return { platform: 'flap', phase: 'curve', agentOnly: false, quote: s.quote, buyTaxPct: Number(s.buyTax) / 100, sellTaxPct: Number(s.sellTax) / 100, progress: Number(s.progress) / 1e16 };
}

const quote = (rpc, from, input, output, amount) => rpc.read(FLAP_PORTAL, 'quoteExactInput((address,address,uint256))', [[input, output, amount]], ['uint256'], { from });
const swap = (input, output, amount, min) => encodeCall('swapExactInput((address,address,uint256,uint256,bytes))', [[input, output, amount, min, '0x']]);

export async function buy(ctx, info, bnbIn) {
  const out = await quote(ctx.rpc, ctx.me, ZERO, info.token, bnbIn);
  const minOut = (out * (10000n - ctx.slippageBps)) / 10000n;
  return { expectedOut: out, minOut, via: 'Flap Portal', steps: [{ label: 'buy', tx: { to: FLAP_PORTAL, value: bnbIn, data: swap(ZERO, info.token, bnbIn, minOut) } }] };
}

export async function sell(ctx, info, amount) {
  const out = await quote(ctx.rpc, ctx.me, info.token, ZERO, amount);
  const minOut = (out * (10000n - ctx.slippageBps)) / 10000n;
  return { expectedOut: out, minOut, via: 'Flap Portal', approve: { token: info.token, spender: FLAP_PORTAL, amount },
    steps: [{ label: 'sell', tx: { to: FLAP_PORTAL, value: 0n, data: swap(info.token, ZERO, amount, minOut) } }] };
}
