import { sha256 } from '@noble/hashes/sha2.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function base64Encode(bytes: Uint8Array, url = false): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return url ? out.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') : out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

type Der = { tag: number; start: number; end: number };

function readDer(b: Uint8Array, pos: number): Der {
  const tag = b[pos];
  let len = b[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) throw new Error('RSA_KEY_INVALID');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p++];
  }
  if (tag === undefined || p + len > b.length) throw new Error('RSA_KEY_INVALID');
  return { tag, start: p, end: p + len };
}

function children(b: Uint8Array, d: Der): Der[] {
  const out: Der[] = [];
  let p = d.start;
  while (p < d.end) {
    const c = readDer(b, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function toBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function intOf(b: Uint8Array, d: Der): bigint {
  if (d.tag !== 0x02) throw new Error('RSA_KEY_INVALID');
  return toBig(b.subarray(d.start, d.end));
}

export type RsaKey = { n: bigint; e: bigint; d: bigint; p: bigint; q: bigint; dp: bigint; dq: bigint; qi: bigint; bytes: number };

function pkcs1(b: Uint8Array, seq: Der): RsaKey {
  const f = children(b, seq);
  if (f.length < 9) throw new Error('RSA_KEY_INVALID');
  const [n, e, d, p, q, dp, dq, qi] = f.slice(1, 9).map(x => intOf(b, x));
  return { n, e, d, p, q, dp, dq, qi, bytes: (n.toString(16).length + 1) >> 1 };
}

export function parsePrivateKey(pem: string): RsaKey {
  const body = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '');
  const der = base64Decode(body);
  if (der.length < 64) throw new Error('RSA_KEY_INVALID');
  const top = readDer(der, 0);
  if (top.tag !== 0x30) throw new Error('RSA_KEY_INVALID');
  const f = children(der, top);
  if (f.length >= 3 && f[1].tag === 0x30 && f[2].tag === 0x04) {
    const inner = readDer(der, f[2].start);
    return pkcs1(der, inner);
  }
  return pkcs1(der, top);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    if (e) b = (b * b) % mod;
  }
  return r;
}

const SHA256_PREFIX = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];

export function rs256(key: RsaKey, message: Uint8Array): Uint8Array {
  const hash = sha256(message);
  const t = [...SHA256_PREFIX, ...hash];
  const k = key.bytes;
  if (k < t.length + 11) throw new Error('RSA_KEY_TOO_SHORT');
  const em = new Uint8Array(k);
  em[1] = 1;
  for (let i = 2; i < k - t.length - 1; i++) em[i] = 0xff;
  em.set(t, k - t.length);
  const m = toBig(em);
  const m1 = modPow(m, key.dp, key.p);
  const m2 = modPow(m, key.dq, key.q);
  let h = ((m1 - m2) * key.qi) % key.p;
  if (h < 0n) h += key.p;
  const s = m2 + h * key.q;
  if (modPow(s, key.e, key.n) !== m) throw new Error('RSA_SIGN_FAILED');
  const out = new Uint8Array(k);
  let v = s;
  for (let i = k - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function signJwt(pem: string, header: Record<string, unknown>, claims: Record<string, unknown>): string {
  const key = parsePrivateKey(pem);
  const head = base64Encode(utf8(JSON.stringify(header)), true);
  const body = base64Encode(utf8(JSON.stringify(claims)), true);
  const input = `${head}.${body}`;
  return `${input}.${base64Encode(rs256(key, utf8(input)), true)}`;
}
