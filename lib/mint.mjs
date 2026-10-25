// Mints that only AI wallets may do. Each entry knows how to read the price and limits and build the mint call;
// anything else goes through `aiwb call`. Add a new one by copying the shape of `bnworld`.
import { encodeCall, selector, isAddress } from './abi.mjs';
import { fromWei, toWei } from './engine.mjs';
import { simulate } from './sim.mjs';

export const MINTS = {
  // BN World "Onchain Agents": 10,000 on-chain pixel avatars; only a wallet holding a .ai Agent ID can mint, and only to
  // itself. 2 free per wallet, then $1 each (in BNB at Chainlink's price), at most 12 per wallet.
  // Source: https://bncworld.fun/agents/llms.txt (read 2026-10-25).
  bnworld: {
    name: 'BN World Onchain Agents',
    nft: '0xC4605C6A7765138784B3ca6F9a88e1c249a0d21f',
    errors: { '0xf947691f': 'this wallet has no Agent ID', '0x589ed34b': 'mint is closed', '0x888e58a8': 'quantity must be 1 to 12', '0xb92612ed': 'over the 12-per-wallet limit', '0x52df9fe5': 'sold out', '0x949ce241': 'underpaid', '0x19abf40e': 'BNB price is stale; try later' },
    async plan({ rpc, me, qty }) {
      const n = this.nft;
      const [open, ended, minted, has, left, quote] = await Promise.all([
        rpc.read(n, 'mintOpen()', [], ['bool']), rpc.read(n, 'mintEnded()', [], ['bool']), rpc.read(n, 'totalMinted()', [], ['uint256']), rpc.read(n, 'hasAgentId(address)', [me], ['bool']),
        rpc.read(n, 'mintable(address,uint256)', [me, qty], ['uint256', 'uint256']).catch(() => null),
        rpc.read(n, 'quote(address,uint256)', [me, qty], ['uint256', 'uint256', 'uint256', 'uint256']).catch(() => null),
      ]);
      if (minted >= 10000n) throw new Error('Sold out: all 10,000 are minted. They trade on https://bncworld.fun/market/?c=agents');
      if (!open || ended) throw new Error('This mint is not open.');
      if (!has) throw new Error('Only wallets with a Binance Agent ID (.ai name) can mint this. Claim one in the Binance App first.');
      if (!quote) throw new Error('The contract would not quote this mint (over the 12-per-wallet limit?).');
      const [bnbWei, , , paid] = quote;
      const value = bnbWei + bnbWei / 100n; // +1% for price movement; the contract refunds the rest
      return { to: n, data: encodeCall('mint(uint256)', [qty]), value, note: `${qty} piece(s), ${Number(qty) - Number(paid)} free, ${paid} paid: ${fromWei(bnbWei)} BNB (+1% buffer, refunded)${left ? `; wallet can still mint ${left[1]}` : ''}` };
    },
  },
};

// ---------- any NFT mint or presale ----------
// Given only the contract, find how to mint: read the usual price getters, try the usual mint functions in a
// simulation from this wallet, keep the first one that succeeds and delivers NFTs to it. Presales that need a
// signature or allowlist proof from the project's website can't be found this way: use `aiwb call` with the proof.
const PRICE_GETTERS = ['price()', 'mintPrice()', 'cost()', 'PRICE()', 'MINT_PRICE()', 'publicPrice()', 'publicSalePrice()', 'salePrice()', 'getPrice()', 'mintFee()', 'presalePrice()', 'whitelistPrice()'];
const MINT_FNS = [
  ['mint(uint256)', q => [q]], ['publicMint(uint256)', q => [q]], ['mintPublic(uint256)', q => [q]], ['publicSaleMint(uint256)', q => [q]],
  ['presaleMint(uint256)', q => [q]], ['whitelistMint(uint256)', q => [q]], ['purchase(uint256)', q => [q]], ['buy(uint256)', q => [q]],
  ['mint(address,uint256)', (q, me) => [me, q]], ['safeMint(address,uint256)', (q, me) => [me, q]], ['mint()', () => []], ['claim()', () => []],
];
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer, 4 topics for ERC721
const T1155 = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'; // TransferSingle
const T1155B = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'; // TransferBatch
const to32 = t => ('0x' + String(t).slice(26)).toLowerCase();

// NFTs (ERC721 or ERC1155) the simulated calls delivered to `me`, per contract.
export function nftsTo(results, me) {
  const out = {};
  for (const r of results) for (const l of r.logs || []) {
    const t = l.topics || [];
    let n = 0;
    if (t[0] === T721 && t.length === 4 && to32(t[2]) === me.toLowerCase()) n = 1;
    else if ((t[0] === T1155 || t[0] === T1155B) && t.length === 4 && to32(t[3]) === me.toLowerCase()) n = t[0] === T1155 ? Number(BigInt('0x' + l.data.slice(66, 130))) : 1;
    if (n) out[l.address.toLowerCase()] = (out[l.address.toLowerCase()] || 0) + n;
  }
  return out;
}

const plain = msg => {
  const m = String(msg || '');
  if (/not (active|open|started|live)|paused|closed|ended|sale.*(off|inactive)/i.test(m)) return 'mint is not open (yet)';
  if (/whitelist|allowlist|not eligible|proof|merkle|signature|signer/i.test(m)) return 'needs an allowlist spot or a signature from the project';
  if (/sold out|max supply|exceeds supply|supply/i.test(m)) return 'sold out or not enough left';
  if (/insufficient|price|value|ether|funds|pay/i.test(m)) return 'wrong price';
  if (/limit|max per|per wallet|exceed/i.test(m)) return 'over the per-wallet limit';
  const r = m.replace(/^execution reverted:?\s*/i, '');
  if (!r || r === '0x') return 'reverts without saying why (not this function, or a check like an allowlist)';
  if (/^0x[0-9a-f]{8}$/i.test(r)) return `refused by the contract (error code ${r})`;
  return r;
};

