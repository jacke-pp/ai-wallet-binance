# ai-wallet-binance

Let your AI trade with your own Binance AI wallet.

Tell Claude, Codex, DeepSeek or Grok "buy 0.05 BNB of this coin" and it does it from your
[Binance Agentic Wallet](https://www.binance.com/en/web3wallet), including the new coins that only AI wallets
with an Agent ID can buy. Binance keeps the key and signs every transaction. This tool never sees a private key,
and it runs on your own computer or server.

[中文](https://github.com/jacke-pp/ai-wallet-binance/blob/main/README.md) | English

## What it does

- **Buy and sell by contract address**: Four.meme agent coins, Flap ID Agent Curve coins, the GANG launchpad, Flap and PancakeSwap.
- **Snipe**: watch one coin (by creator, name or time) and buy when it opens, or buy the first few new agent coins
  on a launchpad. Every amount, count, daily cap and tax limit comes from you. Nothing has a default.
- **Check before buying**: Binance's public token audit plus a buy-and-sell-back simulated on the live chain from
  your own wallet address, so hidden taxes and coins you can't sell show up before you spend anything.
- **Mint** NFTs, including ones only AI wallets can mint: give it the contract and the most you'll pay; it finds the
  mint function and price, checks in a simulation that the NFT really arrives, and can wait for a presale to open.
- **Your settings**: slippage, gas limit, automatic speed-up of stuck transactions, spending limits, highest buy and
  sell tax. Taxes are measured by simulating a buy and sale from your own wallet, not just read from the contract.
- **No buying into thin pools**: before any PancakeSwap V2 swap, aiwb works out how far it would move the pool price
  and refuses above a limit (default 5%, `aiwb config set maxImpactPct`), saying where the coin's deep pool is (a V3
  pool, for example). The check before buying warns about thin pools too.
- **Keep a journal** of every trade with profit and loss, stored on your machine.
- **Trade in your browser** if you'd rather click than chat: `aiwb ui` opens a trading page on your own computer.
  Its home is the trenches: three columns (new, nearly full, launched) of agent coins on Four, Flap and GANG, each card
  with curve progress, taxes, market cap, holders and quick-buy buttons for amounts you set. Open a coin for a live
  chart, the safety check, one-click buy and sell and claims; holdings and snipes are there too.
- **Send coins out once they can move** (optional): set your address, then switch on Flap (claim after launch, then
  send), Four (send after graduation) and GANG (send after graduation) separately. All off by default; only coins bought
  after you switch one on are sent, each coin once, with retries. Or send by hand: `aiwb send <CA> <address>`.
- **GMGN data, read only**: with your own GMGN API key the trading page's chart and the holder stats (top 10, creator,
  new wallets, bots, liquidity, contract owner) come from GMGN, and your AI can query `aiwb gmgn`. Orders still go
  through your Binance AI wallet: GMGN wallets have no Agent ID, so they cannot buy agent-only coins.

## Start

You need Node.js 18+ and the Binance App with an AI wallet.

```bash
npm install -g @binance/agentic-wallet
npm install -g ai-wallet-binance
aiwb doctor
```

Then tell your AI: "run `aiwb agents`, read what it prints, and set me up". It will run `aiwb login`, send you a
link to confirm in the Binance App, and tell you which App settings to turn on (Agent ID, developer mode).
(`aiwb agents --path` shows where the instructions file is.)

Or skip the AI and run `aiwb ui`: your browser opens the trading page and shows a QR code; scan it with the Binance
App to sign in. The page only runs on your computer (127.0.0.1) and only answers the link it printed. Binance keeps
the keys and signs every trade.

In the Binance App, AI wallet settings, set **abnormal transaction handling** to confirm in the App. Binance flags
trades in coins its audit rates as risky (every coin on the GANG launchpad's curve so far, whose contracts are
unverified); with auto-reject they fail, with App confirmation they wait for your tap on the phone and then go
through. `aiwb check` and the trading page tell you before you buy when a coin will need that tap.

## Talk to it

| You say | It runs |
|---|---|
| "Is 0x... safe?" | `aiwb check 0x...` |
| "Buy 0.05 BNB of 0x..." | `aiwb buy 0x... 0.05` |
| "Sell half" | `aiwb sell 0x... 50%` |
| "Snipe new Four agent coins, 0.02 each, at most 3" | asks you for the daily cap and tax limit, then `aiwb snipe add watch ...` |
| "How am I doing?" | `aiwb pnl` |
| "Open the trading page" | `aiwb ui` |
| "Send all my 0x... to 0x..." | checks the coin, amount and address with you, then `aiwb send 0x... 0x...` |
| "Send it to my address 0x... once it graduates" | `aiwb config set autoSendTo 0x...`, then switches on `autoSendFour` / `autoSendGang` / `autoSendFlap` |
| "Show GMGN's top holders of 0x..." | `aiwb gmgn holders 0x...` |

## Before you use it

- While an agent coin is still on its agent-only curve, Binance may refuse to let an AI wallet sell it. Expect to
  hold until it moves to PancakeSwap, and only buy what you can afford to hold.
- Binance checks every transaction before signing and may refuse it. The daily limit and risk settings live in the
  App, not here.
- Auto-send works while `aiwb ui` (or `aiwb autosend run`) is running. Coins sent away cannot come back: check the address twice.
- Get a GMGN key at https://gmgn.ai/ai, then `aiwb config set gmgnKey <key>` or paste it into the trading page's "Auto-send & data" tab. It stays on your computer and only goes to GMGN.
- Free public BSC nodes are used by default. For faster snipes set your own: `aiwb config set rpc <url>`.
- This is a tool, not advice. New coins are risky and most go to zero.

## Seen in use

- [yoki](https://x.com/Yokiiio22)
- [agentidlive.ai](https://agentidlive.ai)

## License

MIT
