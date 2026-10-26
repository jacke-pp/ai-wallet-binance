// aiwb local trading page. Talks only to the aiwb process that served it (same origin, random key from the link).
// Everything that comes from the chain (coin names, symbols) is untrusted: it is only ever set as text, never as HTML.
'use strict';

// ---------- key from the link ----------
const KEY = (() => {
  const m = location.hash.match(/k=([0-9a-f]{48})/);
  if (m) { sessionStorage.setItem('aiwb-key', m[1]); history.replaceState(null, '', location.pathname); return m[1]; }
  return sessionStorage.getItem('aiwb-key');
})();

// ---------- words ----------
const T = {
  en: {
    searchPh: 'Paste a contract address', trenches: 'Trenches', coin: 'Coin', trade: 'Trade', quickBuy: 'Quick buy', all: 'All',
    colNew: 'New', colSoon: 'Nearly full', colLaunched: 'Launched', kwPh: 'Filter', agentExcl: 'Agent only', taxShort: 'Tax {b}/{s}%',
    mcShort: 'MC', holdersShort: 'Holders', dev: 'Dev', colEmpty: 'Nothing here right now.', boardLoading: 'Reading the launchpads…',
    quickHint: 'Your quick-buy amounts in BNB. Empty ones are hidden; one click buys at once.', quickSetBtn: 'Set quick buy', quickDone: 'Bought {sym}. Details under Trade.',
    emptyTitle: 'Paste a coin to trade it', emptyBody: 'Paste a contract address above, or pick a coin in the trenches. Buys and sells go through your Binance AI wallet; Binance signs every one.',
    noChart: 'No chart yet. Binance has not indexed this coin.', buy: 'Buy', sell: 'Sell', amount: 'Amount', slippage: 'Slippage',
    agentWarn: 'Agent-only curve: Binance may refuse to let an AI wallet sell this until it graduates to PancakeSwap. Only buy what you can afford to hold.',
    appWarn: 'Binance screens this coin as risky: every sale needs a tap in the Binance App. Keep your phone at hand.',
    autoTab: 'Auto-send & data', autoTitle: 'Send coins out automatically', autoIntro: 'Once an agent coin you bought can move, send all of it to your address. Off until you switch it on; only coins bought (or claimed) after that are sent, each coin once.',
    autoTo: 'Send to address', autoFlap: 'Flap: when the market launches, claim my coins and send them', autoFour: 'Four: when the coin graduates to PancakeSwap, send it', autoGang: 'GANG: when the coin graduates (unlocks), send it',
    autoClaim: 'Flap: claim launched coins into this wallet (no sending)', autoWarn: 'Check the address twice: coins sent there cannot come back. If Binance asks for a tap in the App, confirm it there. Runs while this page (aiwb ui) is open.',
    gmgnTitle: 'GMGN data (read only)', gmgnIntro: 'With your own GMGN API key the chart and coin stats come from GMGN. Get a key at gmgn.ai/ai. Trading still goes through your Binance AI wallet: GMGN wallets have no Agent ID.',
    gmgnKeyLabel: 'GMGN API key', gmgnSet: 'A key is saved on this computer (never shown).', gmgnUnset: 'No key yet: the chart comes from Binance.', gmgnClear: 'Remove key', autoSave: 'Save',
    autoSaved: 'Saved.', autoNone: 'Nothing sent automatically yet.', autoOnSince: 'on since {t}', autoSt: { sent: 'sent', retry: 'will retry', failed: 'gave up', nothing: 'nothing left', claimed: 'claimed' },
    gmHolders: 'Holders (GMGN)', gmTop10: 'Top 10 hold', gmDev: 'Creator holds', gmFresh: 'New wallets', gmBots: 'Bots', gmLiq: 'Liquidity', gmFlow: 'Buys / sells 1h', gmSafe: 'Contract', gmHoney: 'honeypot!', gmRenounced: 'renounced', gmOwned: 'owner can change it', sideSend: 'Send',
    holdings: 'Holdings', trades: 'Trades', snipes: 'Snipes', snipeWatch: 'New coins', snipeToken: 'One coin', snipeCa: 'Coin address',
    allPads: 'All launchpads', snipeBnb: 'BNB per coin', snipeCount: 'Most coins', snipeCap: 'Daily cap (BNB)', snipeTax: 'Max buy tax %', snipeName: 'Name has (optional)',
    snipeAdd: 'Add snipe', snipeHint: 'Snipes run while this page is open and aiwb ui is running. No number has a default: fill in each one.',
    loginTitle: 'Sign in with your Binance AI wallet', loginBody: 'Scan the code with the Binance App. Your keys stay with Binance; this page never sees them.',
    loginStep1: 'Open the Binance App and scan this code.', loginStep2: 'Check the pairing code matches.', loginStep3: 'Confirm. This page continues by itself.',
    loginBtn: 'Show sign-in code', loginNew: 'Get a new code', loginSafe: 'Runs only on this computer (127.0.0.1).', loginSkip: 'Look around first',
    signIn: 'Sign in', pairing: 'Pairing code', expiresIn: 'Code expires in {s}s', loginOk: 'Signed in', loginFail: 'Sign-in failed: {e}',
    noKey: 'This page needs the link aiwb ui printed. Run aiwb ui again and open its link.',
    mcap: 'Market cap', holders: 'Holders', vol: '24h volume', tax: 'Buy / sell tax', where: 'Trades on', quote: 'Priced in', progress: 'Curve filled',
    phaseCurve: 'curve', phaseDex: 'DEX', agentOnly: 'Agent only', copied: 'Address copied',
    balance: 'Balance {v} BNB', held: 'You hold {v}', holdNone: 'You hold none', editPresets: 'Edit amounts', presetsPrompt: 'Buy amounts in BNB, separated by spaces',
    buyBtn: 'Buy {v} BNB', buyEnter: 'Enter an amount', sellBtn: 'Sell {v}%', sellPick: 'Pick how much to sell', signInFirst: 'Sign in to trade',
    sending: 'Checking and sending', sendingSub: 'Binance checks and signs it. Usually 5 to 15 seconds.',
    appTitle: 'Confirm in your Binance App', appBody: 'Binance wants a tap on your phone for this {label}. Open the App and confirm.', appLeft: '{m}:{s} left',
    bought: 'Bought {t} {sym} for {b} BNB', sold: 'Sold {t} {sym} for {b} BNB', claimed: 'Claimed: the coins are in your AI wallet now.',
    claimBtn: 'Claim my coins', claimHint: 'This coin has launched. Claim turns your curve shares into the coin, sent to this AI wallet; then trade it like any coin.', gmgn: 'GMGN', inSec: 'in {s} s', viewTx: 'View on bscscan',
    checking: 'Checking this coin', vOk: 'No red flags', vCareful: 'Careful', vNo: 'Do not buy', trip: 'Buy and sell back 0.001 BNB: {p}% returns',
    noHoldings: 'Nothing held yet. Coins you buy here or with aiwb show up here.', noTrades: 'No trades yet.', noSnipes: 'No snipes set.',
    colCoin: 'Coin', colHeld: 'Held', colValue: 'Value', colCost: 'Cost', colPnl: 'Realized', colTime: 'Time', colSide: 'Side', colBnb: 'BNB', colAmt: 'Amount', colStatus: 'Status', colTx: 'Tx',
    sideBuy: 'Buy', sideSell: 'Sell', sideClaim: 'Claim', sideCall: 'Call', stOk: 'Done', stFail: 'Failed', stNotSent: 'Not sent',
    snipeOn: 'Running', snipeOff: 'Stopped', stop: 'Stop', snipeAdded: 'Snipe added', snipeSummary: '{bnb} BNB each, at most {n}, {cap} BNB a day, tax up to {tax}%',
    quickSet: 'Set a quick buy amount first', quickSending: 'Buying {sym} with {v} BNB',
    feedNote: 'New agent coins: Binance may not let an AI wallet sell them before they graduate.',
    noteDev: 'Developer mode is off, so contract trades will fail. Turn it on in the Binance App, AI wallet settings.',
    noteAgent: 'This wallet has no Agent ID, so it cannot buy agent-only coins. Claim a .ai name in the Binance App.',
    noteRisk: 'Risky transactions are set to auto-reject, so Binance refuses some sales. In the Binance App, AI wallet settings, set it to confirm in the App.',
    noteSession: 'Your sign-in ends in {h} hours. Sign in again after that.',
    ago: '{v}s', agoM: '{v}m', agoH: '{v}h', claim: 'Claim',
  },
  zh: {
    searchPh: '粘贴合约地址', trenches: '战壕', coin: '币', trade: '交易', quickBuy: '快买', all: '全部',
    colNew: '新创建', colSoon: '即将打满', colLaunched: '已开盘', kwPh: '筛选', agentExcl: 'Agent 专属', taxShort: '税 {b}/{s}%',
    mcShort: '市值', holdersShort: '持有', dev: 'Dev', colEmpty: '这里暂时没有币。', boardLoading: '正在读取发射台…',
    quickHint: '快买金额（BNB），空着的不显示；点一下直接买。', quickSetBtn: '设快买', quickDone: '已买入 {sym}，详情在“交易”页。',
    emptyTitle: '粘贴一个币就能交易', emptyBody: '在上面粘贴合约地址，或者在战壕里点一个币。买卖都走你自己的币安 AI 钱包，每一笔都由币安签名。',
    noChart: '暂时没有 K 线，币安还没收录这个币。', buy: '买入', sell: '卖出', amount: '数量', slippage: '滑点',
    agentWarn: 'Agent 专属内盘：毕业到 PancakeSwap 之前，币安可能不让 AI 钱包卖出。只买你拿得住的量。',
    appWarn: '币安把这个币标成有风险：每次卖出都要在币安 App 里点确认，手机放旁边。',
    autoTab: '自动转出与数据', autoTitle: '自动把币转出去', autoIntro: '买到的 Agent 币一能转，就把全部转到你的地址。默认关；打开后只转之后买到（或领到）的币，每个币只转一次。',
    autoTo: '转到这个地址', autoFlap: 'Flap：市场发币后，自动领币再转出', autoFour: 'Four：币毕业到 PancakeSwap 后转出', autoGang: 'GANG：币毕业（解锁）后转出',
    autoClaim: 'Flap：发币后自动领到本钱包（不转出）', autoWarn: '地址核对两遍：转过去就回不来了。币安要求在 App 里确认的，到 App 里点确认。这个页面（aiwb ui）开着时才会运行。',
    gmgnTitle: 'GMGN 数据（只读）', gmgnIntro: '填上你自己的 GMGN API key，K 线和币的数据就从 GMGN 来。key 在 gmgn.ai/ai 申请。交易仍走你的币安 AI 钱包：GMGN 钱包没有 Agent ID。',
    gmgnKeyLabel: 'GMGN API key', gmgnSet: 'key 已存在这台电脑上（不会显示出来）。', gmgnUnset: '还没填 key：K 线来自币安。', gmgnClear: '删除 key', autoSave: '保存',
    autoSaved: '已保存。', autoNone: '还没有自动转出过。', autoOnSince: '{t} 起打开', autoSt: { sent: '已转出', retry: '稍后重试', failed: '已放弃', nothing: '没有可转的', claimed: '已领取' },
    gmHolders: '持有人（GMGN）', gmTop10: '前 10 持仓', gmDev: '创建者持仓', gmFresh: '新钱包', gmBots: '机器人', gmLiq: '流动性', gmFlow: '1 小时买 / 卖', gmSafe: '合约', gmHoney: '貔貅！', gmRenounced: '已放弃权限', gmOwned: '所有者还能改', sideSend: '转出',
    holdings: '持仓', trades: '成交记录', snipes: '狙击', snipeWatch: '盯新币', snipeToken: '盯一个币', snipeCa: '币的地址',
    allPads: '全部平台', snipeBnb: '每个币花多少 BNB', snipeCount: '最多买几个', snipeCap: '每天最多花 BNB', snipeTax: '买税最高 %', snipeName: '名字包含（可不填）',
    snipeAdd: '添加狙击', snipeHint: '页面开着、aiwb ui 在运行时狙击才会跑。每个数字都没有默认值，要你自己填。',
    loginTitle: '用币安 AI 钱包登录', loginBody: '用币安 App 扫码。钥匙一直在币安那边，这个页面看不到。',
    loginStep1: '打开币安 App，扫这个码。', loginStep2: '核对配对码一致。', loginStep3: '点确认，这里会自动进入。',
    loginBtn: '显示登录二维码', loginNew: '换一个新码', loginSafe: '只在这台电脑上运行（127.0.0.1）。', loginSkip: '先随便看看',
    signIn: '登录', pairing: '配对码', expiresIn: '{s} 秒后过期', loginOk: '已登录', loginFail: '登录失败：{e}',
    noKey: '这个页面要用 aiwb ui 打印的链接打开。重新运行 aiwb ui，点它给的链接。',
    mcap: '市值', holders: '持有人', vol: '24 小时成交', tax: '买 / 卖税', where: '交易地点', quote: '计价币', progress: '内盘进度',
    phaseCurve: '内盘', phaseDex: '外盘', agentOnly: '仅 Agent', copied: '地址已复制',
    balance: '余额 {v} BNB', held: '持有 {v}', holdNone: '没有持仓', editPresets: '改金额', presetsPrompt: '快捷买入金额（BNB），用空格隔开',
    buyBtn: '买入 {v} BNB', buyEnter: '输入金额', sellBtn: '卖出 {v}%', sellPick: '选卖出比例', signInFirst: '登录后才能交易',
    sending: '正在检查并发送', sendingSub: '币安检查并签名，一般 5 到 15 秒。',
    appTitle: '去币安 App 里确认', appBody: '币安要你在手机上确认这笔{label}。打开 App 点确认。', appLeft: '还剩 {m}:{s}',
    bought: '用 {b} BNB 买到 {t} {sym}', sold: '卖出 {t} {sym}，拿回 {b} BNB', claimed: '领取成功：币已经到你的 AI 钱包。',
    claimBtn: '领取我的币', claimHint: '这个币已经发出来了。点领取，内盘份额换成正式币，直接进这个 AI 钱包，之后就能正常买卖。', gmgn: 'GMGN', inSec: '用时 {s} 秒', viewTx: '在 bscscan 查看',
    checking: '正在检查这个币', vOk: '没发现问题', vCareful: '小心', vNo: '别买', trip: '模拟买入再卖出 0.001 BNB：拿回 {p}%',
    noHoldings: '还没有持仓。在这里或用 aiwb 买的币会显示在这里。', noTrades: '还没有成交。', noSnipes: '还没设狙击。',
    colCoin: '币', colHeld: '持有', colValue: '价值', colCost: '成本', colPnl: '已实现盈亏', colTime: '时间', colSide: '方向', colBnb: 'BNB', colAmt: '数量', colStatus: '状态', colTx: '交易',
    sideBuy: '买', sideSell: '卖', sideClaim: '领取', sideCall: '调用', stOk: '成功', stFail: '失败', stNotSent: '没发出',
    snipeOn: '运行中', snipeOff: '已停', stop: '停止', snipeAdded: '狙击已添加', snipeSummary: '每个 {bnb} BNB，最多 {n} 个，每天最多 {cap} BNB，买税不超过 {tax}%',
    quickSet: '先填快买金额', quickSending: '正在用 {v} BNB 买 {sym}',
    feedNote: '新 Agent 币：毕业之前币安可能不让 AI 钱包卖出。',
    noteDev: '开发者模式没开，合约交易会失败。到币安 App 的 AI 钱包设置里打开。',
    noteAgent: '这个钱包没有 Agent ID，买不了 Agent 专属币。到币安 App 领一个 .ai 名字。',
    noteRisk: '风险交易设成了自动拒绝，币安会拦掉一些卖出。到币安 App 的 AI 钱包设置里改成在 App 内确认。',
    noteSession: '登录还剩 {h} 小时，到期后重新登录。',
    ago: '{v}秒', agoM: '{v}分', agoH: '{v}时', claim: '领取',
  },
};
let lang = localStorage.getItem('aiwb-lang') || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en');
const t = (k, vars = {}) => (T[lang][k] ?? T.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  $('#lang').textContent = lang === 'zh' ? 'EN' : '中';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  renderAll();
}

