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
    searchPh: 'Paste a contract address', newCoins: 'New agent coins', newShort: 'New coins', coin: 'Coin', trade: 'Trade', quickBuy: 'Quick buy', all: 'All',
    emptyTitle: 'Paste a coin to trade it', emptyBody: 'Paste a contract address above, or pick one from the new agent coins. Buys and sells go through your Binance AI wallet; Binance signs every one.',
    noChart: 'No chart yet. Binance has not indexed this coin.', buy: 'Buy', sell: 'Sell', amount: 'Amount', slippage: 'Slippage',
    agentWarn: 'Agent-only curve: Binance may refuse to let an AI wallet sell this until it graduates to PancakeSwap. Only buy what you can afford to hold.',
    appWarn: 'Binance screens this coin as risky: every sale needs a tap in the Binance App. Keep your phone at hand.',
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
    bought: 'Bought {t} {sym} for {b} BNB', sold: 'Sold {t} {sym} for {b} BNB', inSec: 'in {s} s', viewTx: 'View on bscscan',
    checking: 'Checking this coin', vOk: 'No red flags', vCareful: 'Careful', vNo: 'Do not buy', trip: 'Buy and sell back 0.001 BNB: {p}% returns',
    noHoldings: 'Nothing held yet. Coins you buy here or with aiwb show up here.', noTrades: 'No trades yet.', noSnipes: 'No snipes set.',
    colCoin: 'Coin', colHeld: 'Held', colValue: 'Value', colCost: 'Cost', colPnl: 'Realized', colTime: 'Time', colSide: 'Side', colBnb: 'BNB', colAmt: 'Amount', colStatus: 'Status', colTx: 'Tx',
    sideBuy: 'Buy', sideSell: 'Sell', sideClaim: 'Claim', sideCall: 'Call', stOk: 'Done', stFail: 'Failed', stNotSent: 'Not sent',
    snipeOn: 'Running', snipeOff: 'Stopped', stop: 'Stop', snipeAdded: 'Snipe added', snipeSummary: '{bnb} BNB each, at most {n}, {cap} BNB a day, tax up to {tax}%',
    quickSet: 'Set a quick buy amount first', quickSending: 'Buying {sym} with {v} BNB', feedEmpty: 'Watching the launchpads. New coins appear here the moment they are created.',
    feedNote: 'New agent coins: Binance may not let an AI wallet sell them before they graduate.',
    noteDev: 'Developer mode is off, so contract trades will fail. Turn it on in the Binance App, AI wallet settings.',
    noteAgent: 'This wallet has no Agent ID, so it cannot buy agent-only coins. Claim a .ai name in the Binance App.',
    noteRisk: 'Risky transactions are set to auto-reject, so Binance refuses some sales. In the Binance App, AI wallet settings, set it to confirm in the App.',
    noteSession: 'Your sign-in ends in {h} hours. Sign in again after that.',
    ago: '{v}s', agoM: '{v}m', agoH: '{v}h', claim: 'Claim',
  },
  zh: {
    searchPh: '粘贴合约地址', newCoins: '新 Agent 币', newShort: '新币', coin: '币', trade: '交易', quickBuy: '快买', all: '全部',
    emptyTitle: '粘贴一个币就能交易', emptyBody: '在上面粘贴合约地址，或者从新 Agent 币里点一个。买卖都走你自己的币安 AI 钱包，每一笔都由币安签名。',
    noChart: '暂时没有 K 线，币安还没收录这个币。', buy: '买入', sell: '卖出', amount: '数量', slippage: '滑点',
    agentWarn: 'Agent 专属内盘：毕业到 PancakeSwap 之前，币安可能不让 AI 钱包卖出。只买你拿得住的量。',
    appWarn: '币安把这个币标成有风险：每次卖出都要在币安 App 里点确认，手机放旁边。',
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
    bought: '用 {b} BNB 买到 {t} {sym}', sold: '卖出 {t} {sym}，拿回 {b} BNB', inSec: '用时 {s} 秒', viewTx: '在 bscscan 查看',
    checking: '正在检查这个币', vOk: '没发现问题', vCareful: '小心', vNo: '别买', trip: '模拟买入再卖出 0.001 BNB：拿回 {p}%',
    noHoldings: '还没有持仓。在这里或用 aiwb 买的币会显示在这里。', noTrades: '还没有成交。', noSnipes: '还没设狙击。',
    colCoin: '币', colHeld: '持有', colValue: '价值', colCost: '成本', colPnl: '已实现盈亏', colTime: '时间', colSide: '方向', colBnb: 'BNB', colAmt: '数量', colStatus: '状态', colTx: '交易',
    sideBuy: '买', sideSell: '卖', sideClaim: '领取', sideCall: '调用', stOk: '成功', stFail: '失败', stNotSent: '没发出',
    snipeOn: '运行中', snipeOff: '已停', stop: '停止', snipeAdded: '狙击已添加', snipeSummary: '每个 {bnb} BNB，最多 {n} 个，每天最多 {cap} BNB，买税不超过 {tax}%',
    quickSet: '先填快买金额', quickSending: '正在用 {v} BNB 买 {sym}', feedEmpty: '正在盯发射台，新币一创建就会出现在这里。',
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
};
const flagText = f => (lang === 'zh' && f.key && FLAGS_ZH[f.key] ? FLAGS_ZH[f.key].replace(/\{(\w+)\}/g, (_, v) => f.vars?.[v] ?? '') : f.text);
// The errors people meet most often, in Chinese; anything else is shown as aiwb wrote it.
const ERRORS_ZH = [
  [/too risky/i, '币安风控判定这笔交易风险太高，没有发出。到币安 App 的 AI 钱包设置里，把“异常交易处理”改成在 App 内确认，之后这类交易会推到 App 让你确认。'],
  [/Not confirmed in the Binance App/i, '10 分钟内没在币安 App 里确认。之后再确认也会成交：再试之前先看成交记录或 bscscan。'],
  [/less than .* Top it up/i, 'AI 钱包的 BNB 不够，到币安 App 里充值。没有发出任何交易。'],
  [/holds no /i, '这个钱包没有这个币，没有发出任何交易。'],
  [/Agent ID/i, '这个币只卖给带币安 Agent ID（.ai 名字）的钱包。先到币安 App 给这个钱包领一个。没有发出任何交易。'],
  [/daily limit|daily cap/i, '已到每日上限，没有发出。'],
  [/not signed in|sign in|login/i, '需要先登录币安 AI 钱包。'],
];
const errText = m => { if (lang !== 'zh') return m; const hit = ERRORS_ZH.find(([re]) => re.test(m)); return hit ? hit[1] : m; };

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
const PADS = { 'four-agent': 'Four', 'flap-agent': 'Flap Agent', gang: 'GANG', flap: 'Flap', 'pancake-v2': 'PancakeSwap', 'self-curve': 'Agent curve' };

