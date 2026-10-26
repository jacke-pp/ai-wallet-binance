// Pool depth. aiwb swaps on PancakeSwap V2, but many coins (and quote coins such as BNCB or NVDAB) keep most of their
// money in a PancakeSwap V3 pool or against USDT, with only a thin V2 BNB pool beside it. Swapping through the thin
// pool pays a far worse price, and slippage doesn't stop it: the minimum is worked out from that same pool.
// So every V2 swap in a trade is measured first, and the trade is refused when it would move the price more than
// maxImpactPct (default 5). poolsOf() then says where the deep pool is.
import { ZERO, same } from './abi.mjs';
import { PANCAKE } from './platforms/pancake.mjs';

export const V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const V3_FEES = [100, 500, 2500, 10000];
export const DOLLARS = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USD1: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};
export const DEFAULT_MAX_IMPACT_PCT = 5;

const amountOut = async (rpc, amount, path) => (await rpc.read(PANCAKE.router, 'getAmountsOut(uint256,address[])', [amount, path], ['uint256[]'])).at(-1);

// How much worse than the pool's own price `amountIn` gets along `path`, in %. Compared with a 1/1000 slice of the
// same swap, so pool fees and coin taxes cancel out and only the depth is left.
export async function priceImpact(rpc, amountIn, path) {
  const slice = amountIn / 1000n;
  if (slice === 0n) return 0;
  const [whole, part] = await Promise.all([amountOut(rpc, slice * 1000n, path), amountOut(rpc, slice, path)]);
  const ideal = part * 1000n;
  if (ideal === 0n) return 100;
  return Math.max(0, Number(((ideal - whole) * 10000n) / ideal) / 100);
}

// The PancakeSwap V2 and V3 pools of `coin` against BNB and the dollar coins, deepest first. depthBnb = the BNB or
// dollar side the pool holds, in BNB.
export async function poolsOf(rpc, coin) {
  const quotes = { BNB: PANCAKE.wbnb, ...DOLLARS };
  const dollarsPerBnb = await amountOut(rpc, 10n ** 18n, [PANCAKE.wbnb, DOLLARS.USDT]).catch(() => 0n);
  const inBnb = (name, held) => name === 'BNB' ? Number(held) / 1e18 : dollarsPerBnb ? Number(held) / Number(dollarsPerBnb) : null;
  const isPool = a => a && !same(a, ZERO);
  const jobs = [];
  for (const [name, q] of Object.entries(quotes)) {
    if (same(q, coin)) continue;
    jobs.push(rpc.read(PANCAKE.factory, 'getPair(address,address)', [coin, q], ['address']).then(a => isPool(a) && { dex: 'PancakeSwap V2', quote: name, quoteAddr: q, pool: a }).catch(() => null));
    for (const fee of V3_FEES) {
      jobs.push(rpc.read(V3_FACTORY, 'getPool(address,address,uint24)', [coin, q, fee], ['address']).then(a => isPool(a) && { dex: 'PancakeSwap V3', fee: fee / 10000, quote: name, quoteAddr: q, pool: a }).catch(() => null));
    }
  }
  const pools = (await Promise.all(jobs)).filter(Boolean);
  // A pool whose balance can't be read is left out rather than counted as empty.
  await Promise.all(pools.map(async p => {
    const held = await rpc.read(p.quoteAddr, 'balanceOf(address)', [p.pool], ['uint256']).catch(() => null);
    const bnb = held == null ? null : inBnb(p.quote, held);
    p.depthBnb = bnb == null ? null : Math.round(bnb * 1000) / 1000;
  }));
  return pools.filter(p => p.depthBnb != null).sort((a, b) => b.depthBnb - a.depthBnb).map(({ quoteAddr, ...p }) => p);
}

export const poolName = p => `${p.dex} ${p.quote}${p.fee != null ? ` ${p.fee}%` : ''}`;

// Measure every V2 swap a plan makes (plan.v2Legs: [{ amountIn, path }]). Returns the worst impact in % (null when
// the plan swaps nothing on V2).
export async function worstImpact(rpc, legs = []) {
  if (!legs.length) return null;
  const all = await Promise.all(legs.map(l => priceImpact(rpc, l.amountIn, l.path).catch(() => null)));
  const known = all.filter(x => x != null);
  return known.length ? Math.max(...known) : null;
}

// Why a swap was refused, in plain words: for each coin on the swap's route, how deep its V2 BNB pool is and where
// its deepest pool is.
export async function shallowReason(rpc, legs) {
  const coins = [...new Set(legs.flatMap(l => l.path).filter(a => !same(a, PANCAKE.wbnb)).map(a => a.toLowerCase()))];
  const lines = await Promise.all(coins.map(async c => {
    const [sym, pools] = await Promise.all([rpc.read(c, 'symbol()', [], ['string']).catch(() => c.slice(0, 10)), poolsOf(rpc, c).catch(() => [])]);
    const v2 = pools.find(p => p.dex === 'PancakeSwap V2' && p.quote === 'BNB');
    const best = pools[0];
    if (!best || best === v2) return v2 ? `${sym}: its PancakeSwap V2 BNB pool holds about ${v2.depthBnb} BNB.` : null;
    return `${sym}: the PancakeSwap V2 BNB pool holds about ${v2?.depthBnb ?? 0} BNB, but its deepest pool is ${poolName(best)} with about ${best.depthBnb} BNB.`;
  }));
  return lines.filter(Boolean).join(' ');
}