// Check results in Chinese (the check itself speaks English; it gives each flag a key and its numbers).
const FLAGS_ZH = {
  auditHigh: '币安审计：高风险（{level}/5）：{hits}', auditMid: '币安审计：中风险（{level}/5）：{hits}',
  buyFails: '模拟买入现在会失败：{reason}', sellFails: '买入后马上模拟卖出失败：{reason}。可能卖不掉。', sellFails2: '用你的钱包模拟买入后马上卖出会失败，可能卖不掉。',
  tripTrap: '模拟买入再卖出 0.001 BNB 只拿回 {pct}%，税极高或是陷阱。', tripHigh: '模拟买入再卖出 0.001 BNB 拿回 {pct}%（税和手续费偏高）。',
  sellTax: '卖出税 {pct}%。', buyTax: '买入税 {pct}%。', taxDiffers: '实测税率和币安审计不一致（实测 / 审计：{list}），税率可能因钱包或时间而变。',
  agentOnly: 'Agent 专属内盘：毕业前只有带币安 Agent ID 的钱包能买，币也转不到别的钱包；卖出可能被拒或要在币安 App 里确认，可能要拿到毕业。',
  appConfirm: '这个币每次卖出都要在币安 App 里点确认：币安把它标成有风险。AI 钱包设置里“异常交易处理”要选“在 App 内确认”；选自动拒绝就卖不掉。',
  noWallet: '没登录：用中性地址模拟，不是你的钱包（有些币对不同钱包不一样）。登录后会用你自己的钱包检查。',
  noAgentId: '这个钱包没有 Agent ID（.ai 名字），买不了这个币。到币安 App 领一个。',
  thinPool: '{symbol} 的 PancakeSwap V2 BNB 池只有约 {v2Bnb} BNB，它最深的池子是 {best}，约 {bestBnb} BNB。aiwb 买卖时会比较 V2 和 KyberSwap，哪条换得多走哪条，所以会走深池；只有找遍路线还是会把价格推动超过上限（默认 5%）时才拒绝。',
};
const flagText = f => (lang === 'zh' && f.key && FLAGS_ZH[f.key] ? FLAGS_ZH[f.key].replace(/\{(\w+)\}/g, (_, v) => f.vars?.[v] ?? '') : f.text);
// The errors people meet most often, in Chinese; anything else is shown as aiwb wrote it.
const ERRORS_ZH = [
  [/would move the price ([\d.]+)% \(your limit is ([\d.]+)%\)/i, (m, full) => {
    const deep = full.match(/(\S+): the PancakeSwap V2 BNB pool holds about ([\d.]+) BNB, but its deepest pool is (.+?) with about ([\d.]+) BNB/);
    return `池子太浅：找遍能走的路线，这笔还是会把价格推动 ${m[1]}%，超过你的上限 ${m[2]}%，没有发出任何交易。` +
      (deep ? `${deep[1]} 的 V2 池只有约 ${deep[2]} BNB，它最深的池子是 ${deep[3]}，约 ${deep[4]} BNB。` : '') +
      '少买一点、去币安 App 里交易，或用 aiwb config set maxImpactPct 调高上限。';
  }],
  [/Set the address to send to first/i, '先填要转到的地址，再打开自动转出。'],
  [/autoSendTo must be a BNB Chain address/i, '地址不对：要 0x 开头、后面 40 位的 BNB Chain 地址。'],
  [/does not look like a GMGN API key/i, '这看起来不是 GMGN 的 API key，请到 gmgn.ai/ai 复制。'],
  [/That is this AI wallet itself/i, '这就是 AI 钱包自己的地址，没有发出任何交易。'],
  [/has not launched yet: claim/i, '这个币还没发出来，内盘满了才能领。在那之前可以卖掉份额。没有发出任何交易。'],
  [/no shares in this market/i, '这个钱包在这个市场里没有份额，没有可领的。没有发出任何交易。'],
  [/too risky/i, '币安风控判定这笔交易风险太高，没有发出。到币安 App 的 AI 钱包设置里，把“异常交易处理”改成在 App 内确认，之后这类交易会推到 App 让你确认。'],
  [/Not confirmed in the Binance App/i, '10 分钟内没在币安 App 里确认。之后再确认也会成交：再试之前先看成交记录或 bscscan。'],
  [/less than .* Top it up/i, 'AI 钱包的 BNB 不够，到币安 App 里充值。没有发出任何交易。'],
  [/holds no /i, '这个钱包没有这个币，没有发出任何交易。'],
  [/Agent ID/i, '这个币只卖给带币安 Agent ID（.ai 名字）的钱包。先到币安 App 给这个钱包领一个。没有发出任何交易。'],
  [/daily limit|daily cap/i, '已到每日上限，没有发出。'],
  [/not signed in|sign in|login/i, '需要先登录币安 AI 钱包。'],
];
const errText = m => {
  if (lang !== 'zh') return m;
  const hit = ERRORS_ZH.find(([re]) => re.test(m));
  return !hit ? m : typeof hit[1] === 'function' ? hit[1](m.match(hit[0]), m) : hit[1];
};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat().filter(c => c != null && c !== false)); return el; };
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-aiwb-key': KEY }, body: JSON.stringify(body) } : { headers: { 'x-aiwb-key': KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code });
  return j;
}
let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2600); }
const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const scan = (kind, v) => `https://bscscan.com/${kind}/${v}`;
const SUB = '₀₁₂₃₄₅₆₇₈₉';
function price(p) {
  if (p == null || !isFinite(p)) return '–';
  p = Number(p);
  if (p === 0) return '$0';
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (p >= 0.0001) return '$' + p.toPrecision(4).replace(/0+$/, '');
  const zeros = Math.floor(-Math.log10(p)) - 1;
  const digits = Math.round(p * 10 ** (zeros + 4)).toString().slice(0, 4).replace(/0+$/, '');
  return '$0.0' + String(zeros).split('').map(d => SUB[d]).join('') + digits;
}
function num(n, d = 2) {
  if (n == null || !isFinite(n)) return '–';
  n = Number(n);
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(d) + 'K';
  if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: d });
  return n === 0 ? '0' : n.toPrecision(3);
}
const usd = n => (n == null ? '–' : '$' + num(n));
const bnb = n => (n == null ? '–' : Number(n).toFixed(Number(n) >= 1 ? 3 : 4).replace(/\.?0+$/, ''));
function ago(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return s < 60 ? t('ago', { v: s }) : s < 3600 ? t('agoM', { v: Math.floor(s / 60) }) : t('agoH', { v: Math.floor(s / 3600) });
}
const PADS = { 'four-agent': 'Four Agent', 'flap-agent': 'Flap Agent', gang: 'GANG', flap: 'Flap', 'pancake-v2': 'PancakeSwap', 'self-curve': 'Agent curve' };

