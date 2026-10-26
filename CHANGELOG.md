# Changelog

## 0.1.6 (2026-10-26)

- **自动走深池**：0.1.5 只会拦下浅池交易，现在直接走深池。每笔换币（PancakeSwap 直买卖、GANG 两跳、GANG 和 Flap Agent
  计价币换入换出）同时在 PancakeSwap V2 和 KyberSwap 聚合器（PancakeSwap V3、Infinity 等各家池子）上报价，KyberSwap 多给 0.5%
  以上就走它。走之前三道检查，任何一道不过就退回 V2：0.01 BNB 来回试算拿回不到一半（高手续费陷阱池）不用；KyberSwap 生成的交易
  必须发给它的路由合约、BNB 金额对得上；用你的钱包模拟整笔，到手不够最低值不用。之后照旧量推价幅度，超过 `maxImpactPct` 才拒绝。
  实测 0.5 BNB：买 BNCB 67.98 枚（V2 65.69），买 oANTHROPIC 0.3716 枚（V2 0.00047）；卖 100 BNCB 0.736 BNB（V2 0.705）。
  主网真钱实测：0.005 BNB 买 oANTHROPIC 再全卖，两笔都走 KyberSwap 路由合约，拿回 0.00496 BNB（损耗不到 1%，含手续费）。
  `aiwb config set aggregator off` 可关掉。同时修了 GANG 计价币买入两次模拟不在同一个区块、偶尔误报“launchpad 拒绝”的问题。
- **Deep pools instead of refusals**: 0.1.5 refused trades through thin pools; now they go through the deep pool.
  Every swap (PancakeSwap buys and sells, GANG two-hop trades, GANG and Flap Agent quote-coin legs) is priced on
  PancakeSwap V2 and on KyberSwap's aggregator (PancakeSwap V3, Infinity and other DEXes); KyberSwap is used when it
  pays 0.5% more and passes three checks (0.01 BNB there and back keeps half, so no trap pools; the transaction goes to
  Kyber's router with the right BNB amount; simulated from your wallet it delivers the minimum), otherwise V2. The
  `maxImpactPct` limit still applies to the route taken. Measured with 0.5 BNB: 67.98 BNCB (V2: 65.69), 0.3716
  oANTHROPIC (V2: 0.00047). Mainnet test: 0.005 BNB into oANTHROPIC and all of it sold, both through KyberSwap's
  router, got 0.00496 BNB back (under 1% lost, fees included). `aiwb config set aggregator off` turns it off. Also fixed: a GANG buy priced in another coin
  simulated its two halves on different blocks and could be reported as refused by the launchpad.

## 0.1.5 (2026-10-26)

- **不再买进没深度的池子**：很多币（还有 BNCB、NVDAB 这类计价币）的钱主要在 PancakeSwap V3 池或 USDT 池里，V2 的 BNB 池很浅，
  以前 aiwb 会直接走 V2，价格吃亏，滑点也拦不住。现在每笔要在 V2 上换币的买卖，先算这笔会把价格推多少，超过
  `maxImpactPct`（默认 5%）就不发，并说清这个币最深的池子在哪；`--max-impact` 单笔调整，`--force` 跳过。`aiwb check` 和交易页面的检查
  会提醒“V2 池比最深的池浅很多”。实测：GANG 上用 BNCB 计价的币买 0.9 BNB，经 V2 换 BNCB 会推价 5.1%，而 BNCB 的 V3 池深约 150 倍。
- **No more buying into thin pools**: many coins, and quote coins such as BNCB and NVDAB, keep their money in a
  PancakeSwap V3 or USDT pool with only a thin V2 BNB pool beside it, and aiwb used to swap through the thin one.
  Every buy or sell that swaps on V2 is now measured first and refused above `maxImpactPct` (default 5%), naming the
  coin's deepest pool; `--max-impact` per trade, `--force` to skip. `aiwb check` and the trading page warn about it.

## 0.1.4 (2026-10-26)

- **领完或毕业后自动转出**（默认关）：`aiwb config set autoSendTo <地址>`，再分别打开 `autoSendFlap`（Flap 发币后自动领币再转出）、
  `autoSendFour`（Four 毕业后转出）、`autoSendGang`（GANG 毕业后转出）；`autoClaimFlap` 只自动领不转。只转打开以后买到的币，
  每个币只转一次，失败在 1、5、15 分钟后重试，gas 不够会等，要 App 确认会等你点。在 `aiwb ui` 里或 `aiwb autosend run` 运行。
  交易页面新增“自动转出与数据”标签页。手动转币：`aiwb send <币> <地址> [50%|数量]`。
- **GMGN 只读数据**：`aiwb config set gmgnKey <key>`（https://gmgn.ai/ai 申请，只存本机、从不显示）。`aiwb gmgn kline|info|security|holders|trenches`；
  交易页面的 K 线改用 GMGN（失败时退回币安），币详情多一排 GMGN 数据：持有人、前 10 持仓、创建者持仓、新钱包、机器人、流动性、合约权限。
- **Auto-send after a claim or graduation** (off by default): `aiwb config set autoSendTo <address>`, then switch on
  `autoSendFlap` (claim a launched Flap agent coin, then send it), `autoSendFour` and `autoSendGang` (send once the
  coin graduates); `autoClaimFlap` only claims. Only coins bought after a switch goes on, each coin once, retries after
  1, 5 and 15 minutes, waits for gas and for App confirmations. Runs in `aiwb ui` or `aiwb autosend run`; the page has a
  new "Auto-send & data" tab. Send by hand with `aiwb send <CA> <address> [50%|amount]`.
- **GMGN data, read only**, with your own key (`aiwb config set gmgnKey <key>`, never shown): `aiwb gmgn ...`, and the
  page's chart and extra coin stats come from GMGN (falling back to Binance).

- **交易页面改成“战壕”**：`aiwb ui` 首页三列：新创建、即将打满（内盘 30% 以上）、已开盘，平台仍是 Four Agent、Flap Agent、
  GANG。每张卡片：图标、名字、多久前、买卖税、计价币、平台和“Agent 专属”、内盘进度（已筹 / 目标）、市值、持有人、Dev 地址，
  还有 P1/P2/P3 快买（金额只用你自己填的，没填就不显示）。每列可以按名字筛选、按平台筛选；数字原地更新，不闪。点卡片进入原来的币详情。
  数据直接读链（Four 的 vault 已筹、Flap 的 marketDetail、GANG 的 curves），批量请求、出错自动放慢；持有人、市值、图标来自币安公开数据。
- **Trading page trenches**: the home of `aiwb ui` is now three columns: new, nearly full (curve 30%+) and launched, still
  for Four Agent, Flap Agent and GANG. Each card shows the logo, name, age, buy/sell tax, quote coin, platform and an
  "Agent only" tag, curve progress (raised / target), market cap, holders, the dev address and P1/P2/P3 quick buys
  (only amounts you typed; empty ones are hidden). Each column filters by name and platform; numbers update in place.
  A card opens the coin page as before. Data is read from the chain (Four's raised BNB from the coin's vault, Flap's
  marketDetail, GANG's curves), batched and slowed down on errors; holders, market cap and logos come from Binance's
  public token data.

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
