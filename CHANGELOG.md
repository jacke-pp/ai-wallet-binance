# Changelog

## 0.1.3 (2026-10-26)

- The README is now in Chinese first (`README.md`), with the English one in `README_en.md`. 说明改成中文为主，英文版在 `README_en.md`。

## 0.1.2 (2026-10-25)

- The npm page now shows the English README. The Chinese one is `README_zh.md`.

## 0.1.1 (2026-10-25)

- **Trading page**: `aiwb ui` opens a page on your own computer. New agent coins from Four, Flap and GANG show up
  as they launch, with one-click buy next to each. You also get a live chart, the safety check, one-click buy and
  sell (your own amount presets, sell 25/50/75/100%), holdings, trades and snipes. Sign in by scanning a code with
  the Binance App. The page only answers on 127.0.0.1, and only to the link `aiwb ui` printed. English and Chinese.
- **App confirmations**: when Binance asks for a tap in the App, `aiwb` says so, waits up to 10 minutes
  (`appWaitSec`) and finishes once you confirm. `aiwb check` and the trading page tell you before you buy when every
  sale of a coin will need that tap (coins Binance's audit rates 3/5 or higher).
- **`aiwb agents`** prints the instructions for your AI after a global install (`--path` prints where the file is).
- **`lib/agentpads.mjs`**: Four Agent and Flap Agent detection, taxes and transaction data as plain functions, with
  no RPC client or wallet inside, so you can reuse them in your own tools.

## 0.1.0 (2026-10-25)

- First release. Your AI can buy and sell by contract address through your own Binance AI wallet: Four.meme agent
  coins, Flap ID Agent Curve, the GANG launchpad, Flap and PancakeSwap.
- Snipes with no default numbers, a check before buying (Binance's audit plus a buy-and-sell simulated from your
  wallet), NFT mints (including AI-only mints), your own limits and a local trade journal.
