# ai-wallet-binance: instructions for AI assistants

You (Claude, Codex, DeepSeek, Grok, any AI with a shell) can trade for your user with **their own Binance AI wallet**
(Binance Agentic Wallet) through the `aiwb` command. Binance holds the key and signs every transaction; this tool
never sees a private key, seed phrase or API secret, and you must never ask the user for one.

Reply to the user in their language. Keep it short: what you did, the result, the bscscan link.

## Setup (once)

```bash
npm install -g @binance/agentic-wallet     # Binance's official wallet CLI (baw)
npm install -g ai-wallet-binance            # this tool (aiwb)
aiwb doctor                                 # what is missing
aiwb login                                  # prints a link + pairing code: send both to the user, they confirm in the Binance App
```

`aiwb doctor` must show: signed in, an Agent ID (.ai name), developer mode ON. If not, tell the user what to do in the
Binance App (they do it, not you):
- **Agent ID**: Binance App → AI wallet → claim a `.ai` name (free). Without it, agent-only coins cannot be bought.
- **Developer mode** (needed for direct contract calls): App → AI wallet settings → Developer Mode. It expires after
  7 days; turn it on again then. Also turn on "trade all tokens".
- **Sign-in** lasts at most 7 days and ends after 48 hours unused: run `aiwb login` again when `doctor` says so.
- Daily limit and auto-reject of risky transactions are set in the App. You cannot change them.

Works the same on the user's computer or their own server. On a server, run snipes inside `tmux`/`screen` or as a
service so they keep running.

## Commands

| What the user says | Run |
|---|---|
| "Is this coin safe?" / before the first buy of any coin | `aiwb check <CA>` |
| "What is this coin?" | `aiwb info <CA>` |
| "Buy 0.05 BNB of <CA>" | `aiwb buy <CA> 0.05` |
| "Sell half / all" | `aiwb sell <CA> 50%` / `aiwb sell <CA>` |
| "Snipe this coin when it opens" | `aiwb snipe add token <CA> ...` (ask first, see below) |
| "Snipe new agent coins" | `aiwb snipe add watch ...` (ask first, see below) |
| "Claim my coins" (Flap agent coin launched) | `aiwb claim <market or CA>` |
| "Mint this NFT" / "mint when the presale opens" | `aiwb mint <contract> <qty> --max-price <BNB each>` (add `--wait 600` to keep trying until it opens) |
| "What are gas prices?" / "use more gas" | `aiwb gas`, then `aiwb config set ...` (see Settings) |
| "How am I doing?" | `aiwb pnl`, `aiwb journal` |

Add `--dry` to see what would happen without sending anything. Add `--json` for machine-readable output.

## Settings the user can change

Change them only when the user asks; repeat the new value back.

| Setting | Command | Per trade |
|---|---|---|
| Slippage (default 15%) | `aiwb config set slippagePct 10` | `--slippage 10` |
| Gas limit (default: Binance estimates) | `aiwb config set gasLimit 600000` | `--gas-limit 600000` |
| Speed up a stuck transaction | `aiwb config set speedUpAfterSec 3` and `speedUpLevel HIGH` (x1.25) or `LOW` (x1.1) | `--speed-up 3` |
| Spending limits | `aiwb config set maxPerTradeBnb 0.1`, `aiwb config set dailyCapBnb 1` | |
| Highest buy / sell tax for a buy | | `--max-tax 10`, `--max-sell-tax 10` |

Binance picks the gas price itself (about the "medium" level); the AI wallet cannot set it directly. `aiwb gas` shows
the current levels.

## Taxes

`aiwb info` and `aiwb check` show the buy and sell tax. On PancakeSwap coins the tax is **measured**: a small buy and
sale are simulated from the user's own wallet address and compared with the untaxed price, so hidden taxes, taxes that
differ per wallet and coins that cannot be sold show up. `check` also says when the measured tax differs from
Binance's audit. A buy is refused when a simulated sale right after it fails (`--force` overrides, only if the user
insists after hearing why).

## Mints

`aiwb mint <contract>` reads the price and tries the usual mint functions in a simulation from the user's wallet; it
only sends when NFTs would really arrive. Always ask the user for `--max-price` (BNB per piece; `0` for free mints).
Presales that need an allowlist proof or a signature from the project's website can't be found this way; if the user
gets the proof, send it with `aiwb call`.

## Rules you must follow

