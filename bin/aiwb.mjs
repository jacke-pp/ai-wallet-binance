#!/usr/bin/env node
// aiwb: trade with your own Binance Agentic Wallet from the command line, so any AI (Claude, Codex, DeepSeek, Grok...)
// can buy, sell, snipe and mint for you without the slow chat round trip. Binance signs everything; no keys here.
import { createRpc, PUBLIC_BSC } from '../lib/rpc.mjs';
import { createWallet, findBaw } from '../lib/wallet.mjs';
import { createEngine, fromWei, toWei, AGENT_ID } from '../lib/engine.mjs';
import { check } from '../lib/check.mjs';
import { loadConfig, setConfig, CONFIG_KEYS, journal, pnl, home, publicConfig } from '../lib/store.mjs';
import { encodeCall, isAddress } from '../lib/abi.mjs';
import * as snipes from '../lib/snipe.mjs';
import * as mints from '../lib/mint.mjs';

const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
    else flags[k] = true;
  } else pos.push(a);
}
const JSON_OUT = !!flags.json;
const num = (k, d) => (flags[k] === undefined ? d : Number(flags[k]));
const show = (obj, text) => console.log(JSON_OUT ? JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) : text);

function setup() {
  const cfg = loadConfig();
  const rpc = createRpc(cfg.rpc || PUBLIC_BSC);
  const wallet = createWallet({ bin: findBaw(cfg) });
  // --as <address>: look at things as that wallet without signing in (info, check, --dry only; nothing can be sent).
  if (flags.as) {
    if (!isAddress(flags.as)) throw new Error('--as needs a wallet address');
    wallet.address = async () => flags.as;
    wallet.send = async () => { throw new Error('--as is look-only: nothing is sent. Remove --as to trade.'); };
  }
  // Binance may send a risky transaction to its App for confirmation: tell the user and wait.
  const onAppWait = label => process.stderr.write(`Binance wants this ${label} confirmed in the Binance App. Open the App and confirm it (waiting up to ${Math.round((cfg.appWaitSec ?? 600) / 60)} minutes)...\n`);
  return { cfg, rpc, wallet, engine: createEngine({ rpc, wallet, cfg, onAppWait }) };
}

const HELP = `aiwb - trade with your own Binance AI wallet (Agentic Wallet) on BNB Chain

  aiwb agents [--path]                instructions for your AI (read these first)
  aiwb doctor                         check that everything is ready (baw, sign-in, Agent ID, limits)
  aiwb login                          sign the AI wallet in (scan the QR code in the Binance App)
  aiwb ui [--port 8686] [--no-open]   trading page in your browser: new coins, chart, one-click buy/sell, snipes
  aiwb check <CA>                     safety check: Binance audit + simulated buy & sell back
  aiwb info <CA>                      where it trades, taxes, whether only AI wallets can buy, what you hold
  aiwb buy <CA> <BNB>                 buy now   [--slippage 15] [--max-tax 10] [--max-sell-tax 10] [--max-impact 5] [--dry]
  aiwb sell <CA> [50%|<amount>]       sell (default 100%)  [--slippage 15] [--max-impact 5] [--dry]
                                      buy/sell/call/claim/mint also take [--gas-limit <n>] [--speed-up <sec>]
  aiwb gas                            gas prices now, and your slippage / gas settings
  aiwb snipe add ...                  set up a snipe (see: aiwb snipe help)
  aiwb snipe list | remove <id> | run
  aiwb claim <market|CA>              after an agent coin launches: turn your curve shares into the coin
  aiwb send <CA> <address> [50%|<amount>]   send coins to another address (default all) [--dry]
  aiwb autosend [run]                 automatic sending after a claim / graduation: status, or keep it running here
                                      (switch it on: aiwb config set autoSendTo <address>, then autoSendFour on ...)
  aiwb gmgn <kline|info|security|holders|trenches> [CA] [--res 1m]   GMGN data, read only (aiwb config set gmgnKey)
  aiwb call <to> "<fn(types)>" [args] [--value <BNB>] [--dry]   any contract call (mints, claims)
  aiwb mint <contract> [qty] --max-price <BNB each> [--wait <sec>] [--price <BNB>] [--fn "mint(uint256)"] [--dry]
                                      finds the mint function and price itself; --wait keeps trying until a presale opens
  aiwb mint bnworld <qty> [--dry]     example: BN World Onchain Agents (AI wallets only)
  aiwb journal [--n 20]               your recent trades
  aiwb pnl                            profit and loss per coin
  aiwb config [set <key> <value>]     settings: ${Object.keys(CONFIG_KEYS).join(', ')}

Add --json to any command for machine-readable output. --as <address> looks as that wallet without signing in. Files live in ${home()}.`;