export async function findMint({ rpc, me, contract, qty = 1n, priceBnb, fn }) {
  const code = String(await rpc.code(contract)).toLowerCase();
  if (code === '0x') throw new Error('No contract at this address on BNB Chain.');
  const prices = new Set([0n]);
  if (priceBnb != null) prices.add(toWei(String(priceBnb)));
  else for (const v of await Promise.all(PRICE_GETTERS.map(g => rpc.read(contract, g, [], ['uint256']).catch(() => null)))) if (v != null && v < 10n ** 22n) prices.add(v);
  // Functions whose selector appears in the code first (proxies hide them, so the rest are still tried).
  const fns = fn ? [[fn, (q, me) => (/\(address,uint256\)/.test(fn) ? [me, q] : /\(\)/.test(fn) ? [] : [q])]] : MINT_FNS;
  const ordered = [...fns].sort((a, b) => code.includes('63' + selector(b[0]).slice(2)) - code.includes('63' + selector(a[0]).slice(2)));
  const tries = [];
  for (const [sig, argsOf] of ordered) for (const unit of [...prices].sort((a, b) => (b > a) - (b < a))) {
    const value = unit * qty;
    let data;
    try { data = encodeCall(sig, argsOf(qty, me)); } catch { continue; }
    tries.push({ sig, value, unit, data });
  }
  // One request for all tries (they run in order on the same state; the first one that delivers NFTs wins).
  const sims = await simulate(rpc, me, tries.map(t => ({ to: contract, value: t.value, data: t.data })));
  const reasons = new Map();
  for (const [i, r] of sims.entries()) {
    const got = r.ok ? nftsTo([r], me) : {};
    const total = Object.values(got).reduce((a, b) => a + b, 0);
    if (r.ok && total > 0) return { ok: true, to: contract, data: tries[i].data, value: tries[i].value, fn: tries[i].sig, unitPrice: tries[i].unit, nfts: got, count: total };
    if (!r.ok) reasons.set(plain(r.error), (reasons.get(plain(r.error)) || 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3);
  return { ok: false, reasons: top.length ? top : ['no known mint function worked'] };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function run({ engine, rpc, wallet, args, flags, show }) {
  const [key, qtyArg] = args;
  const qty = BigInt(qtyArg || 1);
  const txOpts = { gasLimit: flags['gas-limit'] != null ? Number(flags['gas-limit']) : undefined, speedUpAfterSec: flags['speed-up'] != null ? Number(flags['speed-up']) : undefined };
  const me = await wallet.address();
  if (MINTS[key]) {
    const m = MINTS[key];
    const p = await m.plan({ rpc, me, qty });
    if (flags.dry) {
      const r = await engine.call({ ...p, label: `mint ${m.name}`, dryRun: true, ...txOpts });
      return show({ ...p, preview: r.preview }, `[dry run] ${m.name}: ${p.note}\nBinance simulation: ${r.preview.ok ? 'OK' : 'FAILS: ' + r.preview.reason}. Nothing sent.`);
    }
    const r = await engine.call({ ...p, label: `mint ${m.name}`, ...txOpts });
    return show({ ...r, note: p.note }, `minted: ${p.note}\nhttps://bscscan.com/tx/${r.hash}`);
  }
  if (!isAddress(key)) throw new Error(`usage: aiwb mint <contract> [qty] [--price <BNB each>] [--fn "mint(uint256)"] [--wait <sec>] [--dry]. Known names: ${Object.keys(MINTS).join(', ')}`);
  if (flags['max-price'] == null) throw new Error('missing --max-price (the most BNB the user will pay per piece). There is no default: ask the user.');
  const maxEach = toWei(String(flags['max-price']));
  // --wait: keep simulating until the mint opens (presale start), then send at once.
  const end = Date.now() + Number(flags.wait || 0) * 1000;
  let f;
  for (;;) {
    f = await findMint({ rpc, me, contract: key, qty, priceBnb: flags.price, fn: flags.fn });
    if (f.ok || Date.now() >= end) break;
    await sleep(1000);
  }
  if (!f.ok) throw new Error(`Could not mint from this wallet right now: ${f.reasons.join('; ')}. Nothing was sent.${f.reasons.some(r => /allowlist|signature/.test(r)) ? ' If the project gives you a proof or signature on its website, use aiwb call with it.' : ''}`);
  if (f.unitPrice > maxEach) throw new Error(`Refused: the mint costs ${fromWei(f.unitPrice)} BNB each, above your --max-price ${flags['max-price']}. Nothing was sent.`);
  const note = `${f.count} NFT(s) via ${f.fn}, ${fromWei(f.value)} BNB total`;
  if (flags.dry) {
    const r = await engine.call({ to: f.to, data: f.data, value: f.value, label: 'mint', dryRun: true, ...txOpts });
    return show({ ...f, preview: r.preview }, `[dry run] would mint ${note}. Binance simulation: ${r.preview.ok ? 'OK' : 'FAILS: ' + r.preview.reason}. Nothing sent.`);
  }
  const r = await engine.call({ to: f.to, data: f.data, value: f.value, label: 'mint', ...txOpts });
  return show({ ...r, ...f }, `minted ${note}\nhttps://bscscan.com/tx/${r.hash}`);
}
