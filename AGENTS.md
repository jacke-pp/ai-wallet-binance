# ai-wallet-binance: instructions for AI assistants

You (Claude, Codex, DeepSeek, Grok, any AI with a shell) can trade for your user with **their own Binance AI wallet**
(Binance Agentic Wallet) through the `aiwb` command. Binance holds the key and signs every transaction; this tool
never sees a private key, seed phrase or API secret, and you must never ask the user for one.

Reply to the user in their language. Keep it short: what you did, the result, the bscscan link.

## Setup (once)

```bash
npm install -g @binance/agentic-wallet     # Binance's official wallet CLI (baw)
npm install -g ai-wallet-binance            # this tool (aiwb)
aiwb agents                                 # these instructions, from wherever npm installed them
aiwb doctor                                 # what is missing
aiwb login                                  # prints a link + pairing code: send both to the user, they confirm in the Binance App
```

`aiwb doctor` must show: signed in, an Agent ID (.ai name), developer mode ON. If not, tell the user what to do in the
Binance App (they do it, not you):
- **Agent ID**: Binance App → AI wallet → claim a `.ai` name (free). Without it, agent-only coins cannot be bought.
- **Developer mode** (needed for direct contract calls): App → AI wallet settings → Developer Mode. It expires after
  7 days; turn it on again then. Also turn on "trade all tokens".
- **Sign-in** lasts at most 7 days and ends after 48 hours unused: run `aiwb login` again when `doctor` says so.
- **Abnormal transaction handling**: App → AI wallet settings. Ask the user to set it to confirm in the App (not
  auto-reject). Binance flags trades touching a coin its audit rates 3/5 or higher as risky (`aiwb check` says so;
  every GANG curve coin so far, as their contracts are unverified). Moving the coin out does not avoid this: curve
  coins cannot be transferred before they graduate, and a transfer of a flagged coin is screened the same way. With
  auto-reject they fail with "blocked as too risky"; with App confirmation `aiwb` prints "confirm it in the Binance
  App", waits (up to 10 minutes, `aiwb config set appWaitSec 600`) and finishes once the user taps confirm. When you
  see that message, tell the user to open the App and confirm. If it times out, check `aiwb journal` or bscscan
  before trying again: a late confirmation still goes through.