// ---------- state ----------
const S = {
  state: null, board: new Map(), boardReady: false, view: 'trenches', col: 'new', ca: null, coin: null, check: null, candles: [], interval: '1min',
  side: 'buy', sellPct: null, busy: null, holdings: [], journal: [], snipes: null, tab: 'holdings', login: null,
};

// ---------- wallet + notes ----------
async function loadState(fresh) {
  try { S.state = await api('/api/state' + (fresh ? '?fresh=1' : '')); } catch (e) { S.state = { signedIn: false, error: e.message }; }
  renderWallet(); renderNotes(); renderTrade();
  return S.state;
}
function renderWallet() {
  const st = S.state, el = $('#wallet');
  if (!st) return fill(el);
  if (!st.signedIn) return fill(el, h('span', { class: 'dot off' }), h('button', { class: 'ghost', type: 'button', onclick: () => showLogin(true) }, t('signIn')));
  fill(el, h('span', { class: 'dot' }), h('b', {}, `${bnb(st.bnb)} BNB`), h('span', { class: 'addr', title: st.address }, short(st.address)));
}
function renderNotes() {
  const st = S.state, el = $('#notes'), out = [];
  if (st?.signedIn) {
    const s = st.settings || {};
    if (st.settings && !s.devMode) out.push(t('noteDev'));
    if (st.agentId === false) out.push(t('noteAgent'));
    if (s.riskyTx && /reject/i.test(s.riskyTx)) out.push(t('noteRisk'));
    const end = s.sessionEnds ? new Date(isNaN(s.sessionEnds) ? s.sessionEnds : Number(s.sessionEnds)).getTime() : null;
    if (end && end - Date.now() < 24 * 3600e3 && end > Date.now()) out.push(t('noteSession', { h: Math.max(1, Math.round((end - Date.now()) / 3600e3)) }));
  }
  el.hidden = !out.length;
  fill(el, out.map(x => h('p', {}, x)));
}

