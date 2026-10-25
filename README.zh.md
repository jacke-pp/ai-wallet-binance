# ai-wallet-binance

让你的 AI 用你自己的币安 AI 钱包交易。

跟 Claude、Codex、DeepSeek 或 Grok 说一句“这个币买 0.05 BNB”，它就用你的币安 Agentic Wallet 去买，包括只有带
Agent ID 的 AI 钱包才能买的新币。私钥在币安手里，每笔交易都由币安签名；本工具碰不到私钥，在你自己的电脑或服务器上运行。

[English](README.md)

## 能做什么

- **按合约地址买卖**：Four.meme Agent 币、Flap ID Agent Curve 币、Flap 内盘、PancakeSwap。
- **狙击**：盯一个币（按创建者、名字或时间）开盘就买；或者抢某个发射台上最先出来的几个 Agent 新币。每个币买多少、
  买几个、每天最多花多少、能接受多高的税，都由你定，没有默认值。
- **买前检查**：币安公开的代币安全检测，加上用你自己的钱包地址在链上模拟“买一点再全卖掉”，隐藏税和卖不掉的币在花钱前就能看出来。
- **Mint**：包括只有 AI 钱包能 mint 的 NFT。给它合约地址和每个最多付多少，它自己找 mint 函数和价格，先模拟确认 NFT
  真的能到账才发；预售没开可以守着等。
- **自己调设置**：滑点、gas 上限、交易卡住自动加速、花费上限、最高买入税和卖出税。税率是用你自己的钱包地址模拟买卖实测出来的，不只看合约写的。
- **记账**：每笔交易和盈亏都记在你自己电脑上。

## 开始

需要 Node.js 18 以上，和开好 AI 钱包的币安 App。

```bash
npm install -g @binance/agentic-wallet
git clone https://github.com/jacke-pp/ai-wallet-binance && cd ai-wallet-binance && npm link
aiwb doctor
```

然后在这个文件夹里打开你的 AI，说“读一下 AGENTS.md，帮我设置好”。它会运行 `aiwb login`，给你一个链接去币安 App
里确认，再告诉你 App 里要打开哪些设置（Agent ID、开发者模式）。

## 怎么跟它说

| 你说 | 它运行 |
|---|---|
| “0x... 安全吗？” | `aiwb check 0x...` |
| “0x... 买 0.05 BNB” | `aiwb buy 0x... 0.05` |
| “卖一半” | `aiwb sell 0x... 50%` |
| “狙 Four 的 Agent 新币，每个 0.02，最多 3 个” | 先问你每天上限和最高税，再 `aiwb snipe add watch ...` |
| “我赚了多少？” | `aiwb pnl` |

## 用之前要知道

- Agent 币还在只限 AI 钱包的内盘阶段时，币安可能不让 AI 钱包卖出。做好拿到它上 PancakeSwap 的准备，只买你拿得住的量。
- 每笔交易币安都会先检查再签名，可能拒绝。每日限额和风控设置在 App 里，不在这里。
- 默认用免费的公共 BSC 节点。想狙得更快可以换成自己的：`aiwb config set rpc <地址>`。
- 这是工具，不是投资建议。新币风险很高，大多数会归零。

## 谁在用

- [yoki](https://x.com/Yokiiio22)
- [agentidlive.ai](https://agentidlive.ai)

## 许可

MIT
