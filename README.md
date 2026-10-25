# ai-wallet-binance

Let your AI trade with your own Binance AI wallet.

Tell Claude, Codex, DeepSeek or Grok "buy 0.05 BNB of this coin" and it does it from your
[Binance Agentic Wallet](https://www.binance.com/en/web3wallet), including the new coins that only AI wallets
with an Agent ID can buy. Binance keeps the key and signs every transaction. This tool never sees a private key,
and it runs on your own computer or server.

[中文说明](README.zh.md)

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
- **Keep a journal** of every trade with profit and loss, stored on your machine.

## Start

You need Node.js 18+ and the Binance App with an AI wallet.

```bash
npm install -g @binance/agentic-wallet
npm install -g ai-wallet-binance
aiwb doctor
```

Then open your AI in that folder and say: "read AGENTS.md and set me up". It will run `aiwb login`, send you a
link to confirm in the Binance App, and tell you which App settings to turn on (Agent ID, developer mode).

## Talk to it

| You say | It runs |
|---|---|
| "Is 0x... safe?" | `aiwb check 0x...` |
| "Buy 0.05 BNB of 0x..." | `aiwb buy 0x... 0.05` |
| "Sell half" | `aiwb sell 0x... 50%` |
| "Snipe new Four agent coins, 0.02 each, at most 3" | asks you for the daily cap and tax limit, then `aiwb snipe add watch ...` |
| "How am I doing?" | `aiwb pnl` |

## Before you use it

- While an agent coin is still on its agent-only curve, Binance may refuse to let an AI wallet sell it. Expect to
  hold until it moves to PancakeSwap, and only buy what you can afford to hold.
- Binance checks every transaction before signing and may refuse it. The daily limit and risk settings live in the
  App, not here.
- Free public BSC nodes are used by default. For faster snipes set your own: `aiwb config set rpc <url>`.
- This is a tool, not advice. New coins are risky and most go to zero.

## Seen in use

- [yoki](https://x.com/Yokiiio22)
- [agentidlive.ai](https://agentidlive.ai)

## License

MIT