// ---------- sign-in ----------
let loginTimer;
function showLogin(on) {
  $('#login').hidden = !on;
  layout();
  if (on) renderLogin();
}
function renderLogin() {
  const L = S.login;
  const qr = $('#qr');
  if (L?.qrSvg) {
    // The SVG is made by the bundled QR library from Binance's sign-in link, not from chain data.
    const doc = new DOMParser().parseFromString(L.qrSvg, 'image/svg+xml');
    fill(qr, document.importNode(doc.documentElement, true));
  } else fill(qr);
  const pair = $('#pair');
  if (L?.pairingCode) {
    const left = L.expireAt ? Math.max(0, Math.round((Number(L.expireAt) - Date.now()) / 1000)) : null;
    fill(pair, `${t('pairing')} `, h('b', {}, L.pairingCode), left != null ? h('span', { class: 'hint' }, `  ${t('expiresIn', { s: left })}`) : null);
  } else if (L?.error) fill(pair, L.error);
  else fill(pair);
  $('#loginBtn').textContent = L ? t('loginNew') : t('loginBtn');
}
async function startLogin() {
  $('#loginBtn').disabled = true;
  try {
    const r = await api('/api/login', {});
    if (r.connected) { S.login = null; await signedIn(); return; }
    S.login = r;
    clearInterval(loginTimer);
    loginTimer = setInterval(renderLogin, 1000);
  } catch (e) { S.login = { error: e.message }; }
  finally { $('#loginBtn').disabled = false; renderLogin(); }
}
async function signedIn() {
  clearInterval(loginTimer); S.login = null;
  toast(t('loginOk'));
  showLogin(false);
  await loadState(true);
  loadHoldings(); loadJournal();
  if (S.ca) loadCoin(S.ca);
}

// ---------- trenches: new / nearly full / launched ----------
const COLS = ['new', 'soon', 'launched'];
const COL_KEY = { new: 'colNew', soon: 'colSoon', launched: 'colLaunched' };
const PAD_KEYS = ['all', 'four-agent', 'flap-agent', 'gang'];
const PAD_SHORT = { 'four-agent': 'Four', 'flap-agent': 'Flap', gang: 'GANG' };
const SORT = { new: (a, b) => (b.created || 0) - (a.created || 0), soon: (a, b) => (b.progress || 0) - (a.progress || 0), launched: (a, b) => (b.launchedAt || 0) - (a.launchedAt || 0) };
function colPrefs(c) { try { return { kw: '', pad: 'all', ...JSON.parse(localStorage.getItem(`aiwb-col-${c}`) || '{}') }; } catch { return { kw: '', pad: 'all' }; } }
const saveCol = (c, p) => localStorage.setItem(`aiwb-col-${c}`, JSON.stringify(p));
// Quick-buy amounts P1..P3: only what the user typed. Nothing is filled in for them.
function quick3() { try { const q = JSON.parse(localStorage.getItem('aiwb-quick3') || '[]'); return [0, 1, 2].map(i => String(q[i] ?? '')); } catch { return ['', '', '']; } }
const quickVals = () => quick3().map(v => (Number(v) > 0 ? Number(v) : null));
// Open markets trade by the market address; a launched Flap market by the coin it became (claims still work from it).
const cardAddr = it => (it.launched && it.coin ? it.coin : it.token);
const amt = v => (v == null ? '–' : num(v, v >= 1e4 ? 1 : 2));
const cap = v => { // compact dollars for the cards: $3.3K, $17.7K, $235K, $3.40M
  if (v == null) return '–';
  const a = Math.abs(v);
  return '$' + (a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : Math.round(v));
};
const pctTxt = v => (v == null ? '–' : String(Number(v.toFixed(1))));
const cols = {}, cards = new Map();

function buildBoard() {
  for (const c of COLS) {
    const p = colPrefs(c);
    const kw = h('input', { class: 'kw', 'data-i18n-ph': 'kwPh', spellcheck: 'false', 'aria-label': 'filter', value: p.kw,
      oninput: e => { const q = colPrefs(c); q.kw = e.target.value; saveCol(c, q); renderBoard(); } });
    const pads = h('div', { class: 'pf' }, PAD_KEYS.map(k => h('button', { type: 'button', 'data-p': k, class: p.pad === k ? 'on' : '', onclick: () => {
      const q = colPrefs(c); q.pad = k; saveCol(c, q);
      pads.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === k)); renderBoard();
    } }, k === 'all' ? h('span', { 'data-i18n': 'all' }) : PAD_SHORT[k])));
    const box = { count: h('span', { class: 'count' }), list: h('ol', { class: 'cards' }), empty: h('p', { class: 'col-empty' }) };
    box.sec = h('section', { class: `col col-${c}`, 'data-col': c },
      h('header', {}, h('div', { class: 'col-title' }, h('h2', { 'data-i18n': COL_KEY[c] }), box.count), h('div', { class: 'col-tools' }, kw, pads)),
      box.list, box.empty);
    $('#cols').append(box.sec);
    cols[c] = box;
  }
}