1. **Money amounts come from the user.** Never pick an amount yourself. If the user says "buy some", ask how much BNB.
2. **Snipes: ask for every number before setting one up.** There are no defaults on purpose. Ask:
   - how much BNB per coin (`--bnb`)
   - how many coins at most (`--count`, for watch snipes)
   - the most BNB all snipes may spend per day (`--daily-cap`)
   - the highest buy tax they accept, in % (`--max-tax`). On Four agent coins the buyer pays 1% + the creator's tax
     (0–10%) + an opening fee some coins switch on, which falls 49 → 24 → 14 → 9 → 4 → 0% over the first 6 blocks
     (about 2.7 s). The snipe waits for the total to drop to this number. Flap agent coins and the GANG launchpad
     charge 1%.
   - which launchpad (`--platform four-agent`, `flap-agent`, `gang` or `all`).
   - optional: only coins from a creator address (`--creator`), with words in the name (`--name`), a time window
     (`--from`/`--until`), a delay in seconds (`--delay`).
   Repeat the settings back and get a yes before running `aiwb snipe add`.
3. **Always pass on this warning when the user buys or snipes an agent-only coin:** while the coin is still on its
   agent-only curve, Binance may refuse to let an AI wallet sell it; expect to hold until it graduates to
   PancakeSwap, and only buy what they can afford to hold.
4. **Run `aiwb check <CA>` before the first buy of a coin** and tell the user the verdict. If it says `DO-NOT-BUY`,
   do not buy unless the user insists after hearing why.
5. If Binance refuses a transaction (risk screen, needs App confirmation, daily limit), say so plainly. Do not retry
   in a loop or try to get around it.
6. Never send BNB or tokens to another address with this tool, and never call contracts the user did not ask for.

## What `aiwb` supports

- **Agent-only launchpads on BNB Chain** (only wallets with a Binance Agent ID can buy before graduation):
  - **Four.meme agent mode**: one wallet may hold at most 1% of a coin; a bigger buy is cut short and the rest of the
    BNB comes back. Coins cannot be transferred until the coin moves to PancakeSwap (at 13.4 BNB raised).
  - **Flap ID Agent Curve**: a buy gets *curve shares*, not coins. One wallet may hold at most 2%; `aiwb` shrinks a buy
    to fit. When the market fills (5 BNB) the coin launches at its ...7777 address and holders run `aiwb claim`.
    You can pass either the market address or the coin's ...7777 address. Markets priced in another coin (e.g. BNCB)
    take 3 transactions to buy (swap, approve, buy) and up to 3 to sell.
  - **GANG launchpad** (the one GANG launched on): each coin is priced in a quote coin (GANG, BNB, USDT, BNCB, ...).
    A buy is 3 transactions (get the quote coin, approve, buy); 1% fee each way; one wallet may hold at most 1%.
    In our tests (2026-10-25) Binance let the AI wallet buy there but **blocked every sale on the curve**: tell the
    user they will most likely hold until the curve fills. After that the coin trades on PancakeSwap V2 against its
    quote coin and `aiwb` sells it through that pool.
  - Coins that are their own agent-only curve.
- **Graduated coins** on Flap's normal curve and on PancakeSwap V2.
- **Any contract call** through the AI wallet (mints, claims), simulated by Binance before it is sent.

Speed, measured on mainnet (2026-10-25): a buy takes about 4.5–6 seconds from command to confirmed block: about 2–2.5
s finding the market and pricing (faster with your own RPC node), about 2 s for Binance's check, signing and sending,
and under 1 s until the block. A sell that first needs an approval is two transactions
(about 8–12 seconds); a Flap agent market priced in BNCB takes about 13–16 seconds each way (3 transactions).
Selling on the Four and Flap agent curves (BNB and BNCB markets) and on Flap's normal curve worked from an AI wallet in
these tests; on the GANG launchpad's curve Binance blocked it. Binance can change what its risk screen allows, so the
warning above still applies.

## Files

Everything stays on the user's machine in `~/.ai-wallet-binance/`: `config.json` (RPC node, slippage, optional limits),
`journal.jsonl` (every trade), `snipes.json`. Optional limits: `aiwb config set maxPerTradeBnb 0.1`,
`aiwb config set dailyCapBnb 1`. Free public BSC nodes are used unless the user sets their own:
`aiwb config set rpc <url>` (a private node makes snipes faster and more reliable).
