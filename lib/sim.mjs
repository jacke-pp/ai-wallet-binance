// Simulations on current chain state, run by the RPC node (eth_simulateV1): a buy followed by selling everything it
// delivered, from the user's own wallet address, with a balance top-up so it works on an empty wallet.
// Used for quotes on contracts without a quote function and for the "can I sell it back?" safety check.
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; // traceTransfers reports BNB moves as logs from here
const hex = n => '0x' + BigInt(n).toString(16);
const addrOf = t => ('0x' + t.slice(26)).toLowerCase();

export async function simulate(rpc, from, calls, { block = 'latest', topUp = 10n ** 21n } = {}) {
  const r = await rpc.send('eth_simulateV1', [{
    blockStateCalls: [{ stateOverrides: { [from]: { balance: hex(topUp) } }, calls: calls.map(c => ({ from, to: c.to, data: c.data || '0x', value: hex(c.value || 0n) })) }],
    traceTransfers: true, validation: false,
  }, block]);
  const res = r?.[0]?.calls;
  if (!res || res.length !== calls.length) throw new Error('this RPC node cannot simulate (eth_simulateV1)');
  return res.map(x => ({ ok: x.status === '0x1', returnData: x.returnData, error: x.error?.message || null, logs: x.logs || [], gasUsed: x.gasUsed ? BigInt(x.gasUsed) : null }));
}

// How much of `token` (NATIVE for BNB) the call results moved to `to`.
export function delivered(results, token, to) {
  const want = token.toLowerCase(), me = to.toLowerCase();
  let got = 0n;
  for (const x of results) for (const l of x.logs) {
    if (l.topics?.[0] === TRANSFER && l.topics.length === 3 && l.address.toLowerCase() === want && addrOf(l.topics[2]) === me) got += BigInt(l.data);
  }
  return got;
}