let boardQueued = false;
function renderBoard() {
  if (boardQueued) return;
  boardQueued = true;
  setTimeout(() => { boardQueued = false; drawBoard(); }, 80); // at most ~12 redraws a second, however fast updates come
}
function drawBoard() {
  if (!cols.new) return;
  const all = [...S.board.values()], q = quickVals();
  for (const c of COLS) {
    const p = colPrefs(c), kw = p.kw.trim().toLowerCase(), box = cols[c];
    const hits = all.filter(it => it.stage === c && (p.pad === 'all' || it.platform === p.pad)
      && (!kw || `${it.symbol || ''} ${it.name || ''} ${it.token} ${it.coin || ''}`.toLowerCase().includes(kw))).sort(SORT[c]);
    const list = hits.slice(0, 60);
    box.count.textContent = hits.length ? String(hits.length) : '';
    box.empty.hidden = list.length > 0;
    box.empty.textContent = S.boardReady ? t('colEmpty') : t('boardLoading');
    // Reuse each coin's card and only move what changed place: no flicker while numbers update.
    list.forEach((it, i) => {
      const card = cardOf(it);
      updateCard(card, it, q);
      const at = box.list.children[i];
      if (at !== card.el) box.list.insertBefore(card.el, at || null);
    });
    while (box.list.children.length > list.length) box.list.lastChild.remove();
    box.sec.classList.toggle('on', S.col === c);
  }
  document.querySelectorAll('#ttabs button').forEach(b => b.classList.toggle('on', b.dataset.col === S.col));
  for (const [id, c] of cards) if (!S.board.has(id)) { c.el.remove(); cards.delete(id); }
}
function cardOf(it) {
  let c = cards.get(it.id);
  if (c) return c;
  const f = {};
  const el = h('li', { class: 'card', tabindex: '0', onclick: () => openCoin(cardAddr(S.board.get(it.id) || it)), onkeydown: e => { if (e.key === 'Enter') openCoin(cardAddr(S.board.get(it.id) || it)); } },
    f.av = h('div', { class: 'av' }),
    h('div', { class: 'cm' },
      h('div', { class: 'r1' }, f.sym = h('b', { class: 'sym' }), f.name = h('span', { class: 'nm' }), f.age = h('span', { class: 'age' })),
      h('div', { class: 'r2' }, f.pad = h('span', { class: 'pad' }), f.agent = h('span', { class: 'tag agent' }), f.tax = h('span', { class: 'tag' }), f.quote = h('span', { class: 'tag' })),
      h('div', { class: 'r3' }, f.bar = h('div', { class: 'bar' }, f.fill = h('i')), f.pct = h('b', { class: 'pct' }), f.raised = h('span', { class: 'raised' })),
      h('div', { class: 'r4' }, f.mc = h('span'), f.hold = h('span'), f.dev = h('span', { class: 'dev' }))),
    f.qb = h('div', { class: 'qbs' }));
  c = { el, f, last: {} };
  cards.set(it.id, c);
  return c;
}
function updateCard(c, it, q) {
  const f = c.f, put = (k, el, v) => { if (c.last[k] !== v) { c.last[k] = v; el.textContent = v; } };
  const av = it.icon || `L${it.symbol || '?'}`;
  if (c.last.av !== av) {
    c.last.av = av;
    f.av.style.setProperty('--h', String(parseInt(it.id.slice(-4), 16) % 360));
    if (it.icon) fill(f.av, h('img', { src: it.icon, alt: '', width: '44', height: '44', loading: 'lazy', onerror: e => { c.last.av = null; fill(f.av, (it.symbol || '?').slice(0, 1).toUpperCase()); e.target.remove(); } }));
    else fill(f.av, (it.symbol || '?').slice(0, 1).toUpperCase());
  }
  put('sym', f.sym, it.symbol || short(it.token));
  put('name', f.name, it.name && it.name !== it.symbol ? it.name : '');
  const since = it.launched ? it.launchedAt : it.created;
  if (since) f.age.dataset.seen = since; else delete f.age.dataset.seen;
  put('age', f.age, since ? ago(since) : '');
  put('pad', f.pad, PADS[it.platform] || it.platform); f.pad.dataset.p = it.platform;
  put('agent', f.agent, t('agentExcl')); f.agent.hidden = !!it.launched;
  put('tax', f.tax, it.buyTax != null ? t('taxShort', { b: pctTxt(it.buyTax), s: pctTxt(it.sellTax) }) : ''); f.tax.hidden = it.buyTax == null;
  f.tax.classList.toggle('hot', it.buyTax > 5 || it.sellTax > 5);
  put('quote', f.quote, it.quote || ''); f.quote.hidden = !it.quote;
  const pct = it.launched ? 100 : Math.max(0, Math.min(100, it.progress ?? 0));
  if (c.last.pct !== pct) {
    const rose = c.last.pct != null && pct > c.last.pct;
    c.last.pct = pct;
    f.fill.style.width = `${Math.max(2, pct)}%`;
    f.pct.textContent = `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
    if (rose) { f.bar.classList.remove('bump'); void f.bar.offsetWidth; f.bar.classList.add('bump'); }
  }
  put('raised', f.raised, it.launched || !it.target ? '' : `${amt(it.raised)} / ${amt(it.target)} ${it.quote || ''}`);
  c.el.classList.toggle('done', !!it.launched);
  c.el.classList.toggle('hot', !it.launched && pct >= 80);
  put('mc', f.mc, `${t('mcShort')} ${cap(it.mcap)}`);
  put('hold', f.hold, `${t('holdersShort')} ${it.holders != null ? num(it.holders, 1) : '–'}`);
  put('dev', f.dev, it.creator ? `${t('dev')} ${it.creator.slice(0, 6)}…${it.creator.slice(-4)}` : '');
  f.dev.title = it.creator || '';
  const qk = `${q.join(',')}|${lang}`;
  if (c.last.q !== qk) {
    c.last.q = qk;
    fill(f.qb, q.some(Boolean)
      ? q.map((v, i) => v && h('button', { type: 'button', class: 'qb', title: `P${i + 1}`, onclick: e => { e.stopPropagation(); quickBuy(S.board.get(it.id) || it, v); } }, String(v)))
      : h('button', { type: 'button', class: 'qb set', onclick: e => { e.stopPropagation(); $('#quick3 input').focus(); toast(t('quickHint')); } }, t('quickSetBtn')));
  }
  if (it.fresh) { it.fresh = false; c.el.classList.remove('fresh'); void c.el.offsetWidth; c.el.classList.add('fresh'); }
  const cur = S.ca?.toLowerCase();
  c.el.classList.toggle('cur', !!cur && (cur === it.token.toLowerCase() || cur === (it.coin || '').toLowerCase()));
}
function tickAges() { document.querySelectorAll('[data-seen]').forEach(el => { el.textContent = ago(Number(el.dataset.seen)); }); }
function quickBuy(it, v) {
  if (!it || !(v > 0)) return;
  if (!S.state?.signedIn) return showLogin(true);
  const ca = cardAddr(it);
  toast(t('quickSending', { v, sym: it.symbol || short(ca) }));
  runTrade('buy', { ca, bnb: v });
  if (S.busy) S.busy.sym = it.symbol || null;
}
function setView(v) {
  S.view = v;
  layout();
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'coin') drawChart(); else renderBoard();
}
function layout() {
  const login = !$('#login').hidden, noKey = !KEY;
  $('#trenches').hidden = login || noKey || S.view !== 'trenches';
  $('#app').hidden = login || noKey || S.view !== 'coin';
}

// ---------- coin ----------
function openCoin(ca, { keepPane } = {}) {
  ca = ca.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) { toast(lang === 'zh' ? '这不是合约地址（0x 开头，40 位）' : 'That is not a contract address (0x and 40 characters).'); return; }
  if (S.ca?.toLowerCase() !== ca.toLowerCase()) { S.coin = null; S.check = null; S.candles = []; S.sellPct = null; }
  S.ca = ca;
  $('#ca').value = ca;
  setView('coin');
  if (!keepPane) mobilePane('coin');
  renderBoard(); renderCoin(); renderTrade();
  S.gm = null; renderGmgn();
  loadCoin(ca); loadCandles(); loadCheck(ca); loadGmgn(ca);
}
async function loadCoin(ca) {
  try { const v = await api(`/api/token?ca=${ca}`); if (S.ca === ca) { S.coin = v; renderCoin(); renderTrade(); } }
  catch (e) { if (S.ca === ca) { S.coin = { error: e.message }; renderCoin(); } }
}
async function loadCheck(ca) {
  try { const v = await api(`/api/check?ca=${ca}`); if (S.ca === ca) { S.check = v; renderCheck(); } }
  catch (e) { if (S.ca === ca) { S.check = { error: e.message }; renderCheck(); } }
}
async function loadCandles() {
  const ca = S.ca;
  if (!ca) return;
  try {
    const v = await api(`/api/candles?ca=${ca}&interval=${S.interval}`);
    if (S.ca === ca) { S.candles = v; $('#chartSrc').textContent = v.length ? (v[0].src === 'gmgn' ? 'GMGN' : 'Binance') : ''; drawChart(); }
  } catch { /* keep the last chart */ }
}
// GMGN's stats for the coin, when the user saved a GMGN key (Auto-send & data tab).
async function loadGmgn(ca) {
  if (!S.settings?.gmgnKey) { S.gm = null; return renderGmgn(); }
  try { const v = await api(`/api/gmgn?ca=${ca}`); if (S.ca === ca) { S.gm = v; renderGmgn(); } } catch { /* keep */ }
}
function renderGmgn() {
  const g = S.gm, el = $('#gmStats');
  el.hidden = !g;
  if (!g) return;
  const pct = v => (v == null ? '–' : `${Number(v).toFixed(1)}%`);
  const safe = g.honeypot ? h('b', { class: 'down' }, t('gmHoney')) : g.renounced == null ? '–' : g.renounced ? t('gmRenounced') : h('span', { class: 'down' }, t('gmOwned'));
  fill(el, [[t('gmHolders'), g.holders == null ? '–' : num(g.holders, 1)], [t('gmTop10'), pct(g.top10Pct)], [t('gmDev'), pct(g.devHoldPct)], [t('gmFresh'), pct(g.freshWalletPct)],
    [t('gmBots'), pct(g.botPct)], [t('gmLiq'), usd(g.liquidityUsd)], [t('gmFlow'), g.buys1h == null ? '–' : `${g.buys1h} / ${g.sells1h ?? '–'}`], [t('gmSafe'), safe]]
    .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
}
function renderCoin() {
  $('#coinEmpty').hidden = !!S.ca;
  $('#coinView').hidden = !S.ca;
  if (!S.ca) return;
  const c = S.coin, i = c?.info, m = c?.market;
  const icon = $('#cIcon');
  icon.hidden = !m?.icon;
  if (m?.icon && icon.getAttribute('src') !== m.icon) icon.src = m.icon;
  const letter = $('#cLetter');
  letter.hidden = !!m?.icon;
  letter.textContent = (c?.symbol || '?').slice(0, 1).toUpperCase();
  $('#cSym').textContent = c?.symbol || (c?.error ? '?' : '…');
  $('#cName').textContent = i?.name && i.name !== c?.symbol ? i.name : '';
  const badge = $('#cBadge');
  badge.textContent = i ? `${PADS[i.platform] || i.platform} ${i.phase === 'dex' ? t('phaseDex') : i.phase === 'curve' ? t('phaseCurve') : ''}${i.agentOnly ? ', ' + t('agentOnly') : ''}`.trim() : '';
  badge.className = 'badge' + (i?.agentOnly ? ' agent' : '');
  badge.hidden = !i;
  $('#cCa').textContent = short(S.ca);
  $('#cScan').href = scan('token', S.ca);
  $('#cGmgn').href = `https://gmgn.ai/bsc/token/${c?.coin || i?.predictedToken || S.ca}`;
  $('#cPrice').textContent = c?.error ? '' : price(m?.price ?? lastClose());
  const ch = m?.change24h;
  const chEl = $('#cChange');
  chEl.textContent = ch == null ? '' : `${ch >= 0 ? '+' : ''}${Number(ch).toFixed(2)}%`;
  chEl.className = ch == null ? '' : ch >= 0 ? 'up' : 'down';
  const stats = [];
  if (c?.error) stats.push([lang === 'zh' ? '出错' : 'Error', c.error]);
  else {
    stats.push([t('mcap'), usd(m?.marketCap)], [t('holders'), m?.holders == null ? '–' : num(m.holders, 1)], [t('vol'), usd(m?.volume24h)]);
    if (i) stats.push([t('tax'), `${i.buyTaxPct ?? '–'}% / ${i.sellTaxPct ?? '–'}%${i.openingFeePct ? ` (+${i.openingFeePct}%)` : ''}`]);
    if (i) stats.push([t('where'), PADS[i.platform] || i.platform]);
    if (i?.quoteSymbol) stats.push([t('quote'), i.quoteSymbol]);
    if (i?.progress != null) stats.push([t('progress'), h('span', {}, `${Number(i.progress).toFixed(1)}%`, h('div', { class: 'progress' }, h('i')))]);
  }
  fill($('#stats'), stats.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
  // width set through the CSSOM (the page's CSP allows no inline style attributes)
  const bar = $('#stats .progress i');
  if (bar) bar.style.width = `${Math.min(100, Number(i.progress))}%`;
  $('#agentWarn').hidden = !i?.agentOnly;
}
function renderCheck() {
  const el = $('#check'), c = S.check;
  $('#appWarn').hidden = !c?.flags?.some(f => f.key === 'appConfirm');
  if (!S.ca) return fill(el);
  if (!c) return fill(el, h('p', { class: 'hint' }, t('checking') + '…'));
  if (c.error) return fill(el, h('p', { class: 'hint' }, c.error));
  const [cls, word] = c.verdict === 'do-not-buy' ? ['no', t('vNo')] : c.verdict === 'careful' ? ['careful', t('vCareful')] : ['ok', t('vOk')];
  const rt = c.roundTrip;
  fill(el,
    h('div', { class: 'verdict' }, h('b', { class: cls }, word), rt?.keepPct != null ? h('span', { class: 'hint' }, t('trip', { p: rt.keepPct })) : null),
    c.flags?.length ? h('ul', { class: 'flags' }, c.flags.map(f => h('li', { class: f.level }, flagText(f)))) : null);
}

// ---------- chart ----------
const cv = () => $('#chart');
let hover = null;
const lastClose = () => (S.candles.length ? Number(S.candles.at(-1).c) : null);
function drawChart() {
  const canvas = cv(), box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, box.width, box.height);
  $('#chartEmpty').hidden = S.candles.length > 0;
  if (!S.candles.length) { $('#chartTip').textContent = ''; return; }
  const W = box.width - 70, H = box.height - 22, volH = H * 0.16;
  // Candles 7 px apart; a young coin with few candles gets wider ones (up to 16 px) so the chart isn't a sliver.
  const n = Math.max(1, Math.min(S.candles.length, Math.floor(W / 7))), step = Math.min(16, Math.max(7, W / n));
  const cs = S.candles.slice(-n).map(c => ({ o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v, t: +c.t }));
  let lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
  if (hi === lo) { hi *= 1.01; lo *= 0.99; }
  const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
  const y = p => (H - volH) * (1 - (p - lo) / (hi - lo)) + 4;
  const vmax = Math.max(...cs.map(c => c.v)) || 1;
  const x0 = W - n * step;
  const bw = Math.max(3, Math.round(step * 0.7)); // candle body width
  g.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  g.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const p = lo + ((hi - lo) * k) / 4, yy = y(p);
    g.strokeStyle = '#2b3139'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke();
    g.fillStyle = '#5e6673'; g.fillText(price(p), W + 6, yy);
  }
  cs.forEach((c, k) => {
    const cx = x0 + k * step + step / 2, up = c.c >= c.o, col = up ? '#2ebd85' : '#f6465d';
    g.fillStyle = up ? 'rgba(46,189,133,.28)' : 'rgba(246,70,93,.28)';
    const vh = (c.v / vmax) * volH; g.fillRect(cx - bw / 2, H - vh, bw, vh);
    g.strokeStyle = col; g.beginPath(); g.moveTo(cx + 0.5, y(c.h)); g.lineTo(cx + 0.5, y(c.l)); g.stroke();
    g.fillStyle = col; const top = y(Math.max(c.o, c.c)); g.fillRect(cx - bw / 2, top, bw, Math.max(1, y(Math.min(c.o, c.c)) - top));
  });
  const last = cs.at(-1), ly = y(last.c);
  g.setLineDash([3, 3]); g.strokeStyle = last.c >= last.o ? '#2ebd85' : '#f6465d'; g.beginPath(); g.moveTo(0, ly); g.lineTo(W, ly); g.stroke(); g.setLineDash([]);
  g.fillStyle = last.c >= last.o ? '#2ebd85' : '#f6465d'; g.fillRect(W + 2, ly - 9, 68, 18); g.fillStyle = '#fff'; g.fillText(price(last.c), W + 6, ly);
  g.fillStyle = '#5e6673'; g.textBaseline = 'alphabetic';
  const marks = [...new Set([0, Math.floor(n / 2), n - 1])].filter((k, j, a) => j === 0 || (k - a[j - 1]) * step > 48);
  marks.forEach(k => { const d = new Date(cs[k].t); g.fillText(d.toTimeString().slice(0, 5), Math.min(W - 30, Math.max(0, x0 + k * step + step / 2 - 15)), box.height - 4); });
  let tip = last;
  if (hover != null) {
    const k = Math.floor((hover - x0) / step);
    if (k >= 0 && k < n) {
      tip = cs[k];
      const cx = x0 + k * step + step / 2;
      g.strokeStyle = '#5e6673'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke(); g.setLineDash([]);
    }
  }
  $('#chartTip').textContent = `${new Date(tip.t).toTimeString().slice(0, 5)}  O ${price(tip.o)}  H ${price(tip.h)}  L ${price(tip.l)}  C ${price(tip.c)}  V ${num(tip.v)}`;
  if (S.coin && !S.coin.market?.price) $('#cPrice').textContent = price(last.c);
}
function renderIntervals() {
  fill($('#intervals'), ['1s', '1min', '5min', '15min', '1h', '4h', '1d'].map(iv => h('button', { type: 'button', class: iv === S.interval ? 'on' : '', onclick: () => { S.interval = iv; renderIntervals(); loadCandles(); } }, iv.replace('min', 'm'))));
}