- The daily limit is set in the App. You cannot change it or these settings.

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
| "Send my <coin> to 0x..." | `aiwb send <CA> <address> [50%\|amount]` (rule 6: repeat it back first; `--dry` simulates) |
| "Send my coins to 0x... automatically once they can move" | see Auto-send below |
| "Show the GMGN chart / holders / security of <CA>" | `aiwb gmgn kline <CA> --res 5m`, `aiwb gmgn info <CA>`, `aiwb gmgn security <CA>`, `aiwb gmgn holders <CA>`, `aiwb gmgn trenches` (needs the user's GMGN key) |
| "Mint this NFT" / "mint when the presale opens" | `aiwb mint <contract> <qty> --max-price <BNB each>` (add `--wait 600` to keep trying until it opens) |
| "What are gas prices?" / "use more gas" | `aiwb gas`, then `aiwb config set ...` (see Settings) |
| "How am I doing?" | `aiwb pnl`, `aiwb journal` |
| "I want to click, not type" / "open the trading page" | `aiwb ui` (keep it running; give the user the printed link) |

Add `--dry` to see what would happen without sending anything. Add `--json` for machine-readable output.

## Settings the user can change

Change them only when the user asks; repeat the new value back.

| Setting | Command | Per trade |
|---|---|---|
| Slippage (default 15%) | `aiwb config set slippagePct 10` | `--slippage 10` |
| Thin-pool limit (default 5%) | `aiwb config set maxImpactPct 3` | `--max-impact 3` |
| Gas limit (default: Binance estimates) | `aiwb config set gasLimit 600000` | `--gas-limit 600000` |
| Speed up a stuck transaction | `aiwb config set speedUpAfterSec 3` and `speedUpLevel HIGH` (x1.25) or `LOW` (x1.1) | `--speed-up 3` |
| Spending limits | `aiwb config set maxPerTradeBnb 0.1`, `aiwb config set dailyCapBnb 1` | |
| Highest buy / sell tax for a buy | | `--max-tax 10`, `--max-sell-tax 10` |

Binance picks the gas price itself (about the "medium" level); the AI wallet cannot set it directly. `aiwb gas` shows
the current levels.

## Thin pools

aiwb swaps on PancakeSwap V2. Many coins, and many coins that curves are priced in (BNCB, NVDAB, ...), keep most of
their money in a PancakeSwap V3 pool or against USDT, with only a thin V2 BNB pool beside it. Before every buy or sell
that swaps on V2, aiwb measures how far the trade would move that pool's price and refuses it above `maxImpactPct`
(default 5%), saying where the coin's deep pool is. Tell the user: buy less, trade it in the Binance App, or raise the
limit. `--force` skips it, only if the user insists after hearing the price they would lose. `aiwb check` warns when
the V2 pool is much thinner than the coin's deepest pool.

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
6. Send coins to another address (`aiwb send`, or the auto-send switches) only when the user asks and gives the
   address themselves. Repeat the coin, the amount and the full address back and get a yes: coins sent away cannot
   come back. Never send BNB to anyone, never pick an address yourself, and never call contracts the user did not ask
   for.

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
    Binance's audit rates these coins 3/5 (contract not verified), so each sale needs abnormal transaction handling
    set to confirm in the App and a tap from the user (tested 2026-10-25; a 0/5 Four coin sold without one). On auto-reject the user holds until the curve fills;
    after that the coin trades on PancakeSwap V2 against its quote coin and `aiwb` sells it through that pool.
  - Coins that are their own agent-only curve.
- **Graduated coins** on Flap's normal curve and on PancakeSwap V2.
- **Any contract call** through the AI wallet (mints, claims), simulated by Binance before it is sent.

Speed, measured on mainnet (2026-10-25): a buy takes about 4.5–6 seconds from command to confirmed block: about 2–2.5
s finding the market and pricing (faster with your own RPC node), about 2 s for Binance's check, signing and sending,
and under 1 s until the block. A sell that first needs an approval is two transactions
(about 8–12 seconds); a Flap agent market priced in BNCB takes about 13–16 seconds each way (3 transactions).
Selling on the Four and Flap agent curves (BNB and BNCB markets) and on Flap's normal curve worked from an AI wallet in
these tests; on the GANG launchpad's curve it needed a confirmation in the App. Binance can change what its risk
screen allows, so the warning above still applies.

## Auto-send (off by default)

Once an agent coin the user bought can move, `aiwb` can send all of it to an address the user chose. Set up only when
the user asks, with their address (rule 6):

```bash
aiwb config set autoSendTo 0x...        # the user's address
aiwb config set autoSendFlap on         # Flap agent coin launched: claim the shares, then send the coin
aiwb config set autoSendFour on         # Four agent coin graduated to PancakeSwap (coins unlock): send it
aiwb config set autoSendGang on         # GANG coin graduated (locked() turns false): send it
aiwb config set autoClaimFlap on        # only claim launched Flap coins into the AI wallet, no sending
aiwb autosend                           # what is on, and what was sent
```

- Each switch remembers when it was turned on and only acts on coins bought (or claimed) through `aiwb` after that, so
  older holdings are never swept out. Each coin is sent once; buying more of it later is the user's.
- It runs inside `aiwb ui`, or in a terminal with `aiwb autosend run` (one of them at a time). It checks every 30 s.
- A failed send is retried after 1, 5 and 15 minutes, then left to the user (`aiwb send`). With too little BNB for gas
  it waits and says so. If Binance wants a tap in the App (coins its audit rates 3/5 or higher), it waits up to
  `appWaitSec` for the user.
- Before a coin graduates it cannot be moved at all (Four and GANG revert transfers while on the curve), so sending
  early is not a way around the App confirmation.

## GMGN data (read only)

With the user's own GMGN API key (from https://gmgn.ai/ai, saved with `aiwb config set gmgnKey <key>`, never printed)
`aiwb gmgn ...` returns GMGN's candles (USD, at most 100 per call), token info, security, top holders and the
trenches lists, and the trading page draws its chart and extra coin stats from GMGN. Nothing trades through GMGN: its
wallets have no Binance Agent ID, so trading stays on the AI wallet. Never ask the user to paste the key into the chat;
they run the `config set` command themselves or paste it into the page.

## Trading page (`aiwb ui`)

For users who would rather click: `aiwb ui` serves a page on 127.0.0.1 and opens the browser (`--no-open` just prints
the link, `--port 8686` fixes the port). Its home is the trenches: three columns (new, nearly full, launched) of agent
coins on Four, Flap and GANG with quick-buy buttons that use only amounts the user typed. A coin page has a chart, the
safety check, buy, sell and claim; below are holdings, the journal, snipes and an "Auto-send & data" tab for the
auto-send switches and the GMGN key. English or Chinese. Sign-in is the same QR code, scanned in the
Binance App. The same rules apply on the page: snipe numbers have no defaults and agent-only coins carry the sell
warning. Snipes added on the page run while `aiwb ui` runs; only one aiwb may run snipes at a time, so stop
`aiwb snipe run` first. The link carries a random key made at start: anyone without it gets nothing, and the page
never sees a private key.

## Files

Everything stays on the user's machine in `~/.ai-wallet-binance/`: `config.json` (RPC node, slippage, optional limits),
`journal.jsonl` (every trade), `snipes.json`, `autosend.json` (what auto-send did). Optional limits: `aiwb config set maxPerTradeBnb 0.1`,
`aiwb config set dailyCapBnb 1`. Free public BSC nodes are used unless the user sets their own:
`aiwb config set rpc <url>` (a private node makes snipes faster and more reliable).
