import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { fail, signHex } from './util';

const ITERATIONS = 20000;

export function cleanUsername(raw: string) {
  const u = raw.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(u)) fail('INVALID_USERNAME');
  return u;
}

export function checkPassword(p: string) {
  if ([...p].length < 10) fail('PASSWORD_TOO_SHORT');
  if ([...p].length > 128) fail('PASSWORD_TOO_LONG');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fail('PASSWORD_TOO_WEAK');
}

export function hashPassword(secret: string, password: string, seed: string) {
  const salt = signHex(secret, `pw-salt|${seed}`).slice(0, 32);
  const hash = bytesToHex(pbkdf2(sha256, utf8ToBytes(password), utf8ToBytes(salt), { c: ITERATIONS, dkLen: 32 }));
  return ['pbkdf2-sha256', String(ITERATIONS), salt, hash].join('$');
}

export function verifyPassword(stored: string, password: string) {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const got = bytesToHex(pbkdf2(sha256, utf8ToBytes(password), utf8ToBytes(salt), { c: Number(iter), dkLen: 32 }));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (hash.charCodeAt(i) || 0);
  return diff === 0;
}