// ---------- trade panel ----------
const presets = () => (localStorage.getItem('aiwb-presets') || '0.01 0.05 0.1 0.5').split(/\s+/).map(Number).filter(v => v > 0).slice(0, 8);
// A Flap agent coin that launched while this wallet still holds curve shares: claim them first.
const claimable = () => Number(S.coin?.claim?.shares) > 0;
function renderTrade() {
  const buy = S.side === 'buy', c = S.coin, signed = S.state?.signedIn, claim = claimable();
  $('#claimBox').hidden = !claim;
  $('#claimGo').disabled = !!S.busy;
  document.querySelectorAll('#side button').forEach(b => b.classList.toggle('on', b.dataset.side === S.side));
  $('#buyBox').hidden = !buy; $('#sellBox').hidden = buy;
  fill($('#presets'), presets().map(v => h('button', { type: 'button', class: Number($('#amt').value) === v ? 'on' : '', onclick: () => { $('#amt').value = v; renderTrade(); } }, String(v))),
    h('button', { type: 'button', class: 'edit', onclick: editPresets }, t('editPresets')));
  fill($('#sellPresets'), [25, 50, 75, 100].map(p => h('button', { type: 'button', class: S.sellPct === p ? 'on' : '', onclick: () => { S.sellPct = p; renderTrade(); } }, `${p}%`)));
  $('#bal').textContent = signed && S.state.bnb != null ? t('balance', { v: bnb(S.state.bnb) }) : '';
  $('#held').textContent = c?.held != null && Number(c.held) > 0 ? t('held', { v: `${num(Number(c.held))} ${c.symbol || ''}` }) : c ? t('holdNone') : '';
  if (!$('#slip').value && S.state?.cfg?.slippagePct != null) $('#slip').placeholder = String(S.state.cfg.slippagePct);
  const go = $('#go');
  go.className = 'go ' + (buy ? 'buy' : 'sell');
  const amt = Number($('#amt').value);
  if (!signed) { go.textContent = t('signInFirst'); go.disabled = false; return; }
  if (buy) { go.textContent = amt > 0 ? t('buyBtn', { v: amt }) : t('buyEnter'); go.disabled = !S.ca || !(amt > 0) || !!S.busy; }
  else { go.textContent = S.sellPct ? t('sellBtn', { v: S.sellPct }) : t('sellPick'); go.disabled = !S.ca || !S.sellPct || !!S.busy; }
}
function editPresets() {
  const v = prompt(t('presetsPrompt'), presets().join(' '));
  if (v == null) return;
  const list = v.split(/[\s,]+/).map(Number).filter(x => x > 0);
  if (list.length) localStorage.setItem('aiwb-presets', list.join(' '));
  renderTrade();
}
function onGo() {
  if (!S.state?.signedIn) return showLogin(true);
  if (S.side === 'buy') runTrade('buy', { ca: S.ca, bnb: Number($('#amt').value) });
  else runTrade('sell', { ca: S.ca, percent: S.sellPct });
}