// ---------- state ----------
const S = {
  state: null, feed: [], feedFilter: 'all', ca: null, coin: null, check: null, candles: [], interval: '1min',
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
  $('#app').hidden = on;
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

// ---------- new coins ----------
function renderFeed() {
  const el = $('#feed');
  const list = S.feed.filter(c => S.feedFilter === 'all' || c.platform === S.feedFilter);
  if (!list.length) return fill(el, h('li', { class: 'feed-empty' }, t('feedEmpty')));
  fill(el, list.slice(0, 60).map(c => h('li', { class: [c.token === S.ca ? 'cur' : '', c.fresh ? 'fresh' : ''].join(' '), 'data-ca': c.token, onclick: () => openCoin(c.token) },
    h('span', { class: 'sym' }, c.symbol || short(c.token)),
    h('button', { class: 'qb', type: 'button', onclick: e => { e.stopPropagation(); quickBuy(c); } }, t('buy')),
    h('span', { class: 'sub' }, h('span', { class: 'age', 'data-seen': c.seen }, ago(c.seen)), h('span', {}, PADS[c.platform] || c.platform), h('span', {}, c.name && c.name !== c.symbol ? c.name.slice(0, 24) : '')),
  )));
  list.forEach(c => { c.fresh = false; });
}
function tickAges() { document.querySelectorAll('[data-seen]').forEach(el => { el.textContent = ago(Number(el.dataset.seen)); }); }
async function quickBuy(c) {
  const v = Number($('#quickAmt').value);
  if (!(v > 0)) { toast(t('quickSet')); $('#quickAmt').focus(); return; }
  if (!S.state?.signedIn) return showLogin(true);
  openCoin(c.token, { keepPane: true });
  toast(t('quickSending', { v, sym: c.symbol || short(c.token) }));
  runTrade('buy', { ca: c.token, bnb: v });
}

// ---------- coin ----------
function openCoin(ca, { keepPane } = {}) {
  ca = ca.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) { toast(lang === 'zh' ? '这不是合约地址（0x 开头，40 位）' : 'That is not a contract address (0x and 40 characters).'); return; }
  if (S.ca?.toLowerCase() !== ca.toLowerCase()) { S.coin = null; S.check = null; S.candles = []; S.sellPct = null; }
  S.ca = ca;
  $('#ca').value = ca;
  if (!keepPane) mobilePane('coin');
  renderFeed(); renderCoin(); renderTrade();
  loadCoin(ca); loadCandles(); loadCheck(ca);
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
  try { const v = await api(`/api/candles?ca=${ca}&interval=${S.interval}`); if (S.ca === ca) { S.candles = v; drawChart(); } } catch { /* keep the last chart */ }
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
function renderTrade() {
  const buy = S.side === 'buy', c = S.coin, signed = S.state?.signedIn;
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
  const line = r.kind === 'sell' ? t('sold', { t: num(Number(r.tokens)), sym, b: bnb(r.bnb) }) : t('bought', { t: num(Number(r.tokens)), sym, b: bnb(r.bnb) });
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
      h('td', {}, [50, 100].map(pct => h('button', { class: 'mini s', type: 'button', disabled: !!S.busy, onclick: () => { openCoin(p.token, { keepPane: true }); runTrade('sell', { ca: p.token, percent: pct }); } }, `${t('sell')} ${pct}%`))),
    )))));
}
function renderJournal() {
  const el = $('#tab-trades');
  const rows = S.journal.filter(e => ['buy', 'sell', 'claim', 'call'].includes(e.kind)).slice(0, 60);
  if (!rows.length) return fill(el, h('p', { class: 'hint' }, t('noTrades')));
  const side = k => t({ buy: 'sideBuy', sell: 'sideSell', claim: 'sideClaim', call: 'sideCall' }[k]);
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
}
function renderAll() {
  renderWallet(); renderNotes(); renderFeed(); renderCoin(); renderCheck(); renderIntervals(); renderTrade(); renderHoldings(); renderJournal(); renderSnipes();
  if (!$('#login').hidden) renderLogin();
  if (S.busy) renderStatus();
  drawChart();
}