// Per-command overrides of the slippage / gas settings.
function txOpts() {
  return {
    slippagePct: flags.slippage != null ? num('slippage') : undefined,
    gasLimit: flags['gas-limit'] != null ? num('gas-limit') : undefined,
    speedUpAfterSec: flags['speed-up'] != null ? num('speed-up') : undefined,
    maxImpactPct: flags['max-impact'] != null ? num('max-impact') : undefined,
    force: !!flags.force,
  };
}
const settingsLine = cfg => `slippage ${cfg.slippagePct}%, gas limit ${cfg.gasLimit ?? 'estimated by Binance'}, speed-up ${cfg.speedUpAfterSec ? `after ${cfg.speedUpAfterSec}s (${cfg.speedUpLevel || 'HIGH'})` : 'off'}`;

async function main() {
  const [cmd, ...rest] = pos;
  if (!cmd || cmd === 'help' || flags.help) return console.log(HELP);

  // The instructions for AI assistants, wherever npm put the package. `--path` prints only where the file is.
  if (cmd === 'agents') {
    const { fileURLToPath } = await import('node:url');
    const { readFileSync } = await import('node:fs');
    const file = fileURLToPath(new URL('../AGENTS.md', import.meta.url));
    return console.log(flags.path ? file : readFileSync(file, 'utf8'));
  }

  if (cmd === 'config') {
    // Secrets (the GMGN key) are never printed back: only "(set)".
    if (rest[0] === 'set') { setConfig(rest[1], rest[2]); return show(publicConfig(), `saved ${rest[1]}`); }
    const cfg = publicConfig();
    return show(cfg, Object.keys(CONFIG_KEYS).map(k => `${k.padEnd(15)} ${cfg[k] ?? '(not set)'}    ${CONFIG_KEYS[k]}`).join('\n'));
  }

  if (cmd === 'journal') {
    const n = num('n', 20), list = journal().slice(-n);
    return show(list, list.map(e => `${e.at.slice(0, 19).replace('T', ' ')}  ${e.kind.padEnd(4)} ${String(e.symbol || e.label || '').padEnd(10)} ${e.bnb ? Number(e.bnb).toFixed(4) + ' BNB' : ''} ${e.tokens ? Number(e.tokens).toFixed(2) + ' tokens' : ''}  ${e.status}${e.hash ? '  ' + e.hash : ''}${e.error ? '  ' + e.error : ''}`).join('\n') || 'no trades yet');
  }
  if (cmd === 'pnl') {
    const rows = pnl();
    return show(rows, rows.map(p => `${String(p.symbol).padEnd(10)} bought ${p.boughtBnb.toFixed(4)} BNB, sold ${p.soldBnb.toFixed(4)} BNB, realized ${p.realizedBnb >= 0 ? '+' : ''}${p.realizedBnb.toFixed(4)} BNB, still holding ${p.heldTokens.toFixed(2)}`).join('\n') || 'no trades yet');
  }

  const { cfg, rpc, wallet, engine } = setup();

  if (cmd === 'ui') {
    const { startUi } = await import('../lib/ui/server.mjs');
    const ui = await startUi({ cfg, rpc, wallet, createEngine, port: num('port', 0) });
    console.log(`aiwb trading page (only on this computer):\n${ui.link}\nKeep this window open while you use it. Ctrl+C stops it.`);
    if (!flags['no-open']) {
      const { spawn } = await import('node:child_process');
      const [bin, args] = process.platform === 'darwin' ? ['open', [ui.link]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', ui.link]] : ['xdg-open', [ui.link]];
      spawn(bin, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
    return new Promise(() => {});
  }

  if (cmd === 'login') {
    // baw auth signin --json -> { qrCodeId, expireAt, urlForWeb, pairingCode } or { status: 'ALREADY_CONNECTED' }
    const s = await wallet.signin();
    if (s?.status === 'ALREADY_CONNECTED') return show(s, `Already signed in: ${await wallet.address()}`);
    if (JSON_OUT) console.log(JSON.stringify(s));
    else console.log(`Open this link on the phone with the Binance App (or scan it), check the pairing code, confirm:\n${s?.urlForWeb}\nPairing code: ${s?.pairingCode ?? '-'}\nWaiting for you to confirm...`);
    if (!s?.qrCodeId) return;
    const v = await wallet.verify(s.qrCodeId);
    return show(v, `Signed in. Wallet ${await wallet.address().catch(() => '?')}. The session ends after 7 days, or 48 hours unused: run aiwb login again then.`);
  }

  if (cmd === 'doctor') {
    const out = { baw: findBaw(cfg) || null, rpc: rpc.urls[0] };
    const lines = [`baw CLI: ${out.baw || 'NOT FOUND - npm install -g @binance/agentic-wallet'}`];
    if (out.baw) {
      try {
        out.status = await wallet.status();
        lines.push(`sign-in: ${out.status?.status || '?'}`);
        if (out.status?.status === 'CONNECTED') {
          out.address = await wallet.address();
          const [bnb, aid, st] = await Promise.all([rpc.balance(out.address), rpc.read(AGENT_ID, 'balanceOf(address)', [out.address], ['uint256']).catch(() => null), wallet.settings().catch(() => null)]);
          out.bnb = fromWei(bnb); out.hasAgentId = aid == null ? null : aid > 0n; out.settings = st;
          lines.push(`wallet: ${out.address}  ${out.bnb} BNB`, `Agent ID (.ai): ${out.hasAgentId ? 'yes' : 'NO - claim one in the Binance App to buy agent-only coins'}`);
          if (st) {
            lines.push(`developer mode: ${st.devMode?.enabled ? `on until ${st.devMode.expiresAt}` : 'OFF - turn it on in the App (needed for direct contract calls)'}`);
            lines.push(`trade all tokens: ${st.tradeAllTokens ? 'on' : 'off'}   session expires: ${st.sessionExpireTime || '?'}`);
          }
        } else lines.push('Run: aiwb login');
      } catch (e) { lines.push(`wallet: ${e.message}`); }
    }
    lines.push(`RPC: ${out.rpc}`, `limits: per trade ${cfg.maxPerTradeBnb ?? 'not set'}, per day ${cfg.dailyCapBnb ?? 'not set'} (BNB)`, settingsLine(cfg));
    return show(out, lines.join('\n'));
  }

  if (cmd === 'gas') {
    const g = await wallet.gasPrice();
    const lv = k => `${k} ${g?.[k]?.gasPrice ?? '?'} gwei (~${Math.round((g?.[k]?.waitTimeEstimate ?? 0) / 1000)}s)`;
    return show({ gasPrice: g, settings: cfg }, [`BNB Chain gas now: ${['low', 'medium', 'high'].map(lv).join(', ')}`,
      'Binance picks the gas price for each transaction (around medium in our tests). You can set:',
      '  aiwb config set gasLimit 600000       most gas one transaction may use (empty = Binance estimates)',
      '  aiwb config set speedUpAfterSec 3     re-send a still-pending transaction with more gas after 3s',
      '  aiwb config set speedUpLevel HIGH     HIGH = x1.25 gas price, LOW = x1.1',
      '  aiwb config set slippagePct 10        how far the price may move against you',
      `yours: ${settingsLine(cfg)}`].join('\n'));
  }

  if (cmd === 'info') {
    const r = await engine.inspect(rest[0]);
    const i = r.info;
    return show({ ...r, info: i && { ...i, handler: undefined } }, [
      `${r.symbol}  ${r.token}`,
      i ? `market: ${i.platform} (${i.phase})${i.agentOnly ? '  AI WALLETS ONLY until it graduates' : ''}${i.market ? `  market contract ${i.market}` : ''}` : 'market: not found',
      i?.launchedFrom ? `launched from agent market ${i.launchedFrom.market}: holders of curve shares claim with aiwb claim ${i.launchedFrom.market}` : null,
      i?.buyTaxPct != null || i?.sellTaxPct != null ? `buy tax now: ${i.buyTaxPct ?? '?'}%  sell tax: ${i.sellTaxPct ?? '?'}%${i.taxMeasured ? '  (measured: simulated buy + sell from your wallet)' : ''}${i.openingFeePct ? `  (includes ${i.openingFeePct}% opening fee, falling block by block)` : ''}` : null,
      i?.buyFails ? 'WARNING: a simulated buy FAILS from your wallet right now' : null,
      i?.sellFails ? 'WARNING: a simulated sale right after buying FAILS from your wallet' : null,
      i?.progress != null ? `curve progress: ${i.progress.toFixed(1)}%` : null,
      r.noWallet ? 'your wallet: not signed in (aiwb login)' : `your wallet: ${fromWei(r.walletBnb)} BNB, holds ${fromWei(r.held, i?.unit === 'shares' ? 18 : r.decimals)} ${i?.unit === 'shares' ? 'curve shares' : r.symbol}, Agent ID: ${r.hasAgentId ? 'yes' : 'no'}`,
    ].filter(Boolean).join('\n'));
  }

  if (cmd === 'check') {
    const r = await check(engine, rest[0]);
    return show(r, [
      `${r.symbol} (${r.platform || 'no market'}): ${r.verdict.toUpperCase()}`,
      ...r.flags.map(f => `  [${f.level}] ${f.text}`),
      r.audit.available ? `  Binance audit: ${r.audit.levelName || 'LOW'} (${r.audit.level}/5), buy tax ${r.audit.buyTax ?? '?'}%, sell tax ${r.audit.sellTax ?? '?'}%` : '  Binance audit: not available for this coin',
      r.roundTrip.sellOk ? `  simulated 0.001 BNB buy + sell back: ${r.roundTrip.keepPct}% returned` : `  simulated round trip: ${r.roundTrip.reason || 'n/a'}`,
    ].join('\n'));
  }

  if (cmd === 'buy') {
    const [token, amount] = rest;
    if (!isAddress(token) || !amount) throw new Error('usage: aiwb buy <CA> <BNB>');
    const opts = { ...txOpts(), maxTaxPct: flags['max-tax'] != null ? num('max-tax') : undefined, maxSellTaxPct: flags['max-sell-tax'] != null ? num('max-sell-tax') : undefined, dryRun: !!flags.dry };
    const r = await engine.buy(token, amount, opts);
    if (r.dryRun) return show(r, `[dry run] would buy ~${fromWei(r.plan.expectedOut, r.decimals)} ${r.symbol} via ${r.plan.via} (min ${fromWei(r.plan.minOut, r.decimals)})${r.plan.impactPct != null ? `, moving the pool price ${r.plan.impactPct}%` : ''}. Nothing sent.`);
    return show(r, `bought ${Number(r.tokens).toFixed(2)} ${r.symbol} for ${r.bnb} BNB in ${(r.ms / 1000).toFixed(1)}s\nhttps://bscscan.com/tx/${r.hash}${r.warnings.length ? '\nnote: ' + r.warnings.join(' ') : ''}`);
  }

  if (cmd === 'sell') {
    const [token, what = '100%'] = rest;
    if (!isAddress(token)) throw new Error('usage: aiwb sell <CA> [50%|<amount>]');
    const q = String(what).endsWith('%') ? { percent: Number(what.slice(0, -1)) } : { amount: what };
    const r = await engine.sell(token, q, { ...txOpts(), dryRun: !!flags.dry });
    if (r.dryRun) return show(r, `[dry run] would sell ${fromWei(r.qty, r.decimals)} ${r.symbol} for ~${fromWei(r.plan.expectedOut)} BNB via ${r.plan.via}${r.plan.impactPct != null ? `, moving the pool price ${r.plan.impactPct}%` : ''}. Nothing sent.`);
    return show(r, `sold ${Number(r.tokens).toFixed(2)} ${r.symbol} for ${Number(r.bnb).toFixed(6)} BNB in ${(r.ms / 1000).toFixed(1)}s\nhttps://bscscan.com/tx/${r.hash}`);
  }

  if (cmd === 'call') {
    const [to, sig, ...args] = rest;
    if (!isAddress(to) || !sig) throw new Error('usage: aiwb call <to> "fn(type,...)" [args...] [--value <BNB>] [--dry]   (or --data 0x...)');
    const data = flags.data ? String(flags.data) : encodeCall(sig, args.map(a => (a.startsWith('[') ? JSON.parse(a) : a)));
    const value = flags.value ? toWei(flags.value) : 0n;
    const r = await engine.call({ to, data, value, label: sig.split('(')[0], dryRun: !!flags.dry, ...txOpts() });
    if (r.dryRun) return show(r, `[dry run] Binance simulation: ${r.preview.ok ? 'OK' : 'FAILS: ' + r.preview.reason}${r.preview.needsApp ? ' (would need App confirmation)' : ''}. Nothing sent.`);
    return show(r, `done in ${(r.ms / 1000).toFixed(1)}s\nhttps://bscscan.com/tx/${r.hash}`);
  }

  if (cmd === 'claim') {
    const r = await engine.claim(rest[0], txOpts());
    return show(r, `claimed in ${(r.ms / 1000).toFixed(1)}s\nhttps://bscscan.com/tx/${r.hash}`);
  }

  if (cmd === 'send') {
    const [token, to, what = '100%'] = rest;
    if (!isAddress(token) || !isAddress(to)) throw new Error('usage: aiwb send <CA> <address> [50%|<amount>] [--dry]');
    const q = String(what).endsWith('%') ? { percent: Number(what.slice(0, -1)) } : { amount: what };
    const r = await engine.transfer(token, to, q, { ...txOpts(), dryRun: !!flags.dry });
    if (r.dryRun) return show(r, `[dry run] would send ${fromWei(r.qty, r.decimals)} ${r.symbol} to ${to}. Binance simulation: ${r.preview.ok ? 'OK' : 'FAILS: ' + r.preview.reason}${r.preview.needsApp ? ' (needs a tap in the Binance App)' : ''}. Nothing sent.`);
    return show(r, `sent ${r.tokens} ${r.symbol} to ${to} in ${(r.ms / 1000).toFixed(1)}s\nhttps://bscscan.com/tx/${r.hash}`);
  }

  if (cmd === 'autosend') {
    const { createAutoSend, loadState } = await import('../lib/autotransfer.mjs');
    const on = ['autoSendFlap', 'autoSendFour', 'autoSendGang', 'autoClaimFlap'].filter(k => cfg[k]);
    if (rest[0] === 'run') {
      if (!on.length) throw new Error('No automatic switch is on. First: aiwb config set autoSendTo <address>, then e.g. aiwb config set autoSendFour on');
      const auto = createAutoSend({ engine, rpc, log: m => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`) });
      auto.start();
      console.log(`Auto-send running (${on.join(', ')}${cfg.autoSendTo ? ` -> ${cfg.autoSendTo}` : ''}). Checks every 30 s. Ctrl+C stops it.`);
      return new Promise(() => {});
    }
    const st = loadState();
    const rows = Object.entries(st).map(([k, v]) => ({ coin: k, ...v }));
    return show({ to: cfg.autoSendTo || null, switches: Object.fromEntries(on.map(k => [k, `on since ${cfg[k]}`])), coins: rows }, [
      `send to: ${cfg.autoSendTo || '(not set)'}`,
      `switches on: ${on.length ? on.map(k => `${k} (since ${cfg[k].slice(0, 16).replace('T', ' ')} UTC)`).join(', ') : 'none'}`,
      'It runs inside aiwb ui, or in a terminal with: aiwb autosend run',
      ...rows.map(r => `  ${r.coin}  ${r.status}${r.tokens ? ` ${r.tokens}` : ''}${r.hash ? `  https://bscscan.com/tx/${r.hash}` : ''}${r.error ? `  (${r.error})` : ''}`),
    ].join('\n'));
  }

  if (cmd === 'gmgn') {
    const { createGmgn } = await import('../lib/gmgn.mjs');
    const g = createGmgn({ key: cfg.gmgnKey });
    const [what, ca] = rest;
    const needCa = () => { if (!isAddress(ca)) throw new Error(`usage: aiwb gmgn ${what} <CA>`); return ca; };
    const r = what === 'kline' ? await g.kline(needCa(), { resolution: flags.res || '1m', from: flags.from, to: flags.to })
      : what === 'info' ? await g.info(needCa()) : what === 'security' ? await g.security(needCa())
      : what === 'holders' ? await g.holders(needCa(), { limit: num('n', 20) }) : what === 'trenches' ? await g.trenches({ limit: num('n', 20) })
      : null;
    if (r == null) throw new Error('usage: aiwb gmgn <kline|info|security|holders|trenches> [CA]');
    return console.log(JSON.stringify(r, null, JSON_OUT ? 2 : 1));
  }

  if (cmd === 'mint') return mints.run({ engine, rpc, wallet, args: rest, flags, show });
  if (cmd === 'snipe') return snipes.cli({ engine, rpc, wallet, cfg, args: rest, flags, show });

  throw new Error(`unknown command "${cmd}". Run: aiwb help`);
}

main().catch(e => {
  if (JSON_OUT) console.log(JSON.stringify({ error: e.message, code: e.code }));
  else console.error(`error: ${e.message}`);
  process.exit(1);
});
