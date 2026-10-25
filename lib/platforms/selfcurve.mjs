// Coins that are their own bonding curve and only sell to wallets holding a pass NFT (first seen 2026-10-20: a coin
// whose nftContract() is the Binance Agent ID registry). On the curve: buyWithBNB() / buy(amount) / sell(amount) on the
// coin itself, and the coin checks msg.sender, so the AI wallet must call the coin directly (a router in between
// fails). graduated() == true means it moved to a Pancake pool and trades like any coin.
// Recognized by its bytecode carrying all four entry points, not by a deployer or an address list.
import { encodeCall, selector, ZERO, same } from '../abi.mjs';
import { simulate, delivered, NATIVE } from '../sim.mjs';

const ENTRY = ['buyWithBNB()', 'buy(uint256)', 'sell(uint256)', 'graduated()'].map(s => selector(s).slice(2));
export const hasEntryPoints = code => ENTRY.every(s => String(code).toLowerCase().includes(`63${s}`)); // PUSH4 <selector>

export async function detect(ctx, token) {
  const nft = await ctx.rpc.read(token, 'nftContract()', [], ['address']).catch(() => null);
  if (!nft || same(nft, ZERO)) return null;
  if (!hasEntryPoints(await ctx.rpc.code(token))) return null;
  const graduated = await ctx.rpc.read(token, 'graduated()', [], ['bool']);
  if (graduated) return null; // the Pancake handler takes it from here
  const cap = await ctx.rpc.read(token, 'MAX_WALLET()', [], ['uint256']).catch(() => null);
  return { platform: 'self-curve', phase: 'curve', agentOnly: true, gate: nft, walletCap: cap };
}

function why(msg) {
  if (/required NFT/i.test(msg)) return 'Only a wallet with a Binance Agent ID can buy this coin before it graduates.';
  if (/wallet cap|MAX_WALLET/i.test(msg)) return 'This coin limits how much one wallet may hold. Buy less.';
  if (/Exceeds curve supply/i.test(msg)) return 'Not that many coins left on the curve. Buy less.';
  if (/Graduated/i.test(msg)) return 'This coin just graduated to Pancake. Try again.';
  return msg;
}

export async function buy(ctx, info, bnbIn) {
  const [r] = await simulate(ctx.rpc, ctx.me, [{ to: info.token, data: encodeCall('buyWithBNB()'), value: bnbIn }]);
  if (!r.ok) throw new Error(why(r.error || 'buy reverts'));
  const all = delivered([r], info.token, ctx.me);
  if (all <= 0n) throw new Error('This BNB buys no coins on the curve.');
  const amount = (all * (10000n - ctx.slippageBps)) / 10000n;
  return {
    expectedOut: all, minOut: amount, via: "the coin's own curve",
    warnings: ['Buys exactly the minimum shown; BNB not needed comes back in the same transaction.'],
    steps: [{ label: 'buy', tx: { to: info.token, value: bnbIn, data: encodeCall('buy(uint256)', [amount]) } }],
  };
}

export async function sell(ctx, info, amount) {
  const tx = { to: info.token, value: 0n, data: encodeCall('sell(uint256)', [amount]) };
  const [r] = await simulate(ctx.rpc, ctx.me, [tx]);
  if (!r.ok) throw new Error(why(r.error || 'sell reverts'));
  const back = delivered([r], NATIVE, ctx.me);
  return {
    expectedOut: back, minOut: back, via: "the coin's own curve",
    warnings: ["This coin's sell has no minimum price on chain: the price is checked just before sending."],
    steps: [{ label: 'sell', tx }],
  };
}