// ---------- events from aiwb ----------
function listen() {
  const es = new EventSource(`/api/events?k=${KEY}`);
  es.addEventListener('coin', e => { const c = JSON.parse(e.data); if (S.feed.some(x => x.token === c.token)) return; c.fresh = true; S.feed.unshift(c); S.feed.sort((a, b) => b.block - a.block); S.feed.length = Math.min(S.feed.length, 80); renderFeed(); });
  es.addEventListener('app', e => {
    const a = JSON.parse(e.data);
    if (!S.busy) return;
    S.busy.app = a; renderStatus(); mobilePane('trade');
    clearInterval(countdown); countdown = setInterval(renderStatus, 1000);
  });
  es.addEventListener('trade', e => { const r = JSON.parse(e.data); if (r.job) finish(r.job, r); });
  es.addEventListener('login', e => { const r = JSON.parse(e.data); if (r.ok) signedIn(); else { S.login = { error: t('loginFail', { e: r.error }) }; renderLogin(); } });
  es.addEventListener('snipe', e => { if (!S.snipes) return; S.snipes.log.push(JSON.parse(e.data)); renderSnipes(); loadJournal(); });
}

// ---------- start ----------
function wire() {
  $('#lang').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; localStorage.setItem('aiwb-lang', lang); applyLang(); });
  $('#search').addEventListener('submit', e => { e.preventDefault(); openCoin($('#ca').value); });
  $('#ca').addEventListener('paste', () => setTimeout(() => { const v = $('#ca').value.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(v)) openCoin(v); }, 0));
  $('#feedFilter').addEventListener('click', e => { const p = e.target.dataset?.p; if (!p) return; S.feedFilter = p; document.querySelectorAll('#feedFilter button').forEach(b => b.classList.toggle('on', b.dataset.p === p)); renderFeed(); });
  $('#quickAmt').value = localStorage.getItem('aiwb-quick') || '';
  $('#quickAmt').addEventListener('input', e => localStorage.setItem('aiwb-quick', e.target.value));
  $('#cCa').addEventListener('click', () => navigator.clipboard?.writeText(S.ca).then(() => toast(t('copied'))));
  $('#side').addEventListener('click', e => { const s = e.target.dataset?.side; if (s) { S.side = s; renderTrade(); } });
  $('#amt').addEventListener('input', renderTrade);
  $('#go').addEventListener('click', onGo);
  $('#mtabs').addEventListener('click', e => { const p = e.target.dataset?.pane; if (p) { mobilePane(p); if (p === 'coin') drawChart(); } });
  $('#btabs').addEventListener('click', e => { const tab = e.target.dataset?.tab; if (tab) setTab(tab); });
  $('#snipeForm').addEventListener('submit', addSnipeForm);
  $('#snipeForm').kind.addEventListener('change', syncSnipeForm);
  $('#loginBtn').addEventListener('click', startLogin);
  const chart = cv();
  chart.addEventListener('mousemove', e => { hover = e.clientX - chart.getBoundingClientRect().left; drawChart(); });
  chart.addEventListener('mouseleave', () => { hover = null; drawChart(); });
  window.addEventListener('resize', () => drawChart());
}

async function main() {
  wire(); syncSnipeForm(); applyLang();
  if (!KEY) { $('#app').hidden = true; fill($('#notes'), h('p', {}, t('noKey'))); $('#notes').hidden = false; return; }
  listen();
  const st = await loadState();
  if (st.signedIn) showLogin(false);
  else {
    showLogin(true);
    const card = $('.login-card');
    if (!card.querySelector('.skip')) card.append(h('button', { class: 'ghost skip', type: 'button', 'data-i18n': 'loginSkip', onclick: () => showLogin(false) }, t('loginSkip')));
  }
  api('/api/feed').then(f => { S.feed = f; renderFeed(); }).catch(() => {});
  loadHoldings(); loadJournal(); loadSnipes();
  setInterval(tickAges, 1000);
  setInterval(() => { if (document.hidden || !S.ca) return; loadCandles(); }, 4000);
  setInterval(() => { if (document.hidden || !S.ca || S.busy) return; loadCoin(S.ca); }, 15000);
  setInterval(() => { if (!document.hidden) loadState(); }, 30000);
}
main();
