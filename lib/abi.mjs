// Minimal ABI encoding/decoding and keccak-256, so the package has no dependencies to audit.
// Covers what the trading calls need: address, bool, uintN/intN, bytesN, bytes, string, static and dynamic arrays,
// and tuples, in calldata and in return data.

// ---------- keccak-256 (Ethereum's pre-standard Keccak, not SHA3-256) ----------
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function permute(s) {
  for (let r = 0; r < 24; r++) {
    const c = [0, 1, 2, 3, 4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    const b = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) s[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & M64 & b[((x + 2) % 5) + y]);
    s[0] ^= RC[r];
  }
}

export function keccak256(input) {
  const bytes = typeof input === 'string' ? (input.startsWith('0x') ? hexToBytes(input) : new TextEncoder().encode(input)) : input;
  const rate = 136, s = new Array(25).fill(0n);
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let w = 0n;
      for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(padded[off + i * 8 + j]);
      s[i] ^= w;
    }
    permute(s);
  }
  let out = '0x';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out += Number((s[i] >> BigInt(8 * j)) & 0xffn).toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(h) {
  const s = h.replace(/^0x/, '');
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error(`bad hex: ${h.slice(0, 20)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------- type parsing ----------
// "transfer(address,uint256)" -> { name, inputs: ['address','uint256'] }; nested tuples as "(address,uint256)".
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function parseSig(sig) {
  const m = sig.trim().match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)$/s);
  if (!m) throw new Error(`bad function signature: ${sig}`);
  return { name: m[1], inputs: splitTop(m[2]) };
}
const canon = t => {
  t = t.replace(/\s+(memory|calldata|storage|indexed)?\s*\w*$/, '').trim(); // drop param names
  if (t.startsWith('(')) {
    const end = t.lastIndexOf(')');
    return `(${splitTop(t.slice(1, end)).map(canon).join(',')})${t.slice(end + 1)}`;
  }
  return t.replace(/^uint$/, 'uint256').replace(/^int$/, 'int256').replace(/^uint\[/, 'uint256[').replace(/^int\[/, 'int256[');
};
export const canonSig = sig => { const { name, inputs } = parseSig(sig); return `${name}(${inputs.map(canon).join(',')})`; };
export const selector = sig => keccak256(canonSig(sig)).slice(0, 10);
export const topic = sig => keccak256(canonSig(sig));

function arrayOf(t) {
  const m = t.match(/^(.*)\[(\d*)\]$/s);
  return m ? { inner: m[1], len: m[2] === '' ? null : Number(m[2]) } : null;
}
const tupleParts = t => splitTop(t.slice(1, t.lastIndexOf(')')));
function isDynamic(t) {
  if (t === 'bytes' || t === 'string') return true;
  const a = arrayOf(t);
  if (a) return a.len === null || isDynamic(a.inner);
  if (t.startsWith('(')) return tupleParts(t).some(isDynamic);
  return false;
}
function headSize(t) {
  if (isDynamic(t)) return 32;
  const a = arrayOf(t);
  if (a) return a.len * headSize(a.inner);
  if (t.startsWith('(')) return tupleParts(t).reduce((n, p) => n + headSize(p), 0);
  return 32;
}

// ---------- encoding ----------
const word = n => {
  let x = BigInt(n);
  if (x < 0n) x = (1n << 256n) + x;
  if (x < 0n || x >= 1n << 256n) throw new Error(`number out of range: ${n}`);
  return x.toString(16).padStart(64, '0');
};
const padRight = hex => hex + '0'.repeat((64 - (hex.length % 64)) % 64);

function encodeOne(t, v) {
  const a = arrayOf(t);
  if (a) {
    if (!Array.isArray(v)) throw new Error(`expected array for ${t}`);
    if (a.len !== null && v.length !== a.len) throw new Error(`expected ${a.len} items for ${t}`);
    const body = encodeList(v.map(() => a.inner), v);
    return a.len === null ? word(v.length) + body : body;
  }
  if (t.startsWith('(')) {
    const parts = tupleParts(t);
    const vals = Array.isArray(v) ? v : parts.map((_, i) => v[i]);
    return encodeList(parts, vals);
  }
  if (t === 'address') {
    const s = String(v).toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{40}$/.test(s)) throw new Error(`bad address: ${v}`);
    return s.padStart(64, '0');
  }
  if (t === 'bool') return word(v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);
  if (/^u?int\d*$/.test(t)) return word(v);
  if (t === 'bytes' || t === 'string') {
    const hex = t === 'string' ? Buffer.from(String(v), 'utf8').toString('hex') : String(v).replace(/^0x/, '');
    return word(hex.length / 2) + padRight(hex);
  }
  const fb = t.match(/^bytes(\d+)$/);
  if (fb) {
    const hex = String(v).replace(/^0x/, '');
    if (hex.length !== Number(fb[1]) * 2) throw new Error(`expected ${fb[1]} bytes for ${t}`);
    return padRight(hex);
  }
  throw new Error(`unsupported type: ${t}`);
}

function encodeList(types, values) {
  if (types.length !== values.length) throw new Error(`expected ${types.length} values, got ${values.length}`);
  let head = '', tail = '';
  const headLen = types.reduce((n, t) => n + headSize(t), 0);
  types.forEach((t, i) => {
    const enc = encodeOne(t, values[i]);
    if (isDynamic(t)) { head += word(headLen + tail.length / 2); tail += enc; } else head += enc;
  });
  return head + tail;
}

export const encodeArgs = (types, values) => '0x' + encodeList(types.map(canon), values);
export function encodeCall(sig, args = []) {
  const { inputs } = parseSig(sig);
  return selector(sig) + encodeList(inputs.map(canon), args);
}

// ---------- decoding ----------
function decodeOne(t, hex, off) {
  const a = arrayOf(t);
  const at = o => hex.slice(o * 2, o * 2 + 64);
  if (isDynamic(t) && off !== null) return decodeOne(t, hex.slice(Number(BigInt('0x' + at(off))) * 2), null);
  const base = off ?? 0;
  if (a) {
    let n = a.len, start = base;
    if (n === null) { n = Number(BigInt('0x' + at(base))); start = base + 32; }
    return decodeList(Array(n).fill(a.inner), hex.slice(start * 2));
  }
  if (t.startsWith('(')) return decodeList(tupleParts(t), hex.slice(base * 2));
  const w = at(base);
  if (w.length < 64) throw new Error('return data too short');
  if (t === 'address') return '0x' + w.slice(24);
  if (t === 'bool') return BigInt('0x' + w) !== 0n;
  if (/^uint\d*$/.test(t)) return BigInt('0x' + w);
  if (/^int\d*$/.test(t)) { const x = BigInt('0x' + w); return x >= 1n << 255n ? x - (1n << 256n) : x; }
  if (t === 'bytes' || t === 'string') {
    const len = Number(BigInt('0x' + w));
    const body = hex.slice((base + 32) * 2, (base + 32) * 2 + len * 2);
    return t === 'string' ? Buffer.from(body, 'hex').toString('utf8') : '0x' + body;
  }
  const fb = t.match(/^bytes(\d+)$/);
  if (fb) return '0x' + w.slice(0, Number(fb[1]) * 2);
  throw new Error(`unsupported type: ${t}`);
}

function decodeList(types, hex) {
  const out = []; let off = 0;
  for (const t of types) { out.push(decodeOne(t, hex, off)); off += headSize(t); }
  return out;
}

export function decode(types, data) {
  const hex = String(data || '0x').replace(/^0x/, '');
  return decodeList(types.map(canon), hex);
}

// Revert reason from eth_call error data: Error(string), Panic(uint256) or a bare custom-error selector.
export function revertReason(data, known = {}) {
  if (!data || data === '0x') return null;
  if (data.startsWith('0x08c379a0')) { try { return decode(['string'], '0x' + data.slice(10))[0]; } catch { return 'reverted'; } }
  if (data.startsWith('0x4e487b71')) return `panic ${decode(['uint256'], '0x' + data.slice(10))[0]}`;
  return known[data.slice(0, 10)] || `custom error ${data.slice(0, 10)}`;
}

export const checksum = a => {
  const s = String(a).toLowerCase().replace(/^0x/, '');
  const h = keccak256(new TextEncoder().encode(s)).slice(2);
  return '0x' + [...s].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
};
export const isAddress = a => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));
export const ZERO = '0x0000000000000000000000000000000000000000';
export const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
