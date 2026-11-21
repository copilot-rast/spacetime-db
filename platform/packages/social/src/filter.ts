import { fail } from '@stg/base';
import type { SDb } from './engine';

const DROP = /[ً-ٰٟـۖ-ۭ​-‏‪-‮⁠-⁩­﻿̀-ͯ]/;
const MAP: Record<string, string> = {
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ە': 'ه', 'ھ': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'к': 'k', 'м': 'm', 'т': 't', 'н': 'h', 'в': 'b',
  'α': 'a', 'ο': 'o', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'υ': 'u',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
const LETTER = /[a-z0-9ء-غف-يٮ-ۓۺ-ۿ]/;
const FA_SUFFIX = ['ی', 'ای', 'ها', 'های', 'ان', 'ت', 'ش', 'م', 'مان', 'تان', 'شان', 'تر', 'ترین', 'ه'];
const EN_SUFFIX = ['s', 'es', 'ed', 'er', 'ers', 'ing', 'y', 'ish'];
export const ACTIONS = ['mask', 'block', 'flag'];
export const MATCHES = ['word', 'contains'];

type Ch = { c: string; s: number; e: number; letter: boolean };

function compat(c: string) {
  try {
    return c.normalize('NFKD');
  } catch {
    return c;
  }
}

function digit(c: string) {
  const n = c.charCodeAt(0);
  if (n >= 0x06f0 && n <= 0x06f9) return String(n - 0x06f0);
  if (n >= 0x0660 && n <= 0x0669) return String(n - 0x0660);
  return c;
}

function chars(text: string) {
  const out: Ch[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const raw of compat(text[i])) {
      if (DROP.test(raw)) continue;
      let c = digit(raw).toLowerCase();
      c = MAP[c] ?? c;
      out.push({ c, s: i, e: i + 1, letter: LETTER.test(c) });
    }
  }
  const latin = (i: number) => i >= 0 && i < out.length && /^[a-z]$/.test(out[i].c);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const l = LEET[out[i].c];
      if (l && (latin(i - 1) || latin(i + 1))) {
        out[i] = { ...out[i], c: l, letter: true };
        changed = true;
      }
    }
  }
  const merged: Ch[] = [];
  for (const ch of out) {
    const last = merged[merged.length - 1];
    if (last && ch.letter && last.letter && last.c === ch.c) merged[merged.length - 1] = { ...last, e: ch.e };
    else merged.push(ch);
  }
  return merged;
}

export function normalizeText(text: string) {
  return chars(text).map(c => c.c).join('').replace(/\s+/g, ' ').trim();
}

function splitWord(word: string) {
  const cs = chars(word);
  const parts: string[] = [];
  let cur = '';
  for (const c of cs) {
    if (c.letter) cur += c.c;
    else if (cur) {
      parts.push(cur);
      cur = '';
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export function normalizeWord(word: string) {
  const parts = splitWord(word);
  const n = parts.join(' ');
  if (!n || [...word.trim()].length > 64) fail('INVALID_WORD');
  return n;
}

function withSuffix(token: string, w: string) {
  if (token === w) return true;
  if (!token.startsWith(w)) return false;
  const rest = token.slice(w.length);
  return (/[a-z]/.test(w) ? EN_SUFFIX : FA_SUFFIX).includes(rest);
}

export type WordRow = { id: bigint; word: string; normalized: string; action: string; match: string; isActive: boolean };
export type FilterResult = { text: string; normalized: string; changed: boolean; blocked: boolean; flagged: boolean; masked: boolean; hits: { id: bigint; word: string; action: string }[] };

export function applyFilter(words: WordRow[], text: string, mode = 'rules'): FilterResult {
  const cs = chars(text);
  const tokens: { t: string; a: number; b: number }[] = [];
  let start = -1;
  for (let i = 0; i <= cs.length; i++) {
    const l = i < cs.length && cs[i].letter;
    if (l && start < 0) start = i;
    if (!l && start >= 0) {
      tokens.push({ t: cs.slice(start, i).map(c => c.c).join(''), a: start, b: i - 1 });
      start = -1;
    }
  }
  const letters: number[] = [];
  cs.forEach((c, i) => c.letter && letters.push(i));
  const flat = letters.map(i => cs[i].c).join('');
  const ranges: [number, number][] = [];
  const hits: FilterResult['hits'] = [];
  for (const w of words) {
    if (!w.isActive) continue;
    const parts = w.normalized.split(' ').filter(Boolean);
    if (!parts.length) continue;
    const found: [number, number][] = [];
    if (w.match === 'contains') {
      const needle = parts.join('');
      let from = 0;
      while (needle && from <= flat.length) {
        const at = flat.indexOf(needle, from);
        if (at < 0) break;
        found.push([letters[at], letters[at + needle.length - 1]]);
        from = at + needle.length;
      }
    } else if (parts.length === 1) {
      const p = parts[0];
      for (let i = 0; i < tokens.length; i++) {
        if (withSuffix(tokens[i].t, p)) found.push([tokens[i].a, tokens[i].b]);
        else if (i + 1 < tokens.length && withSuffix(tokens[i].t + tokens[i + 1].t, p)) found.push([tokens[i].a, tokens[i + 1].b]);
      }
      for (let i = 0; i < tokens.length; i++) {
        if ([...tokens[i].t].length !== 1) continue;
        let j = i;
        while (j + 1 < tokens.length && [...tokens[j + 1].t].length === 1) j++;
        if (j > i) {
          for (let x = i; x < j; x++) {
            let s = tokens[x].t;
            for (let y = x + 1; y <= j; y++) {
              s += tokens[y].t;
              if (withSuffix(s, p)) found.push([tokens[x].a, tokens[y].b]);
            }
          }
        }
        i = j;
      }
    } else {
      for (let i = 0; i + parts.length <= tokens.length; i++) {
        let ok = true;
        for (let k = 0; k < parts.length && ok; k++) ok = k === parts.length - 1 ? withSuffix(tokens[i + k].t, parts[k]) : tokens[i + k].t === parts[k];
        if (ok) found.push([tokens[i].a, tokens[i + parts.length - 1].b]);
      }
    }
    if (!found.length) continue;
    const action = mode === 'block' ? 'block' : w.action;
    hits.push({ id: w.id, word: w.word, action });
    if (action === 'mask') ranges.push(...found);
  }
  const blocked = hits.some(h => h.action === 'block');
  const flagged = hits.some(h => h.action === 'flag');
  let out = text;
  if (ranges.length && !blocked) {
    const masked = new Map<number, string>();
    for (const [a, b] of ranges) {
      const s = cs[a].s;
      const e = cs[b].e;
      for (let j = s; j < e; j++) masked.set(j, 'x');
    }
    const kept = new Set<number>();
    const isLetter = new Set<number>();
    for (const c of cs) for (let j = c.s; j < c.e; j++) {
      kept.add(j);
      if (c.letter) isLetter.add(j);
    }
    let r = '';
    for (let j = 0; j < text.length; j++) {
      if (!masked.has(j)) r += text[j];
      else if (!kept.has(j)) continue;
      else r += isLetter.has(j) ? '*' : text[j];
    }
    out = r;
  }
  return { text: out, normalized: cs.map(c => c.c).join(''), changed: out !== text, blocked, flagged, masked: out !== text, hits };
}

export function filterText(ctx: SDb, text: string, mode = 'rules') {
  if (mode === 'off') return applyFilter([], text);
  return applyFilter([...ctx.db.chatWord.iter()], text, mode);
}
