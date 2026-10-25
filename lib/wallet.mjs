// The only place that moves money: Binance's own Agentic Wallet CLI (`baw`, npm @binance/agentic-wallet).
// Binance holds the key (MPC) and signs; this package never sees a private key, seed phrase or API secret.
// Every transaction goes through `baw contract-call preview` (Binance simulates it and screens its risk) and then
// `baw contract-call execute`. What Binance refuses, or wants confirmed in its App, is not sent.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class WalletError extends Error {
  constructor(message, code, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// Plain-language versions of the Binance errors people actually hit.
const KNOWN = {
  351803: 'Binance blocked this as too risky (its own screen). It usually lets an AI wallet buy a brand-new coin but not sell or move it until the coin has a normal DEX pool. Nothing was sent.',
};

export function findBaw(cfg = {}) {
  if (cfg.baw) return cfg.baw;
  if (process.env.BAW_BIN) return process.env.BAW_BIN;
  const win = process.platform === 'win32';
  for (const dir of (process.env.PATH || '').split(win ? ';' : ':')) {
    for (const name of win ? ['baw.cmd', 'baw.exe', 'baw'] : ['baw']) {
      const p = join(dir, name);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

export function createWallet({ bin, chainId = '56', timeoutMs = 30_000, run } = {}) {
  const exec = run || ((args, timeout = timeoutMs) => new Promise((resolve, reject) => {
    if (!bin) return reject(new WalletError('The Binance Agentic Wallet CLI (baw) is not installed. Run: npm install -g @binance/agentic-wallet', 'NO_BAW'));
    // Windows npm installs baw as a .cmd script, which Node only starts through a shell. Every argument here is a
    // hex string, address, number or fixed word (no spaces or shell characters), so this is safe.
    const shell = process.platform === 'win32' && /\.cmd$/i.test(bin);
    if (shell && args.some(a => !/^[\w.:\-x]+$/.test(String(a)))) return reject(new WalletError('unexpected characters in a wallet command', 'BAD_ARG'));
    execFile(shell ? `"${bin}"` : bin, [...args, '--json'], { timeout, maxBuffer: 1 << 24, shell }, (err, stdout) => {
      let j;
      try { j = JSON.parse(stdout); } catch { return reject(new WalletError(`baw did not answer${err ? `: ${String(err.message).split('\n')[0]}` : ''}`, 'NO_ANSWER')); }
      resolve(j);
    });
  }));

  async function baw(args, timeout) {
    const j = await exec(args, timeout);
    if (j?.success) return j.data;
    const code = j?.error?.code ?? j?.code;
    const name = j?.error?.name || '';
    const msg = j?.error?.message || j?.message || 'refused';
    if (code === 'NOT_LOGGED_IN' || name === 'NOT_LOGGED_IN' || /not logged in|unconnected/i.test(msg)) {
      throw new WalletError('The AI wallet is not signed in. Run `aiwb login` and scan the QR code with the Binance App.', 'NOT_LOGGED_IN');
    }
    throw new WalletError(KNOWN[code] || `Binance: ${msg}${name ? ` (${name})` : ''}`, code ?? name ?? 'BAW_ERROR');
  }

  let addr = null;
  const wallet = {
    baw,
    status: () => baw(['wallet', 'status']),
    settings: () => baw(['wallet', 'settings']),
    agentId: () => baw(['wallet', 'agent-id']),
    balance: () => baw(['wallet', 'balance']),
    signin: () => baw(['auth', 'signin']),
    // Waits until the user confirms in the App or the code expires (a few minutes).
    verify: qrCodeId => baw(['auth', 'verify', '--qrCodeId', qrCodeId], 10 * 60_000),
    async address() {
      if (addr) return addr;
      const d = await baw(['wallet', 'address']);
      const list = Array.isArray(d) ? d : d?.addresses || [];
      const evm = list.find(x => String(x.binanceChainId) === String(chainId)) || list.find(x => /^0x[0-9a-fA-F]{40}$/.test(x.address || ''));
      if (!evm) throw new WalletError('Could not read the AI wallet address.', 'NO_ADDRESS');
      return (addr = evm.address);
    },
    // Ask Binance to re-send a pending transaction with a higher gas price (LOW x1.1, HIGH x1.25). Returns { hash }.
    async speedUp(hash, level = 'HIGH') {
      const d = await baw(['wallet', 'speed-up', hash, '--level', level, '--binanceChainId', String(chainId)]);
      return { hash: d?.txHash || d?.newTxHash || d?.hash || null, raw: d };
    },
    gasPrice: () => baw(['wallet', 'gas-price', '--binanceChainId', String(chainId)]),
    // Simulate on Binance's side. Returns { requestId, ok, reason, needsApp, raw }.
    async preview(tx) {
      const from = await wallet.address();
      const args = ['contract-call', 'preview', '--binanceChainId', String(chainId), '--from', from, '--to', tx.to, '--value', String(tx.value ?? 0n), '--inputData', tx.data || '0x'];
      if (tx.gasLimit) args.push('--gasLimit', String(tx.gasLimit));
      const pv = await baw(args);
      const sim = pv?.simulationResult;
      const failed = sim?.simulationCode && sim.simulationCode !== '000000000';
      return { requestId: pv?.requestId, ok: !!pv?.requestId && !failed, reason: failed ? (sim.simulationErrorDetail || sim.simulationCode) : null, needsApp: !!pv?.requireConfirmation, raw: pv };
    },
    // Preview then execute. Returns the tx hash once Binance has broadcast it.
    async send(tx, label = 'transaction') {
      const t0 = Date.now();
      const pv = await wallet.preview(tx);
      if (!pv.requestId) throw new WalletError(`Binance did not accept the ${label}.`, 'NO_REQUEST');
      if (!pv.ok) throw new WalletError(`The ${label} fails in Binance's simulation: ${pv.reason}. Nothing was sent.`, 'SIM_FAILED', { reason: pv.reason });
      if (pv.needsApp) throw new WalletError(`Binance wants this ${label} confirmed in its App, so it was not sent. Do it in the App, or try a smaller amount.`, 'NEEDS_APP');
      const t1 = Date.now();
      const ex = await baw(['contract-call', 'execute', '--requestId', pv.requestId]);
      if (ex?.status !== 'BROADCASTED' || !ex.txHash) throw new WalletError(`Binance did not send the ${label}: ${ex?.message || ex?.status || 'no answer'}`, 'NOT_SENT');
      return { hash: ex.txHash, previewMs: t1 - t0, executeMs: Date.now() - t1 };
    },
  };
  return wallet;
}
