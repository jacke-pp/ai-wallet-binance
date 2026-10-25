// Agent-only launchpads on BNB Chain as plain functions: no RPC client, no wallet, no network. Feed in what you read
// from the chain (raw eth_call results, logs, block numbers) and get back calls to make and transactions to send as
// { to, value, data }. Used by aiwb's own handlers (lib/platforms/*), and meant to be copied into other tools with
// abi.mjs next to it (encoding and keccak, also dependency-free). Researched on chain 2026-10-23..25; see each pad.
//
// Typical use: reads.x(...) -> eth_call each { to, data } -> parse.x(raw) -> decide -> tx.x(...) -> send.
import { encodeArgs, encodeCall, decode, topic, ZERO, same } from './abi.mjs';

const word = (hex, i) => '0x' + hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const addrAt = (hex, i) => '0x' + word(hex, i).slice(26);
const call = (to, data) => ({ to, data });
const minOut = (x, slippageBps) => (x * (10000n - BigInt(slippageBps))) / 10000n;
export { minOut };

// ---------------------------------------------------------------------------------------------------------------
// Four.meme "Binance Agent ID Exclusive" coins
// - FourCore (newer Four contract, not TokenManager2), template 1778027615735. Only a caller holding a Binance Agent ID
//   may buy (checked on msg.sender: the AI wallet itself must call; routers/contracts are refused). Selling on the
//   curve needs no Agent ID. Coins are not transferable until graduation.
// - One wallet may hold at most 1% (10M of 1B coins): a bigger buy is cut short and the rest of the BNB refunded.
// - Buyer pays 1% platform fee + creator tax (buyFeeRate on the coin, basis points, 0..1000) + an optional opening fee
//   that falls by blocks since creation: 49, 24, 14, 9, 4% for blocks 1..5, then 0. Seller pays 1% + sellFeeRate.
// - Whitelist: a separate contract answers (templateId, wallet) -> bool. While Four ran it closed only its own test
//   wallets passed; since 2026-10-25 04:04 UTC it answers true for every wallet.
// - tokenPhase() on the coin: 1 = curve, 3 = PancakeSwap V2 pool (graduated at the record's target, 13.4-13.6 BNB),
//   else in between. BNB raised so far: ask the coin's vault (record word 10), or read totalRaised off each trade.
// - No quote function: price buys and sells by simulating the tx (eth_simulateV1 / eth_call with value).
export const FOUR_AGENT = {
  core: '0xebe7b6c1089d9f72ad07f34e36d898e44e5e27f3',
  whitelist: '0x7b377ad70a20556f4778c4cd878a68a7e7efabbc',
  template: 1778027615735n,
  maxPerWallet: 10_000_000n * 10n ** 18n,
  openingFeePct: [null, 49, 24, 14, 9, 4], // by blocks since creation; block 0 never seen
  phase: { curve: 1n, pool: 3n },
  // names not published; raised(token) is on the coin's vault and matched every trade's totalRaised (12 coins, 2026-10-26)
  selectors: { buy: '0x995ee6da', whitelistAllowed: '0x371befa6', raised: '0xc5c4744c' },
  // TokenCreated-like event on FourCore: topics [sig, template, creator, token]
  created: { address: '0xebe7b6c1089d9f72ad07f34e36d898e44e5e27f3', topic0: '0x7dae4dcd1b20eb0445e7cc1d02b3e2e7f32fa63081a0e764732c269f2b8f228f' },
};
// TradeExecuted(token, trader, template indexed; isBuy, quote, vault, requested, tokens, curveQuote, traderQuote,
// lastPrice, slippage, protocolFee, taxFee, devFee, antiSniperFee, totalRaised, remainingForSale)
FOUR_AGENT.trade = { address: FOUR_AGENT.core, topic0: topic('TradeExecuted(address,address,uint256,bool,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)') };
FOUR_AGENT.created.topics = [FOUR_AGENT.created.topic0, '0x' + FOUR_AGENT.template.toString(16).padStart(64, '0')];