// One trade at a time. The answer comes from the request or, if the browser drops a long wait, from the event stream.
let jobN = 0, countdown;
function runTrade(kind, body) {
  if (S.busy) return;
  const job = `${Date.now()}-${++jobN}`;
  const slip = Number($('#slip').value);
  S.busy = { job, kind, ca: body.ca, sym: S.coin?.token === body.ca ? S.coin.symbol : null, t0: Date.now(), app: null };
  renderStatus(); renderTrade();
  api(`/api/${kind}`, { ...body, job, slippagePct: slip > 0 ? slip : undefined }).then(r => finish(job, { ok: true, result: r }), e => finish(job, { ok: false, error: e.message }));
}
function finish(job, out) {
  if (!S.busy || S.busy.job !== job) return;
  const b = S.busy; S.busy = null; clearInterval(countdown);
  renderResult(b, out); renderTrade();
  if (S.view !== 'coin') toast(out.ok ? (b.kind === 'buy' ? t('quickDone', { sym: b.sym || short(b.ca) }) : t('stOk')) : errText(String(out.error || '')));
  loadState(true); loadHoldings(); loadJournal();
  if (S.ca) loadCoin(S.ca);
}
function renderStatus() {
  const b = S.busy, el = $('#status');
  if (!b) return;
  if (b.app) {
    const left = Math.max(0, Math.round((b.app.at + b.app.waitSec * 1000 - Date.now()) / 1000));
    const label = lang === 'zh' ? ({ buy: '买入', sell: '卖出', approval: '授权', transaction: '交易' }[b.app.label] || b.app.label) : b.app.label;
    return fill(el, h('div', { class: 'appwait', role: 'alert' }, h('span', { class: 'phone', 'aria-hidden': 'true' }), h('b', {}, t('appTitle')),
      h('span', {}, t('appBody', { label }), ' ', t('appLeft', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') }))));
  }
  const s = Math.floor((Date.now() - b.t0) / 1000);
  fill(el, h('p', { class: 'step' }, h('b', {}, `${t('sending')}… ${s}s`), h('br'), t('sendingSub')));
}
function renderResult(b, out) {
  const el = $('#status');
  if (!out.ok) return fill(el, h('div', { class: 'result err', title: out.error }, errText(out.error)));
  const r = out.result, sym = r.symbol || b.sym || '';
  const line = r.kind === 'claim' ? t('claimed') : r.kind === 'sell' ? t('sold', { t: num(Number(r.tokens)), sym, b: bnb(r.bnb) }) : t('bought', { t: num(Number(r.tokens)), sym, b: bnb(r.bnb) });
  fill(el, h('div', { class: 'result ok' }, h('div', {}, line), r.ms ? h('div', { class: 'hint' }, t('inSec', { s: (r.ms / 1000).toFixed(1) })) : null,
    r.hash ? h('a', { href: scan('tx', r.hash), target: '_blank', rel: 'noopener noreferrer' }, t('viewTx')) : null,
    (r.warnings || []).length ? h('ul', { class: 'flags' }, r.warnings.map(w => h('li', { class: 'warn' }, w))) : null));
}

// ---------- bottom tabs ----------
async function loadHoldings() { if (!S.state?.signedIn) return; try { S.holdings = await api('/api/holdings'); renderHoldings(); } catch { /* keep */ } }
async function loadJournal() { try { S.journal = await api('/api/journal'); renderJournal(); } catch { /* keep */ } }
async function loadSnipes() { try { S.snipes = await api('/api/snipes'); renderSnipes(); } catch { /* keep */ } }
function coinCell(token, symbol, icon) {
  return h('button', { class: 'ca', type: 'button', onclick: () => openCoin(token) }, icon ? h('img', { src: icon, width: 16, height: 16, alt: '', class: 'ic' }) : null, ' ', symbol || short(token));
}
function renderHoldings() {
  const el = $('#tab-holdings');
  if (!S.holdings.length) return fill(el, h('p', { class: 'hint' }, t('noHoldings')));
  fill(el, h('table', {}, h('thead', {}, h('tr', {}, [t('colCoin'), t('colHeld'), t('colValue'), t('colCost'), t('colPnl'), ''].map(x => h('th', {}, x)))),
    h('tbody', {}, S.holdings.map(p => h('tr', {},
      h('td', {}, coinCell(p.token, p.symbol, p.icon)), h('td', {}, num(p.held)), h('td', {}, usd(p.valueUsd)),
      h('td', {}, `${bnb(p.boughtBnb)} BNB`), h('td', { class: p.realizedBnb > 0 ? 'up' : p.realizedBnb < 0 ? 'down' : '' }, p.soldTokens ? `${bnb(p.realizedBnb)} BNB` : '–'),
      h('td', {}, Number(p.claim?.shares) > 0 ? h('button', { class: 'mini', type: 'button', disabled: !!S.busy, onclick: () => { openCoin(p.token, { keepPane: true }); runTrade('claim', { ca: p.token }); } }, t('claimBtn')) : [50, 100].map(pct => h('button', { class: 'mini s', type: 'button', disabled: !!S.busy, onclick: () => { openCoin(p.token, { keepPane: true }); runTrade('sell', { ca: p.token, percent: pct }); } }, `${t('sell')} ${pct}%`))),
    )))));
}
function renderJournal() {
  const el = $('#tab-trades');
  const rows = S.journal.filter(e => ['buy', 'sell', 'claim', 'call', 'transfer'].includes(e.kind)).slice(0, 60);
  if (!rows.length) return fill(el, h('p', { class: 'hint' }, t('noTrades')));
  const side = k => t({ buy: 'sideBuy', sell: 'sideSell', claim: 'sideClaim', call: 'sideCall', transfer: 'sideSend' }[k]);
  const st = s => t(s === 'ok' ? 'stOk' : s === 'not_sent' ? 'stNotSent' : 'stFail');
  fill(el, h('table', {}, h('thead', {}, h('tr', {}, [t('colTime'), t('colSide'), t('colCoin'), t('colBnb'), t('colAmt'), t('colStatus'), t('colTx')].map(x => h('th', {}, x)))),
    h('tbody', {}, rows.map(e => h('tr', {},
      h('td', {}, new Date(e.at).toLocaleString()), h('td', { class: e.kind === 'buy' ? 'up' : e.kind === 'sell' ? 'down' : '' }, side(e.kind)),
      h('td', {}, e.token ? coinCell(e.token, e.symbol) : short(e.to)), h('td', {}, e.bnb != null ? bnb(e.bnb) : '–'), h('td', {}, e.tokens != null ? num(Number(e.tokens)) : '–'),
      h('td', { title: e.error || '' }, st(e.status)), h('td', {}, e.hash ? h('a', { href: scan('tx', e.hash), target: '_blank', rel: 'noopener noreferrer' }, short(e.hash)) : '–'),
    )))));
}
function renderSnipes() {
  const sn = S.snipes;
  if (!sn) return;
  const list = $('#snipeList');
  fill(list, sn.warning ? h('p', { class: 'warn' }, lang === 'zh' ? T.zh.feedNote : sn.warning) : null,
    !sn.list.length ? h('p', { class: 'hint' }, t('noSnipes')) : h('table', {}, h('tbody', {}, sn.list.slice().reverse().map(s => h('tr', {},
      h('td', {}, s.kind === 'token' ? coinCell(s.token, short(s.token)) : (s.platforms || []).map(p => PADS[p] || (p === 'all' ? t('allPads') : p)).join(', ')),
      h('td', {}, t('snipeSummary', { bnb: s.bnb, n: s.maxCoins, cap: s.dailyCapBnb, tax: s.maxTaxPct }) + (s.words ? `, "${s.words.join(', ')}"` : '')),
      h('td', {}, `${(s.bought || []).length} / ${s.maxCoins}`),
      h('td', { class: s.active ? 'up' : '' }, s.active ? t('snipeOn') : t('snipeOff')),
      h('td', {}, s.active ? h('button', { class: 'mini s', type: 'button', onclick: () => stopSnipe(s.id) }, t('stop')) : null),
    )))));
  $('#snipeLog').textContent = sn.log.slice(-40).map(l => `${new Date(l.at).toLocaleTimeString()}  ${l.text}`).join('\n');
}
async function loadSettings() { try { S.settings = await api('/api/settings'); renderSettings(); } catch { /* keep */ } }
function renderSettings() {
  const st = S.settings;
  if (!st) return;
  const f = $('#autoForm');
  if (document.activeElement !== f.autoSendTo) f.autoSendTo.value = st.autoSendTo || '';
  for (const k of ['autoSendFlap', 'autoSendFour', 'autoSendGang', 'autoClaimFlap']) {
    f[k].checked = !!st[k];
    f[k].closest('label').title = st[k] ? t('autoOnSince', { t: new Date(st[k]).toLocaleString() }) : '';
  }
  $('#gmgnState').textContent = st.gmgnKey ? t('gmgnSet') : t('gmgnUnset');
  $('#gmgnClear').hidden = !st.gmgnKey;
  const names = T[lang].autoSt;
  fill($('#autoList'), !st.coins.length ? h('p', { class: 'hint' }, t('autoNone')) : h('table', {}, h('tbody', {}, st.coins.slice().reverse().map(c => h('tr', {},
    h('td', {}, coinCell(c.coin, short(c.coin))), h('td', {}, PADS[c.platform] || c.platform), h('td', { class: c.status === 'sent' ? 'up' : c.status === 'failed' ? 'down' : '', title: c.error || '' }, names[c.status] || c.status),
    h('td', {}, c.tokens ? num(Number(c.tokens)) : ''), h('td', {}, c.hash ? h('a', { href: scan('tx', c.hash), target: '_blank', rel: 'noopener noreferrer' }, short(c.hash)) : ''),
  )))));
  $('#autoLog').textContent = st.log.slice(-30).map(l => `${new Date(l.at).toLocaleTimeString()}  ${l.text}`).join('\n');
}
async function saveSettings(e) {
  e.preventDefault();
  const f = e.target, b = { autoSendTo: f.autoSendTo.value.trim() };
  for (const k of ['autoSendFlap', 'autoSendFour', 'autoSendGang', 'autoClaimFlap']) b[k] = f[k].checked;
  if (f.gmgnKey.value.trim()) b.gmgnKey = f.gmgnKey.value.trim();
  try { S.settings = await api('/api/settings', b); f.gmgnKey.value = ''; renderSettings(); toast(t('autoSaved')); if (S.ca) { loadCandles(); loadGmgn(S.ca); } }
  catch (err) { toast(errText(err.message)); loadSettings(); }
}
async function clearGmgn() {
  try { S.settings = await api('/api/settings', { gmgnKey: '' }); renderSettings(); S.gm = null; renderGmgn(); if (S.ca) loadCandles(); } catch (err) { toast(errText(err.message)); }
}
async function stopSnipe(id) { try { await api('/api/snipes/stop', { id }); loadSnipes(); } catch (e) { toast(e.message); } }
async function addSnipeForm(e) {
  e.preventDefault();
  const f = new FormData(e.target), b = Object.fromEntries(f.entries());
  try { await api('/api/snipes', b); toast(t('snipeAdded')); e.target.reset(); syncSnipeForm(); loadSnipes(); } catch (err) { toast(err.message); }
}
function syncSnipeForm() {
  const f = $('#snipeForm'), token = f.kind.value === 'token';
  f.ca.hidden = !token; f.ca.required = token;
  f.platform.hidden = token; f.count.hidden = token; f.count.required = !token; f.name.hidden = token;
}

// ---------- layout ----------
function mobilePane(p) {
  document.querySelectorAll('.pane').forEach(el => el.classList.toggle('on', el.id === `pane-${p}`));
  document.querySelectorAll('#mtabs button').forEach(b => b.classList.toggle('on', b.dataset.pane === p));
}
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#btabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('on', el.id === `tab-${tab}`));
  if (tab === 'snipes') loadSnipes();
  if (tab === 'auto') loadSettings();
}
function renderAll() {
  renderWallet(); renderNotes(); renderBoard(); renderCoin(); renderCheck(); renderIntervals(); renderTrade(); renderHoldings(); renderJournal(); renderSnipes(); renderSettings(); renderGmgn();
  if (!$('#login').hidden) renderLogin();
  if (S.busy) renderStatus();
  drawChart();
}

// ---------- events from aiwb ----------
function listen() {
  const es = new EventSource(`/api/events?k=${KEY}`);
  es.addEventListener('trench', e => {
    for (const it of JSON.parse(e.data)) {
      if (it.removed) { S.board.delete(it.id); continue; }
      if (!S.board.has(it.id) && S.boardReady) it.fresh = true;
      S.board.set(it.id, it);
    }
    renderBoard();
  });
  es.addEventListener('app', e => {
    const a = JSON.parse(e.data);
    if (!S.busy) return;
    S.busy.app = a; setView('coin'); renderStatus(); mobilePane('trade'); // the App card must be seen
    clearInterval(countdown); countdown = setInterval(renderStatus, 1000);
  });
  es.addEventListener('trade', e => { const r = JSON.parse(e.data); if (r.job) finish(r.job, r); });
  es.addEventListener('login', e => { const r = JSON.parse(e.data); if (r.ok) signedIn(); else { S.login = { error: t('loginFail', { e: r.error }) }; renderLogin(); } });
  es.addEventListener('autosend', e => { if (!S.settings) return; S.settings.log.push(JSON.parse(e.data)); loadSettings(); loadJournal(); loadHoldings(); });
  es.addEventListener('snipe', e => { if (!S.snipes) return; S.snipes.log.push(JSON.parse(e.data)); renderSnipes(); loadJournal(); });
}

// ---------- start ----------
function wire() {
  $('#lang').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; localStorage.setItem('aiwb-lang', lang); applyLang(); });
  $('#search').addEventListener('submit', e => { e.preventDefault(); openCoin($('#ca').value); });
  $('#ca').addEventListener('paste', () => setTimeout(() => { const v = $('#ca').value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(v)) openCoin(v); }, 0));
  $('#views').addEventListener('click', e => { const v = e.target.closest('button')?.dataset.view; if (v) setView(v); });
  $('#ttabs').addEventListener('click', e => { const c = e.target.closest('button')?.dataset.col; if (c) { S.col = c; renderBoard(); } });
  document.querySelectorAll('#quick3 input').forEach((el, i) => {
    el.value = quick3()[i];
    el.addEventListener('input', () => { const q = quick3(); q[i] = el.value.trim(); localStorage.setItem('aiwb-quick3', JSON.stringify(q)); renderBoard(); });
  });
  $('#cCa').addEventListener('click', () => navigator.clipboard?.writeText(S.ca).then(() => toast(t('copied'))));
  $('#side').addEventListener('click', e => { const s = e.target.dataset?.side; if (s) { S.side = s; renderTrade(); } });
  $('#amt').addEventListener('input', renderTrade);
  $('#go').addEventListener('click', onGo);
  $('#claimGo').addEventListener('click', () => (S.state?.signedIn ? runTrade('claim', { ca: S.coin.claim.market }) : showLogin(true)));
  $('#mtabs').addEventListener('click', e => { const p = e.target.dataset?.pane; if (p) { mobilePane(p); if (p === 'coin') drawChart(); } });
  $('#btabs').addEventListener('click', e => { const tab = e.target.dataset?.tab; if (tab) setTab(tab); });
  $('#snipeForm').addEventListener('submit', addSnipeForm);
  $('#autoForm').addEventListener('submit', saveSettings);
  $('#gmgnClear').addEventListener('click', clearGmgn);
  $('#snipeForm').kind.addEventListener('change', syncSnipeForm);
  $('#loginBtn').addEventListener('click', startLogin);
  const chart = cv();
  chart.addEventListener('mousemove', e => { hover = e.clientX - chart.getBoundingClientRect().left; drawChart(); });
  chart.addEventListener('mouseleave', () => { hover = null; drawChart(); });
  window.addEventListener('resize', () => drawChart());
}

async function main() {
  buildBoard(); wire(); syncSnipeForm(); applyLang();
  if (!KEY) { layout(); fill($('#notes'), h('p', {}, t('noKey'))); $('#notes').hidden = false; return; }
  listen();
  const st = await loadState();
  if (st.signedIn) showLogin(false);
  else {
    showLogin(true);
    const card = $('.login-card');
    if (!card.querySelector('.skip')) card.append(h('button', { class: 'ghost skip', type: 'button', 'data-i18n': 'loginSkip', onclick: () => showLogin(false) }, t('loginSkip')));
  }
  api('/api/trenches').then(b => { for (const it of b.items) if (!S.board.has(it.id)) S.board.set(it.id, it); S.boardReady = true; renderBoard(); }).catch(() => {});
  loadHoldings(); loadJournal(); loadSnipes(); loadSettings();
  setInterval(tickAges, 1000);
  setInterval(() => { if (document.hidden || !S.ca) return; loadCandles(); }, 4000);
  setInterval(() => { if (document.hidden || !S.ca || S.busy) return; loadCoin(S.ca); }, 15000);
  setInterval(() => { if (!document.hidden) loadState(); }, 30000);
}
main();