export const four = {
  reads: {
    record: token => call(FOUR_AGENT.core, encodeCall('tokens(address)', [token])),
    phase: token => call(token, encodeCall('tokenPhase()')),
    buyFeeRate: token => call(token, encodeCall('buyFeeRate()')),
    sellFeeRate: token => call(token, encodeCall('sellFeeRate()')),
    balance: (token, wallet) => call(token, encodeCall('balanceOf(address)', [wallet])),
    raised: (vault, token) => call(vault, FOUR_AGENT.selectors.raised + encodeArgs(['address'], [token]).slice(2)),
    allowed: wallet => call(FOUR_AGENT.whitelist, FOUR_AGENT.selectors.whitelistAllowed + encodeArgs(['uint256', 'address'], [FOUR_AGENT.template, wallet]).slice(2)),
  },
  parse: {
    // tokens(address) on FourCore: word 0 = exists (1), 1 = creator, 2 = template, 6 = supply, 8 = target (BNB to
    // graduate), 9 = quote coin (WBNB), 10 = vault, 16 = created block, 19 = opening fee on (1). Null if unknown.
    record(raw) {
      if (!raw || raw.length < 2 + 20 * 64 || BigInt(word(raw, 0)) !== 1n) return null;
      return { creator: addrAt(raw, 1), template: BigInt(word(raw, 2)), supply: BigInt(word(raw, 6)), target: BigInt(word(raw, 8)), quote: addrAt(raw, 9), vault: addrAt(raw, 10),
        createdBlock: BigInt(word(raw, 16)), openingFee: BigInt(word(raw, 19)) === 1n };
    },
    // Log with topic0 FOUR_AGENT.trade.topic0. price = BNB per whole coin, in wei.
    trade: log => ({ token: '0x' + log.topics[1].slice(26), trader: '0x' + log.topics[2].slice(26), template: BigInt(log.topics[3]), buy: BigInt(word(log.data, 0)) === 1n,
      price: BigInt(word(log.data, 7)), raised: BigInt(word(log.data, 13)), left: BigInt(word(log.data, 14)), block: log.blockNumber != null ? BigInt(log.blockNumber) : null }),
    uint: raw => BigInt(raw && raw !== '0x' ? raw : 0),
    allowed: raw => BigInt(raw && raw !== '0x' ? raw : 0) === 1n,
    // Log from FourCore with topics FOUR_AGENT.created.topics -> the new coin.
    created: log => ({ token: '0x' + log.topics[3].slice(26), creator: '0x' + log.topics[2].slice(26), block: log.blockNumber != null ? BigInt(log.blockNumber) : null }),
  },
  isAgentCoin: rec => !!rec && rec.template === FOUR_AGENT.template,
  openingFeePct(rec, block) {
    if (!rec?.openingFee) return 0;
    const n = Number(BigInt(block) - rec.createdBlock);
    return n >= FOUR_AGENT.openingFeePct.length ? 0 : (FOUR_AGENT.openingFeePct[n] ?? 99);
  },
  // Total % a buyer / seller pays now. buyFeeRate / sellFeeRate are the coin's basis-point getters.
  taxes(rec, block, buyFeeRate, sellFeeRate) {
    const opening = four.openingFeePct(rec, block);
    return { buyTaxPct: 1 + Number(buyFeeRate) / 100 + opening, sellTaxPct: 1 + Number(sellFeeRate) / 100, openingFeePct: opening };
  },
  // First block at which the total buy tax is at most maxPct (null if the creator tax alone is above it).
  blockWhenTaxAtMost(rec, buyFeeRate, maxPct) {
    const base = 1 + Number(buyFeeRate) / 100;
    if (base > maxPct) return null;
    if (!rec.openingFee) return rec.createdBlock;
    for (let n = 1; n < FOUR_AGENT.openingFeePct.length; n++) if (base + FOUR_AGENT.openingFeePct[n] <= maxPct) return rec.createdBlock + BigInt(n);
    return rec.createdBlock + BigInt(FOUR_AGENT.openingFeePct.length);
  },
  roomLeft: held => (held >= FOUR_AGENT.maxPerWallet ? 0n : FOUR_AGENT.maxPerWallet - held),
  tx: {
    buy: (token, funds, minTokens = 0n) => ({ to: FOUR_AGENT.core, value: BigInt(funds), data: FOUR_AGENT.selectors.buy + encodeArgs(['address', 'uint256', 'uint256', 'uint256', 'bytes'], [token, BigInt(funds), BigInt(minTokens), 0n, '0x']).slice(2) }),
    approve: (token, amount) => ({ to: token, value: 0n, data: encodeCall('approve(address,uint256)', [FOUR_AGENT.core, BigInt(amount)]) }),
    sell: (token, amount, minFunds = 0n) => ({ to: FOUR_AGENT.core, value: 0n, data: encodeCall('sell(address,uint256,uint256,uint256,bytes)', [token, BigInt(amount), BigInt(minFunds), 0n, '0x']) }),
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Flap "ID Agent Curve" (flap.sh/apps/agent-bonding-curve, live since 2026-10-23)
// - Each coin starts as a market contract with a virtual curve of non-transferable shares. The real coin (a ...7777
//   address, predictedToken) is created when the market fills (5 BNB for BNB markets); holders then claim.
// - Every trade goes through the portal, which checks msg.sender holds a Binance Agent ID (buys and sells).
// - Fees: 1% each way; 3% of each buy is a launch reserve paid back on sell. Per wallet at most maxSharesPerWallet
//   (2% of supply); a buy past it reverts. quoteBuy ignores the cap, so shrink buys yourself (fitCap below).
// - quote = 0x0 means a BNB market (buy with value). Otherwise the market takes that coin (BNCB, ...): approve it to the
//   MARKET (not the portal) and call buyWithQuote; a sale pays that coin back.
// - Market phase (card word 8): 1 = open; anything else = launched / closed (claim, then trade the real coin).
export const FLAP_AGENT = {
  portal: '0x49387D2E6cbF8FefE856e3FBc3E98a01aC3af062',
  factory: '0xC55820f24015bE7c4f18949D9e1363A3609B300e',
  reader: '0x18Aa6C93f1887a243fdc348C9A77F5136555174a',
  card: '(address,address,string,string,string,address,address,address,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256)[]',
  phaseOpen: 1,
  selectors: { marketCount: '0xec979082', marketAt: '0xb1283e77' }, // on the factory, oldest market first; names not published
  // MarketCreated(creator indexed, market indexed, predictedToken indexed, pair, configHash) on the factory
  created: { address: '0xC55820f24015bE7c4f18949D9e1363A3609B300e', topic0: topic('MarketCreated(address,address,address,address,bytes32)') },
};
FLAP_AGENT.created.topics = [FLAP_AGENT.created.topic0];

export const flapAgent = {
  reads: {
    marketOfToken: addr => call(FLAP_AGENT.factory, encodeCall('marketOfToken(address)', [addr])),
    isMarket: addr => call(FLAP_AGENT.factory, encodeCall('isMarket(address)', [addr])),
    count: () => call(FLAP_AGENT.factory, FLAP_AGENT.selectors.marketCount),
    marketAt: i => call(FLAP_AGENT.factory, FLAP_AGENT.selectors.marketAt + encodeArgs(['uint256'], [BigInt(i)]).slice(2)),
    cards: markets => call(FLAP_AGENT.reader, encodeCall('marketCards(address[])', [markets])), // at most 5 markets a call
    detail: market => call(FLAP_AGENT.reader, encodeCall('marketDetail(address)', [market])),
    maxShares: market => call(market, encodeCall('maxSharesPerWallet()')),
    shares: (market, wallet) => call(market, encodeCall('sharesOf(address)', [wallet])),
    // -> (?, ?, ?, shares out) for a gross amount of BNB / quote coin
    quoteBuy: (market, wallet, gross) => call(FLAP_AGENT.portal, encodeCall('quoteBuy(address,address,uint256)', [market, wallet, BigInt(gross)])),
    // -> (?, ?, ?, BNB / quote coin out) for selling everything
    quoteSellAll: (market, wallet) => call(FLAP_AGENT.portal, encodeCall('quoteSellAll(address,address)', [market, wallet])),
  },
  parse: {
    address: raw => (raw && raw.length >= 66 ? addrAt(raw, 0) : ZERO),
    bool: raw => BigInt(raw && raw !== '0x' ? raw : 0) === 1n,
    uint: raw => BigInt(raw && raw !== '0x' ? raw : 0),
    cards: raw => decode([FLAP_AGENT.card], raw)[0].map(c => ({
      market: c[0], quote: c[1], name: c[2], symbol: c[3], predictedToken: c[5], token: c[6], phase: Number(c[8]), pool: c[9], cap: c[10], progress: Number(c[11]) / 100,
      open: Number(c[8]) === FLAP_AGENT.phaseOpen, bnbMarket: same(c[1], ZERO),
    })),
    quote: raw => decode(['uint256', 'uint256', 'uint256', 'uint256'], raw),
    // marketDetail(market) on the reader: 50 fixed words. pool / cap in the quote coin; launchedAt in unix seconds (0 =
    // open); startBlock = the block the market was made in.
    detail(raw) {
      if (!raw || raw.length < 2 + 50 * 64) return null;
      const n = i => BigInt(word(raw, i));
      return { market: addrAt(raw, 0), creator: addrAt(raw, 1), quote: addrAt(raw, 2), decimals: Number(n(3)), cap: n(4), pool: n(5), progress: Number(n(7)) / 100, phase: Number(n(8)),
        predictedToken: addrAt(raw, 9), token: addrAt(raw, 10), buyFeeBps: Number(n(18)), sellFeeBps: Number(n(19)), buys: Number(n(21)), sells: Number(n(22)),
        holders: Number(n(38)), launchedAt: Number(n(41)), startBlock: Number(n(42)) };
    },
    created: log => ({ market: '0x' + log.topics[2].slice(26), creator: '0x' + log.topics[1].slice(26), predictedToken: '0x' + log.topics[3].slice(26), block: log.blockNumber != null ? BigInt(log.blockNumber) : null }),
  },
  // Which market an address means: marketOfToken(addr) if set, else addr itself if isMarket(addr), else none.
  marketFrom: (addr, marketOfTokenRaw, isMarketRaw) => {
    const m = flapAgent.parse.address(marketOfTokenRaw);
    if (!same(m, ZERO)) return m;
    return flapAgent.parse.bool(isMarketRaw) ? addr : null;
  },
  // Shares this wallet may still buy, keeping 0.5% under the cap for rounding.
  roomLeft: (maxShares, held) => (maxShares * 995n) / 1000n - held,
  // Largest gross amount whose shares fit under room. quoteShares(gross) -> shares (your eth_call of quoteBuy).
  async fitCap(gross, room, quoteShares) {
    if (room <= 0n) return null;
    let shares = await quoteShares(gross);
    if (shares <= room) return { gross, shares, capped: false };
    let lo = 0n, hi = gross;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2n, s = await quoteShares(mid);
      if (s <= room) { lo = mid; shares = s; } else hi = mid;
    }
    return lo > 0n ? { gross: lo, shares, capped: true } : null;
  },
  sellBps: (sell, held) => (sell >= held ? 10000n : (sell * 10000n) / held),
  tx: {
    buy: (market, bnb, minShares = 0n) => ({ to: FLAP_AGENT.portal, value: BigInt(bnb), data: encodeCall('buy(address,uint256)', [market, BigInt(minShares)]) }),
    approveQuote: (quote, market, amount) => ({ to: quote, value: 0n, data: encodeCall('approve(address,uint256)', [market, BigInt(amount)]) }),
    buyWithQuote: (market, amount, minShares = 0n) => ({ to: FLAP_AGENT.portal, value: 0n, data: encodeCall('buyWithQuote(address,uint256,uint256)', [market, BigInt(amount), BigInt(minShares)]) }),
    sellBps: (market, bps, minOut = 0n) => ({ to: FLAP_AGENT.portal, value: 0n, data: encodeCall('sellBps(address,uint256,uint256)', [market, BigInt(bps), BigInt(minOut)]) }),
    claim: market => ({ to: FLAP_AGENT.portal, value: 0n, data: encodeCall('claim(address)', [market]) }),
  },
};
