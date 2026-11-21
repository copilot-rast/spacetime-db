import { Router, SyncResponse, t } from 'spacetimedb/server';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { Translations, adminOrNull, audit, cleanKey, fail, requireAccount, requireRole, signHex, toLatinDigits, type Tr } from '@stg/base';
import { pubRows, type PublicationSchema } from './schema';
import { htmlToText, looksLikeHtml, markdownToHtml, sanitizeHtml, textToHtml, xmlEscape } from './html';
import {
  DAY_US,
  base,
  checkRate,
  checkTags,
  cleanAbsUrl,
  cleanText,
  cleanUrl,
  defaultLang,
  langList,
  newsSettings,
  nowUs,
  page,
  pick,
  query,
  rateLeft,
  type NewsRow,
  type PTx,
} from './engine';

export const STATUSES = ['draft', 'pending_review', 'published', 'archived', 'rejected'];
export const NOTIFY_MODES = ['none', 'inbox', 'push', 'both'];
const MOVES: Record<string, string[]> = {
  draft: ['pending_review', 'published', 'archived'],
  pending_review: ['published', 'rejected', 'draft'],
  published: ['archived', 'draft'],
  rejected: ['draft', 'pending_review'],
  archived: ['draft', 'published'],
};
const BODY_MAX = 100_000;
const MAX_ITEMS = 50;
const FIELDS = ['title', 'summary', 'body', 'cover', 'category', 'tags', 'lang', 'publishedAt', 'expiresAt', 'externalId', 'url', 'slug', 'metaTitle', 'metaDescription', 'keywords', 'canonicalUrl', 'ogImage', 'noindex'];
const DEFAULT_MAPPING: Record<string, string> = Object.fromEntries(FIELDS.map(f => [f, f === 'externalId' ? 'id' : f]));
const LATIN: Record<string, string> = {
  'ا': 'a', 'آ': 'a', 'أ': 'a', 'إ': 'e', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'gh', 'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'و': 'v', 'ه': 'h', 'ة': 'h', 'ی': 'i', 'ي': 'i', 'ى': 'i', 'ئ': 'i', 'ؤ': 'o', 'ء': '',
};

const Tag = t.object('NewsTag', { key: t.string(), title: Translations });
const ReactionCount = t.object('NewsReactionCount', { key: t.string(), count: t.u32() });
const Seo = t.object('NewsSeo', { slug: t.string(), metaTitle: Translations, metaDescription: Translations, keywords: t.array(t.string()), canonicalUrl: t.string(), ogImage: t.string(), noindex: t.bool() });
const NewsItem = t.object('NewsItem', {
  id: t.u64(),
  slug: t.string(),
  categoryKey: t.string(),
  title: Translations,
  summary: Translations,
  body: Translations,
  coverUrl: t.string(),
  isPinned: t.bool(),
  publishedAt: t.u64(),
  expiresAt: t.u64(),
  expired: t.bool(),
  seen: t.bool(),
  tags: t.array(Tag),
  commentCount: t.u32(),
  reactions: t.array(ReactionCount),
  reactionCount: t.u32(),
  myReaction: t.string(),
  allowComment: t.bool(),
  allowReaction: t.bool(),
  sourceUrl: t.string(),
  seo: t.option(Seo),
});
const NewsPage = t.object('NewsPage', { total: t.u32(), unread: t.u32(), items: t.array(NewsItem) });
const ReactResult = t.object('NewsReactResult', { reactions: t.array(ReactionCount), reactionCount: t.u32(), myReaction: t.string() });
const CommentLine = t.object('NewsCommentLine', { id: t.u64(), parentId: t.u64(), accountId: t.u64(), displayName: t.string(), message: t.string(), status: t.string(), mine: t.bool(), createdAt: t.timestamp() });
const CommentPage = t.object('NewsCommentPage', { total: t.u32(), rows: t.array(CommentLine) });
const SourceInfo = t.object('NewsSourceInfo', {
  id: t.u64(),
  key: t.string(),
  name: t.string(),
  isActive: t.bool(),
  authMode: t.string(),
  tokenHeader: t.string(),
  signatureHeader: t.string(),
  timestampHeader: t.string(),
  skewSeconds: t.u32(),
  secretHint: t.string(),
  itemsPath: t.string(),
  mapping: t.string(),
  bodyFormat: t.string(),
  defaultCategoryId: t.u64(),
  defaultLang: t.string(),
  defaultTagIds: t.array(t.u64()),
  publishMode: t.string(),
  updateMode: t.string(),
  rateLimitPerMinute: t.u32(),
  notifyMode: t.string(),
  allowComment: t.bool(),
  allowReaction: t.bool(),
  lastReceivedAt: t.u64(),
});
const LogPage = t.object('NewsIngestLogPage', { total: t.u32(), rows: t.array(pubRows.ingestLog) });

type SourceRow = NonNullable<ReturnType<PTx['db']['newsSource']['id']['find']>>;
type Settings = ReturnType<typeof newsSettings>;

export function isExpired(n: NewsRow, now: bigint) {
  return !!n.expiresAt && now >= n.expiresAt;
}

export function isLive(n: NewsRow, now: bigint) {
  return n.status === 'published' && n.publishedAt <= now;
}

function visibleTo(n: NewsRow, now: bigint, s: Settings) {
  return isLive(n, now) && (!isExpired(n, now) || s.showExpired);
}

function plain(list: Tr[], max: number) {
  return list.map(x => ({ lang: x.lang, text: htmlToText(x.text).slice(0, max) })).filter(x => x.text);
}

function categoryKeyOf(ctx: PTx, id: bigint) {
  return id ? ctx.db.category.id.find(id)?.key ?? '' : '';
}

function seoOf(n: NewsRow) {
  const desc = n.metaDescription.length ? n.metaDescription : n.summary.length ? n.summary : plain(n.body, 160);
  return { slug: n.slug, metaTitle: n.metaTitle.length ? n.metaTitle : n.title, metaDescription: desc, keywords: n.keywords, canonicalUrl: n.canonicalUrl, ogImage: n.ogImage || n.coverUrl, noindex: n.noindex };
}

function reactionsOf(ctx: PTx, newsId: bigint, accountId: bigint | undefined) {
  const counts = new Map<string, number>();
  let mine = '';
  let total = 0;
  for (const r of ctx.db.newsReaction.newsId.filter(newsId)) {
    counts.set(r.reaction, (counts.get(r.reaction) ?? 0) + 1);
    total++;
    if (r.accountId === accountId) mine = r.reaction;
  }
  return { reactions: [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)), reactionCount: total, myReaction: mine };
}

function itemOf(ctx: PTx, n: NewsRow, accountId: bigint | undefined, now: bigint, full: boolean, seo: boolean) {
  return {
    id: n.id,
    slug: n.slug,
    categoryKey: categoryKeyOf(ctx, n.categoryId),
    title: n.title,
    summary: n.summary,
    body: full ? n.body : [],
    coverUrl: n.coverUrl,
    isPinned: n.isPinned,
    publishedAt: n.publishedAt,
    expiresAt: n.expiresAt,
    expired: isExpired(n, now),
    seen: accountId !== undefined && !!ctx.db.newsSeen.key.find(`${n.id}|${accountId}`),
    tags: n.tagIds.map(id => ctx.db.tag.id.find(id)).filter(x => !!x).map(x => ({ key: x!.key, title: x!.title })),
    commentCount: [...ctx.db.newsComment.newsId.filter(n.id)].filter(c => c.status === 'accepted').length,
    ...reactionsOf(ctx, n.id, accountId),
    allowComment: n.allowComment,
    allowReaction: n.allowReaction,
    sourceUrl: n.sourceUrl,
    seo: seo || full ? seoOf(n) : undefined,
  };
}

function sortNews(list: NewsRow[]) {
  return list.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.id < b.id ? 1 : -1));
}

function unreadCount(ctx: PTx, accountId: bigint, now: bigint, s: Settings, categoryId = 0n) {
  const a = ctx.db.account.id.find(accountId);
  const since = s.unreadScope === 'signup' && a ? a.createdAt.microsSinceUnixEpoch : 0n;
  let n = 0;
  for (const x of ctx.db.news.status.filter('published')) {
    if (!isLive(x, now) || isExpired(x, now) || x.publishedAt < since) continue;
    if (categoryId && x.categoryId !== categoryId) continue;
    if (!ctx.db.newsSeen.key.find(`${x.id}|${accountId}`)) n++;
  }
  return n;
}

export function newsTick(ctx: PTx) {
  const s = ctx.db.newsSettings.id.find(0);
  if (!s) return;
  const now = nowUs(ctx);
  for (const n of [...ctx.db.news.status.filter('published')]) {
    if (n.notifiedAt || !isLive(n, now) || isExpired(n, now)) continue;
    let campaignId = 0n;
    if (s.realtimeOnPublish) ctx.db.liveNotice.insert({ id: 0n, event: 'news_published', newsId: n.id, title: n.title, at: ctx.timestamp });
    const cat = ctx.db.notifyCategory.key.find(s.notifyCategoryKey);
    if (n.notifyMode !== 'none' && cat) {
      const body = n.summary.length ? n.summary : plain(n.body, 300);
      const c = ctx.db.campaign.insert({
        id: 0n,
        kind: 'news',
        name: `news:${n.id}`,
        categoryKey: cat.key,
        channels: n.notifyMode === 'both' ? ['inbox', 'push'] : [n.notifyMode],
        title: n.title,
        body: body.length ? body : n.title,
        imageUrl: n.coverUrl,
        actionType: 'news',
        actionValue: String(n.id),
        actionLabel: [],
        prizeId: 0n,
        newsId: n.id,
        target: n.notifyTagIds.length ? 'tags' : 'all',
        accountIds: [],
        tagIds: n.notifyTagIds,
        excludeTagIds: [],
        levelTableId: 0n,
        minLevel: 0,
        maxLevel: 0,
        countries: [],
        inactiveDays: 0,
        schedule: 'now',
        scheduledAt: 0n,
        repeatMinutes: 0,
        repeatUntil: 0n,
        quietStart: 0,
        quietEnd: 0,
        status: 'scheduled',
        run: 0,
        runStartedAt: 0n,
        nextAt: now,
        cursor: 0n,
        batches: 0,
        recipients: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        inboxCount: 0,
        pushSent: 0,
        pushFailed: 0,
        smsSent: 0,
        opened: 0,
        createdBy: 0n,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
        finishedAt: 0n,
      });
      campaignId = c.id;
    }
    ctx.db.news.id.update({ ...n, notifiedAt: now, campaignId });
  }
}

export function newsSweep(ctx: PTx) {
  const s = ctx.db.newsSettings.id.find(0);
  if (!s) return;
  const realNow = ctx.timestamp.microsSinceUnixEpoch;
  const cut = realNow - BigInt(s.logRetentionDays) * DAY_US;
  for (const r of [...ctx.db.ingestLog.iter()].filter(r => r.at.microsSinceUnixEpoch < cut).slice(0, 2000)) ctx.db.ingestLog.id.delete(r.id);
  for (const r of [...ctx.db.ingestReplay.iter()].filter(r => r.expiresAt < realNow).slice(0, 2000)) ctx.db.ingestReplay.key.delete(r.key);
}

function slugBase(title: string, style: string) {
  let v = toLatinDigits(title).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (style === 'latin') v = [...v].map(ch => LATIN[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-');
  else v = v.replace(/[^\p{L}\p{N}]+/gu, '-');
  return v.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '');
}

function uniqueSlug(ctx: PTx, wanted: string, selfId: bigint) {
  let slug = wanted;
  for (let i = 2; i < 1000; i++) {
    const other = ctx.db.news.slug.find(slug);
    if (!other || other.id === selfId) return slug;
    slug = `${wanted}-${i}`;
  }
  return `${wanted}-${ctx.timestamp.microsSinceUnixEpoch}`;
}

export function cleanSlug(raw: string) {
  const v = toLatinDigits(raw.trim()).toLowerCase();
  if (!v) return '';
  if (v.length > 120 || !/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u.test(v)) fail('INVALID_SLUG');
  return v;
}

function makeSlug(ctx: PTx, n: { id: bigint; slug: string; title: Tr[] }, manual: string, s: Settings) {
  if (manual) {
    const other = ctx.db.news.slug.find(manual);
    if (other && other.id !== n.id) fail('SLUG_EXISTS');
    return manual;
  }
  if (n.slug && !n.slug.startsWith('tmp-')) return n.slug;
  const title = pick(n.title, defaultLang(ctx), ctx);
  const b = s.slugStyle === 'id' ? '' : slugBase(title, s.slugStyle);
  return b ? uniqueSlug(ctx, b, n.id) : '';
}

function cleanBody(ctx: PTx, list: Tr[], format = 'html') {
  const out: Tr[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const lang = x.lang.trim();
    if (!lang || seen.has(lang) || !x.text.trim()) continue;
    if (!ctx.db.language.code.find(lang)) fail('UNKNOWN_LANGUAGE');
    if (x.text.length > BODY_MAX * 2) fail('BODY_TOO_LONG');
    const html = format === 'markdown' ? markdownToHtml(x.text) : format === 'text' ? textToHtml(x.text) : sanitizeHtml(x.text, BODY_MAX + 1);
    if (html.length > BODY_MAX) fail('BODY_TOO_LONG');
    seen.add(lang);
    out.push({ lang, text: html });
  }
  return out;
}

function checkCategory(ctx: PTx, id: bigint, kind: string) {
  if (!id) return 0n;
  const c = ctx.db.category.id.find(id);
  if (!c) fail('CATEGORY_NOT_FOUND');
  if (c.keyType !== kind && c.keyType !== 'general') fail('CATEGORY_KIND_MISMATCH');
  return id;
}

function cleanKeywords(list: string[]) {
  const out = [...new Set(list.map(k => k.trim()).filter(Boolean))];
  if (out.length > 30 || out.some(k => k.length > 60)) fail('INVALID_KEYWORDS');
  return out;
}

function insertNews(ctx: PTx, row: Omit<NewsRow, 'id' | 'slug'>, manualSlug: string, s: Settings) {
  const tmp = `tmp-${ctx.timestamp.microsSinceUnixEpoch}-${ctx.db.news.count()}`;
  const slug = makeSlug(ctx, { id: 0n, slug: '', title: row.title }, manualSlug, s);
  const saved = ctx.db.news.insert({ ...row, id: 0n, slug: slug || tmp });
  if (!slug) return ctx.db.news.id.update({ ...saved, slug: uniqueSlug(ctx, `news-${saved.id}`, saved.id) });
  return saved;
}

function headerOf(h: { get(name: string): string | null }, name: string) {
  return (h.get(name) ?? '').trim();
}

function ctEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function lookup(v: unknown, path: string): unknown {
  const p = path.trim().replace(/^\$\.?/, '');
  if (!p) return v;
  let cur: unknown = v;
  for (const seg of p.split('.')) {
    const m = /^([A-Za-z_@][A-Za-z0-9_@-]*)?((\[\d{1,4}\])*)$/.exec(seg);
    if (!m) return undefined;
    if (m[1]) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[m[1]];
    }
    for (const ix of m[2].matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(ix[1])];
    }
  }
  return cur;
}

export function validPath(path: string) {
  const p = path.trim().replace(/^\$\.?/, '');
  if (!p) return true;
  if (p.length > 200) return false;
  return p.split('.').every(seg => /^([A-Za-z_@][A-Za-z0-9_@-]*)?((\[\d{1,4}\])*)$/.test(seg) && seg !== '');
}

function scalar(v: unknown) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return '';
}

function imageUrl(v: unknown, depth = 0): string {
  if (depth > 3 || v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = imageUrl(x, depth + 1);
      if (u) return u;
    }
    return '';
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['url', 'src', 'href', '@url', 'link', 'uri']) if (typeof o[k] === 'string' && o[k]) return (o[k] as string).trim();
    for (const k of ['image', 'original', 'large', 'full']) {
      const u = imageUrl(o[k], depth + 1);
      if (u) return u;
    }
  }
  return '';
}

function parseTime(v: unknown): bigint | undefined | null {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return BigInt(Math.round(v > 1e12 ? v * 1000 : v * 1_000_000));
  if (typeof v === 'string') {
    if (/^\d{9,13}$/.test(v)) return parseTime(Number(v));
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && ms > 0) return BigInt(ms) * 1000n;
  }
  return null;
}

function stringList(v: unknown) {
  if (typeof v === 'string') return v.split(',').map(x => x.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? scalar((x as Record<string, unknown>).key ?? (x as Record<string, unknown>).name) : scalar(x))).filter(Boolean);
  return [];
}

function safeHttp(u: string) {
  return /^https?:\/\/[^\s<>"']+$/.test(u) && u.length <= 1024;
}

type IngestResult = { index: number; externalId: string; status: string; newsId: bigint; code: string; notes: string[] };

function ingestItem(ctx: PTx, src: SourceRow, s: Settings, item: unknown, index: number): IngestResult {
  const res: IngestResult = { index, externalId: '', status: 'failed', newsId: 0n, code: '', notes: [] };
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ...res, code: 'ITEM_NOT_OBJECT' };
  let mapping: Record<string, string> = {};
  try {
    mapping = JSON.parse(src.mapping || '{}');
  } catch {}
  const map = { ...DEFAULT_MAPPING, ...mapping };
  const get = (f: string) => (map[f] ? lookup(item, map[f]) : undefined);
  const notes = res.notes;
  const title = htmlToText(scalar(get('title'))).replace(/\s+/g, ' ').slice(0, 200);
  if (!title) return { ...res, code: 'ITEM_TITLE_REQUIRED' };
  const summary = htmlToText(scalar(get('summary'))).replace(/\s+/g, ' ').slice(0, 1000);
  const rawBody = scalar(get('body'));
  let format = src.bodyFormat;
  if (format === 'auto') format = looksLikeHtml(rawBody) ? 'html' : 'markdown';
  let body = format === 'html' ? sanitizeHtml(rawBody, BODY_MAX + 1) : format === 'markdown' ? markdownToHtml(rawBody) : textToHtml(rawBody);
  if (body.length > BODY_MAX) return { ...res, code: 'ITEM_BODY_TOO_LONG' };
  if (!htmlToText(body)) {
    body = textToHtml(summary || title);
    notes.push('BODY_EMPTY_USED_SUMMARY');
  }
  let cover = imageUrl(get('cover'));
  if (cover && !safeHttp(cover)) {
    cover = '';
    notes.push('COVER_URL_IGNORED');
  }
  let url = scalar(get('url'));
  if (url && !safeHttp(url)) {
    url = '';
    notes.push('SOURCE_URL_IGNORED');
  }
  let ogImage = imageUrl(get('ogImage'));
  if (ogImage && !safeHttp(ogImage)) {
    ogImage = '';
    notes.push('OG_IMAGE_IGNORED');
  }
  let canonical = scalar(get('canonicalUrl'));
  if (canonical && !safeHttp(canonical)) {
    canonical = '';
    notes.push('CANONICAL_URL_IGNORED');
  }
  const active = langList(ctx);
  const rawLang = scalar(get('lang')).toLowerCase();
  const langCand = rawLang.split(/[-_]/)[0];
  const lang = active.has(rawLang) ? rawLang : active.has(langCand) ? langCand : active.has(src.defaultLang) ? src.defaultLang : defaultLang(ctx);
  const def = defaultLang(ctx);
  const tr = (text: string) => (text ? (lang !== def && s.fillDefaultLang ? [{ lang, text }, { lang: def, text }] : [{ lang, text }]) : []);
  const rawCat = get('category');
  const catKey = rawCat && typeof rawCat === 'object' && !Array.isArray(rawCat) ? scalar((rawCat as Record<string, unknown>).key) : scalar(rawCat);
  let categoryId = src.defaultCategoryId;
  if (catKey) {
    const c = [...ctx.db.category.byTypeKey.filter(['news', catKey])][0] ?? [...ctx.db.category.byTypeKey.filter(['general', catKey])][0];
    if (c) categoryId = c.id;
    else notes.push('CATEGORY_UNKNOWN');
  }
  const tagIds = [...src.defaultTagIds];
  let unknownTag = false;
  for (const k of stringList(get('tags')).slice(0, 50)) {
    const tg = [...ctx.db.tag.byTypeKey.filter(['news', k])][0] ?? [...ctx.db.tag.byTypeKey.filter(['general', k])][0];
    if (tg) {
      if (!tagIds.includes(tg.id)) tagIds.push(tg.id);
    } else unknownTag = true;
  }
  if (unknownTag) notes.push('TAGS_UNKNOWN');
  const publishedAt = parseTime(get('publishedAt'));
  if (publishedAt === null) notes.push('PUBLISHED_AT_IGNORED');
  const expiresAt = parseTime(get('expiresAt'));
  if (expiresAt === null) notes.push('EXPIRES_AT_IGNORED');
  let slug = '';
  const rawSlug = scalar(get('slug'));
  if (rawSlug) {
    try {
      slug = cleanSlug(rawSlug);
    } catch {
      notes.push('SLUG_IGNORED');
    }
  }
  const keywords = stringList(get('keywords')).slice(0, 30).filter(k => k.length <= 60);
  const metaTitle = htmlToText(scalar(get('metaTitle'))).slice(0, 200);
  const metaDescription = htmlToText(scalar(get('metaDescription'))).slice(0, 400);
  const noindexRaw = get('noindex');
  const mapped = { title, summary, body, cover, url, categoryId: String(categoryId), tagIds: tagIds.map(String), lang, publishedAt: String(publishedAt ?? ''), expiresAt: String(expiresAt ?? ''), slug, keywords, metaTitle, metaDescription, canonical, ogImage, noindex: noindexRaw === true };
  const hash = bytesToHex(sha256(utf8ToBytes(JSON.stringify(mapped))));
  const ext = scalar(get('externalId')).slice(0, 200) || `sha256:${hash}`;
  res.externalId = ext;
  const externalKey = `${src.key}|${ext}`;
  const existing = [...ctx.db.news.externalKey.filter(externalKey)][0];
  const now = nowUs(ctx);
  const content = {
    categoryId,
    tagIds,
    title: tr(title),
    summary: tr(summary),
    body: tr(body),
    coverUrl: cover,
    expiresAt: expiresAt ?? 0n,
    sourceUrl: url,
    contentHash: hash,
    lang,
    metaTitle: tr(metaTitle),
    metaDescription: tr(metaDescription),
    keywords,
    canonicalUrl: canonical,
    ogImage,
    noindex: noindexRaw === true,
    updatedAt: ctx.timestamp,
  };
  if (existing) {
    res.newsId = existing.id;
    if (existing.contentHash === hash) return { ...res, status: 'unchanged' };
    if (src.updateMode === 'ignore') return { ...res, status: 'ignored' };
    ctx.db.news.id.update({ ...existing, ...content, publishedAt: publishedAt ?? existing.publishedAt });
    return { ...res, status: 'updated' };
  }
  const status = src.publishMode === 'publish' ? 'published' : 'pending_review';
  const saved = insertNews(
    ctx,
    {
      ...content,
      status,
      isPinned: false,
      publishedAt: publishedAt ?? (status === 'published' ? now : 0n),
      allowComment: src.allowComment,
      freeComment: false,
      allowReaction: src.allowReaction,
      notifyMode: src.notifyMode,
      notifyTagIds: [],
      notifiedAt: 0n,
      campaignId: 0n,
      source: `webhook:${src.key}`,
      externalKey,
      approvedBy: 0n,
      approvedAt: status === 'published' ? now : 0n,
      rejectReason: '',
      createdBy: 0n,
      updatedBy: 0n,
      createdAt: ctx.timestamp,
    },
    slug && !ctx.db.news.slug.find(slug) ? slug : '',
    s
  );
  if (slug && saved.slug !== slug) notes.push('SLUG_TAKEN');
  return { ...res, status: 'created', newsId: saved.id };
}

function ser(o: unknown) {
  return JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new SyncResponse(ser(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

function writeLog(ctx: PTx, src: SourceRow, s: Settings, status: string, httpStatus: number, code: string, results: IngestResult[], body: string) {
  const count = (st: string) => results.filter(r => r.status === st).length;
  ctx.db.ingestLog.insert({
    id: 0n,
    sourceId: src.id,
    status,
    httpStatus,
    code,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    ignored: count('ignored'),
    failed: count('failed'),
    results: ser(results).slice(0, 20000),
    body: body.slice(0, s.logPayloadBytes),
    at: ctx.timestamp,
  });
}

function articleUrl(s: Settings, n: NewsRow) {
  if (n.canonicalUrl) return n.canonicalUrl;
  return s.publicBaseUrl.replace(/\/+$/, '') + s.publicPath.replace('{slug}', encodeURIComponent(n.slug));
}

function iso(us: bigint) {
  return new Date(Number(us / 1000n)).toISOString();
}

export function defineNews(st: PublicationSchema) {
  const adminNews = st.view({ name: 'admin_news', public: true }, t.array(pubRows.news), ctx => (adminOrNull(ctx as any) ? [...ctx.db.news.iter()] : []));

  const adminNewsSettings = st.view({ name: 'admin_news_settings', public: true }, t.option(pubRows.newsSettings), ctx => (adminOrNull(ctx as any) ? ctx.db.newsSettings.id.find(0) ?? undefined : undefined));

  const adminNewsSources = st.view({ name: 'admin_news_sources', public: true }, t.array(SourceInfo), ctx =>
    adminOrNull(ctx as any)
      ? [...ctx.db.newsSource.iter()].map(({ secret, createdAt: _c, updatedAt: _u, ...r }) => ({ ...r, secretHint: secret ? `****${secret.slice(-4)}` : '' }))
      : []
  );

  const adminSaveNewsSettings = st.reducer(
    {
      commentsPerMinute: t.u32(),
      reactionsPerMinute: t.u32(),
      listPerMinute: t.u32(),
      unreadScope: t.string(),
      showExpired: t.bool(),
      fillDefaultLang: t.bool(),
      realtimeOnPublish: t.bool(),
      notifyCategoryKey: t.string(),
      logRetentionDays: t.u32(),
      logPayloadBytes: t.u32(),
      ingestMaxKb: t.u32(),
      slugStyle: t.string(),
      publicEnabled: t.bool(),
      publicBaseUrl: t.string(),
      publicPath: t.string(),
      rssEnabled: t.bool(),
      publicCacheSeconds: t.u32(),
      siteTitle: Translations,
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const s = newsSettings(ctx);
      if (a.commentsPerMinute > 1000) fail('INVALID_SETTING:commentsPerMinute');
      if (a.reactionsPerMinute > 1000) fail('INVALID_SETTING:reactionsPerMinute');
      if (a.listPerMinute > 10_000) fail('INVALID_SETTING:listPerMinute');
      if (a.unreadScope !== 'signup' && a.unreadScope !== 'all') fail('INVALID_SETTING:unreadScope');
      if (!ctx.db.notifyCategory.key.find(a.notifyCategoryKey)) fail('INVALID_SETTING:notifyCategoryKey');
      if (a.logRetentionDays < 1 || a.logRetentionDays > 365) fail('INVALID_SETTING:logRetentionDays');
      if (a.logPayloadBytes > 65_536) fail('INVALID_SETTING:logPayloadBytes');
      if (a.ingestMaxKb < 1 || a.ingestMaxKb > 256) fail('INVALID_SETTING:ingestMaxKb');
      if (!['native', 'latin', 'id'].includes(a.slugStyle)) fail('INVALID_SETTING:slugStyle');
      const publicBaseUrl = cleanAbsUrl(a.publicBaseUrl, 'INVALID_SETTING:publicBaseUrl');
      if (a.publicEnabled && !publicBaseUrl) fail('PUBLIC_BASE_URL_REQUIRED');
      if (!/^\/[A-Za-z0-9_\-/.]*\{slug\}[A-Za-z0-9_\-/.]*$/.test(a.publicPath)) fail('INVALID_SETTING:publicPath');
      if (a.publicCacheSeconds > 86_400) fail('INVALID_SETTING:publicCacheSeconds');
      ctx.db.newsSettings.id.update({ ...s, ...a, publicBaseUrl, siteTitle: cleanText(ctx, a.siteTitle, 200, false), updatedAt: ctx.timestamp });
      audit(base(ctx), me.id, 'news_settings.save', 'settings', JSON.stringify({ ...a, siteTitle: undefined }));
    }
  );

  const newsArgs = {
    id: t.u64(),
    slug: t.string(),
    status: t.string(),
    categoryId: t.u64(),
    tagIds: t.array(t.u64()),
    title: Translations,
    summary: Translations,
    body: Translations,
    coverUrl: t.string(),
    isPinned: t.bool(),
    publishedAt: t.u64(),
    expiresAt: t.u64(),
    allowComment: t.bool(),
    freeComment: t.bool(),
    allowReaction: t.bool(),
    notifyMode: t.string(),
    notifyTagIds: t.array(t.u64()),
    metaTitle: Translations,
    metaDescription: Translations,
    keywords: t.array(t.string()),
    canonicalUrl: t.string(),
    ogImage: t.string(),
    noindex: t.bool(),
  };

  const adminSaveNews = st.reducer(newsArgs, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const s = newsSettings(ctx);
    const old = a.id ? ctx.db.news.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    if (!STATUSES.includes(a.status)) fail('INVALID_STATUS');
    if (a.status === 'rejected' && (!old || old.status !== 'rejected')) fail('USE_REVIEW');
    if (old && old.status !== a.status && !MOVES[old.status].includes(a.status)) fail('INVALID_TRANSITION');
    if (!old && !['draft', 'pending_review', 'published'].includes(a.status)) fail('INVALID_TRANSITION');
    if (!NOTIFY_MODES.includes(a.notifyMode)) fail('INVALID_NOTIFY_MODE');
    if (a.expiresAt && a.publishedAt && a.expiresAt <= a.publishedAt) fail('INVALID_WINDOW');
    const now = nowUs(ctx);
    const publishing = a.status === 'published' && old?.status !== 'published';
    const row = {
      status: a.status,
      categoryId: checkCategory(ctx, a.categoryId, 'news'),
      tagIds: checkTags(ctx, a.tagIds, ['news', 'general']),
      title: cleanText(ctx, a.title, 200, true),
      summary: cleanText(ctx, a.summary, 1000, false),
      body: cleanBody(ctx, a.body),
      coverUrl: cleanUrl(a.coverUrl),
      isPinned: a.isPinned,
      publishedAt: a.publishedAt || (publishing ? now : old?.publishedAt ?? 0n),
      expiresAt: a.expiresAt,
      allowComment: a.allowComment,
      freeComment: a.freeComment,
      allowReaction: a.allowReaction,
      notifyMode: a.notifyMode,
      notifyTagIds: checkTags(ctx, a.notifyTagIds, ['user']),
      metaTitle: cleanText(ctx, a.metaTitle, 200, false),
      metaDescription: cleanText(ctx, a.metaDescription, 400, false),
      keywords: cleanKeywords(a.keywords),
      canonicalUrl: cleanAbsUrl(a.canonicalUrl),
      ogImage: cleanUrl(a.ogImage),
      noindex: a.noindex,
      approvedBy: publishing ? me.id : old?.approvedBy ?? 0n,
      approvedAt: publishing ? now : old?.approvedAt ?? 0n,
      updatedBy: me.id,
      updatedAt: ctx.timestamp,
    };
    if (row.expiresAt && row.publishedAt && row.expiresAt <= row.publishedAt) fail('INVALID_WINDOW');
    const manual = cleanSlug(a.slug);
    let saved: NewsRow;
    if (old) {
      const slug = makeSlug(ctx, { id: old.id, slug: old.slug, title: row.title }, manual, s) || old.slug;
      saved = ctx.db.news.id.update({ ...old, ...row, slug });
    } else {
      saved = insertNews(ctx, { ...row, notifiedAt: 0n, campaignId: 0n, source: 'console', externalKey: '', sourceUrl: '', contentHash: '', lang: '', rejectReason: '', createdBy: me.id, createdAt: ctx.timestamp }, manual, s);
    }
    newsTick(ctx);
    audit(base(ctx), me.id, old ? 'news.update' : 'news.create', String(saved.id), `${saved.status}:${saved.slug}`.slice(0, 200));
  });

  const adminReviewNews = st.reducer({ ids: t.array(t.u64()), status: t.string(), reason: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!a.ids.length || a.ids.length > 200) fail('INVALID_IDS');
    if (!STATUSES.includes(a.status)) fail('INVALID_STATUS');
    const reason = a.reason.trim();
    if (a.status === 'rejected' && !reason) fail('REASON_REQUIRED');
    if (reason.length > 500) fail('INVALID_REASON');
    const now = nowUs(ctx);
    for (const id of a.ids) {
      const n = ctx.db.news.id.find(id);
      if (!n) fail('NOT_FOUND');
      if (n.status === a.status) continue;
      if (!MOVES[n.status].includes(a.status)) fail('INVALID_TRANSITION');
      const publishing = a.status === 'published';
      ctx.db.news.id.update({
        ...n,
        status: a.status,
        rejectReason: a.status === 'rejected' ? reason : '',
        publishedAt: publishing && !n.publishedAt ? now : n.publishedAt,
        approvedBy: publishing ? me.id : n.approvedBy,
        approvedAt: publishing ? now : n.approvedAt,
        updatedBy: me.id,
        updatedAt: ctx.timestamp,
      });
      audit(base(ctx), me.id, `news.${a.status}`, String(id), reason);
    }
    newsTick(ctx);
  });

  const adminDeleteNews = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const n = ctx.db.news.id.find(id);
    if (!n) fail('NOT_FOUND');
    for (const r of [...ctx.db.newsSeen.newsId.filter(id)]) ctx.db.newsSeen.key.delete(r.key);
    for (const r of [...ctx.db.newsReaction.newsId.filter(id)]) ctx.db.newsReaction.key.delete(r.key);
    for (const r of [...ctx.db.newsComment.newsId.filter(id)]) ctx.db.newsComment.id.delete(r.id);
    ctx.db.news.id.delete(id);
    audit(base(ctx), me.id, 'news.delete', String(id), n.slug);
  });

  const adminSaveReactionType = st.reducer({ key: t.string(), emoji: t.string(), name: Translations, isActive: t.bool(), sort: t.i32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const key = cleanKey(a.key);
    const emoji = a.emoji.trim();
    if (!emoji || emoji.length > 16) fail('INVALID_EMOJI');
    const old = ctx.db.reactionType.key.find(key);
    const row = { key, emoji, name: cleanText(ctx, a.name, 100, false), isActive: a.isActive, sort: a.sort };
    if (old) ctx.db.reactionType.key.update(row);
    else ctx.db.reactionType.insert(row);
    audit(base(ctx), me.id, old ? 'news_reaction.update' : 'news_reaction.create', key, emoji);
  });

  const adminDeleteReactionType = st.reducer({ key: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.reactionType.key.find(a.key)) fail('NOT_FOUND');
    if ([...ctx.db.newsReaction.reaction.filter(a.key)].length) fail('IN_USE');
    ctx.db.reactionType.key.delete(a.key);
    audit(base(ctx), me.id, 'news_reaction.delete', a.key);
  });

  const sourceArgs = {
    id: t.u64(),
    key: t.string(),
    name: t.string(),
    isActive: t.bool(),
    authMode: t.string(),
    tokenHeader: t.string(),
    signatureHeader: t.string(),
    timestampHeader: t.string(),
    skewSeconds: t.u32(),
    secret: t.string(),
    itemsPath: t.string(),
    mapping: t.string(),
    bodyFormat: t.string(),
    defaultCategoryId: t.u64(),
    defaultLang: t.string(),
    defaultTagIds: t.array(t.u64()),
    publishMode: t.string(),
    updateMode: t.string(),
    rateLimitPerMinute: t.u32(),
    notifyMode: t.string(),
    allowComment: t.bool(),
    allowReaction: t.bool(),
  };

  const adminSaveNewsSource = st.reducer(sourceArgs, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const key = cleanKey(a.key);
    const old = a.id ? ctx.db.newsSource.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    if (old && old.key !== key) fail('KEY_LOCKED');
    const same = ctx.db.newsSource.key.find(key);
    if (same && same.id !== a.id) fail('KEY_TAKEN');
    if (a.authMode !== 'token' && a.authMode !== 'hmac') fail('INVALID_AUTH_MODE');
    const hdr = (v: string, d: string) => {
      const x = (v.trim() || d).toLowerCase();
      if (!/^[a-z0-9-]{1,64}$/.test(x)) fail('INVALID_HEADER');
      return x;
    };
    if (a.skewSeconds < 30 || a.skewSeconds > 3600) fail('INVALID_SKEW');
    const secret = a.secret.trim();
    if (secret && (secret.length < 16 || secret.length > 200 || /\s/.test(secret))) fail('SECRET_TOO_SHORT');
    if (!old && !secret) fail('SECRET_REQUIRED');
    if (!validPath(a.itemsPath)) fail('INVALID_ITEMS_PATH');
    let mapping: Record<string, unknown> = {};
    if (a.mapping.trim()) {
      try {
        mapping = JSON.parse(a.mapping);
      } catch {
        fail('INVALID_MAPPING');
      }
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) fail('INVALID_MAPPING');
      for (const [k, v] of Object.entries(mapping)) if (!FIELDS.includes(k) || typeof v !== 'string' || !validPath(v)) fail(`INVALID_MAPPING:${k}`);
    }
    if (!['auto', 'html', 'markdown', 'text'].includes(a.bodyFormat)) fail('INVALID_BODY_FORMAT');
    if (a.defaultLang && !ctx.db.language.code.find(a.defaultLang)) fail('UNKNOWN_LANGUAGE');
    if (a.publishMode !== 'review' && a.publishMode !== 'publish') fail('INVALID_PUBLISH_MODE');
    if (a.updateMode !== 'update' && a.updateMode !== 'ignore') fail('INVALID_UPDATE_MODE');
    if (a.rateLimitPerMinute > 10_000) fail('INVALID_RATE_LIMIT');
    if (!NOTIFY_MODES.includes(a.notifyMode)) fail('INVALID_NOTIFY_MODE');
    const row = {
      id: a.id,
      key,
      name: a.name.trim().slice(0, 200),
      isActive: a.isActive,
      authMode: a.authMode,
      tokenHeader: hdr(a.tokenHeader, 'x-news-token'),
      signatureHeader: hdr(a.signatureHeader, 'x-news-signature'),
      timestampHeader: hdr(a.timestampHeader, 'x-news-timestamp'),
      skewSeconds: a.skewSeconds,
      secret: secret || old!.secret,
      itemsPath: a.itemsPath.trim(),
      mapping: a.mapping.trim() ? JSON.stringify(mapping) : '',
      bodyFormat: a.bodyFormat,
      defaultCategoryId: checkCategory(ctx, a.defaultCategoryId, 'news'),
      defaultLang: a.defaultLang,
      defaultTagIds: checkTags(ctx, a.defaultTagIds, ['news', 'general']),
      publishMode: a.publishMode,
      updateMode: a.updateMode,
      rateLimitPerMinute: a.rateLimitPerMinute,
      notifyMode: a.notifyMode,
      allowComment: a.allowComment,
      allowReaction: a.allowReaction,
      lastReceivedAt: old?.lastReceivedAt ?? 0n,
      createdAt: old?.createdAt ?? ctx.timestamp,
      updatedAt: ctx.timestamp,
    };
    const saved = old ? ctx.db.newsSource.id.update(row) : ctx.db.newsSource.insert({ ...row, id: 0n });
    audit(base(ctx), me.id, old ? 'news_source.update' : 'news_source.create', String(saved.id), secret && old ? `${key}:secret_rotated` : key);
  });

  const adminDeleteNewsSource = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const s = ctx.db.newsSource.id.find(id);
    if (!s) fail('NOT_FOUND');
    ctx.db.newsSource.id.delete(id);
    audit(base(ctx), me.id, 'news_source.delete', String(id), s.key);
  });

  const adminIngestLog = st.procedure({ sourceId: t.u64(), status: t.string(), page: t.u32(), pageSize: t.u32() }, LogPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const list = [...(a.sourceId ? tx.db.ingestLog.sourceId.filter(a.sourceId) : tx.db.ingestLog.iter())].filter(l => !a.status || l.status === a.status).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminNewsComments = st.procedure({ newsId: t.u64(), status: t.string(), page: t.u32(), pageSize: t.u32() }, t.object('NewsAdminCommentPage', { total: t.u32(), rows: t.array(pubRows.newsComment) }), (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const list = [...(a.newsId ? tx.db.newsComment.newsId.filter(a.newsId) : tx.db.newsComment.iter())].filter(c => !a.status || c.status === a.status).sort((x, y) => (x.id < y.id ? 1 : -1));
      return page(list, a.page, a.pageSize);
    })
  );

  const adminModerateComment = st.reducer({ id: t.u64(), accept: t.bool() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    const c = ctx.db.newsComment.id.find(a.id);
    if (!c) fail('NOT_FOUND');
    ctx.db.newsComment.id.update({ ...c, status: a.accept ? 'accepted' : 'pending', updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, a.accept ? 'news_comment.accept' : 'news_comment.hide', String(a.id));
  });

  const adminDeleteComment = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'operator');
    const c = ctx.db.newsComment.id.find(a.id);
    if (!c) fail('NOT_FOUND');
    for (const r of [...ctx.db.newsComment.newsId.filter(c.newsId)].filter(r => r.parentId === c.id)) ctx.db.newsComment.id.delete(r.id);
    ctx.db.newsComment.id.delete(a.id);
    audit(base(ctx), me.id, 'news_comment.delete', String(a.id));
  });

  const visibleNews = (tx: PTx, id: bigint) => {
    const n = tx.db.news.id.find(id);
    if (!n || !visibleTo(n, nowUs(tx), newsSettings(tx))) fail('NEWS_NOT_FOUND');
    return n;
  };

  const newsList = st.procedure(
    { page: t.u32(), pageSize: t.u32(), categoryKey: t.string(), tagKeys: t.array(t.string()), tagMode: t.string(), expired: t.string(), unreadOnly: t.bool(), includeSeo: t.bool() },
    NewsPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        const me = requireAccount(base(tx));
        const s = newsSettings(tx);
        checkRate(tx, `${me.id}|news`, s.listPerMinute);
        const now = nowUs(tx);
        const mode = s.showExpired && (a.expired === 'include' || a.expired === 'only') ? a.expired : 'exclude';
        const cat = a.categoryKey ? [...tx.db.category.byTypeKey.filter(['news', a.categoryKey])][0] ?? [...tx.db.category.byTypeKey.filter(['general', a.categoryKey])][0] : undefined;
        if (a.categoryKey && !cat) return { total: 0, unread: unreadCount(tx, me.id, now, s), items: [] };
        const tagIds = a.tagKeys.slice(0, 20).map(k => ([...tx.db.tag.byTypeKey.filter(['news', k])][0] ?? [...tx.db.tag.byTypeKey.filter(['general', k])][0])?.id ?? 0n);
        const list = sortNews(
          [...tx.db.news.status.filter('published')].filter(n => {
            if (!isLive(n, now)) return false;
            const exp = isExpired(n, now);
            if (mode === 'exclude' && exp) return false;
            if (mode === 'only' && !exp) return false;
            if (cat && n.categoryId !== cat.id) return false;
            if (tagIds.length) {
              const hit = tagIds.filter(id => n.tagIds.includes(id)).length;
              if (a.tagMode === 'all' ? hit < tagIds.length : !hit) return false;
            }
            if (a.unreadOnly && tx.db.newsSeen.key.find(`${n.id}|${me.id}`)) return false;
            return true;
          })
        );
        const p = page(list, a.page, a.pageSize);
        return { total: p.total, unread: unreadCount(tx, me.id, now, s), items: p.rows.map(n => itemOf(tx, n, me.id, now, false, a.includeSeo)) };
      })
  );

  const newsGet = st.procedure({ id: t.u64() }, NewsItem, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      return itemOf(tx, visibleNews(tx, a.id), me.id, nowUs(tx), true, true);
    })
  );

  const newsBySlug = st.procedure({ slug: t.string() }, NewsItem, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const n = tx.db.news.slug.find(toLatinDigits(a.slug.trim()).toLowerCase());
      if (!n) fail('NEWS_NOT_FOUND');
      return itemOf(tx, visibleNews(tx, n.id), me.id, nowUs(tx), true, true);
    })
  );

  const newsUnread = st.procedure({ categoryKey: t.string() }, t.u32(), (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const cat = a.categoryKey ? [...tx.db.category.byTypeKey.filter(['news', a.categoryKey])][0] : undefined;
      return unreadCount(tx, me.id, nowUs(tx), newsSettings(tx), cat?.id ?? 0n);
    })
  );

  const newsSeen = st.procedure({ ids: t.array(t.u64()), all: t.bool() }, t.u32(), (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = newsSettings(tx);
      if (!a.all && (!a.ids.length || a.ids.length > 200)) fail('INVALID_IDS');
      const now = nowUs(tx);
      const list = a.all ? [...tx.db.news.status.filter('published')].filter(n => visibleTo(n, now, s)) : a.ids.map(id => tx.db.news.id.find(id)).filter(n => !!n && visibleTo(n, now, s));
      for (const n of list) {
        const key = `${n!.id}|${me.id}`;
        if (!tx.db.newsSeen.key.find(key)) tx.db.newsSeen.insert({ key, newsId: n!.id, accountId: me.id, at: now });
      }
      return unreadCount(tx, me.id, now, s);
    })
  );

  const newsReact = st.procedure({ newsId: t.u64(), reaction: t.string() }, ReactResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const s = newsSettings(tx);
      const n = tx.db.news.id.find(a.newsId);
      const now = nowUs(tx);
      if (!n || !isLive(n, now)) fail('NEWS_NOT_FOUND');
      if (isExpired(n, now)) fail('NEWS_EXPIRED');
      if (!n.allowReaction) fail('REACTION_NOT_ALLOWED');
      checkRate(tx, `${me.id}|react`, s.reactionsPerMinute, 'REACTION_RATE_LIMITED');
      const key = `${n.id}|${me.id}`;
      const old = tx.db.newsReaction.key.find(key);
      if (!a.reaction) {
        if (old) tx.db.newsReaction.key.delete(key);
      } else {
        const type = tx.db.reactionType.key.find(a.reaction);
        if (!type || !type.isActive) fail('REACTION_NOT_FOUND');
        const row = { key, newsId: n.id, accountId: me.id, reaction: type.key, at: now };
        if (old) tx.db.newsReaction.key.update(row);
        else tx.db.newsReaction.insert(row);
      }
      return reactionsOf(tx, n.id, me.id);
    })
  );

  const newsComments = st.procedure({ newsId: t.u64(), page: t.u32(), pageSize: t.u32() }, CommentPage, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      visibleNews(tx, a.newsId);
      const list = [...tx.db.newsComment.newsId.filter(a.newsId)].filter(c => c.status === 'accepted' || c.accountId === me.id).sort((x, y) => (x.id < y.id ? -1 : 1));
      const p = page(list, a.page, a.pageSize);
      return { total: p.total, rows: p.rows.map(c => ({ id: c.id, parentId: c.parentId, accountId: c.accountId, displayName: tx.db.account.id.find(c.accountId)?.displayName ?? '', message: c.message, status: c.status, mine: c.accountId === me.id, createdAt: c.createdAt })) };
    })
  );

  const newsComment = st.procedure({ newsId: t.u64(), message: t.string(), parentId: t.u64() }, pubRows.newsComment, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const n = visibleNews(tx, a.newsId);
      if (!n.allowComment) fail('COMMENTS_CLOSED');
      const message = a.message.trim();
      if (!message || message.length > 1000) fail('INVALID_MESSAGE');
      checkRate(tx, `${me.id}|comment`, newsSettings(tx).commentsPerMinute, 'COMMENT_RATE_LIMITED');
      let parentId = 0n;
      if (a.parentId) {
        const p = tx.db.newsComment.id.find(a.parentId);
        if (!p || p.newsId !== n.id) fail('PARENT_NOT_FOUND');
        parentId = p.parentId || p.id;
      }
      return tx.db.newsComment.insert({ id: 0n, newsId: n.id, accountId: me.id, parentId, message, status: n.freeComment ? 'accepted' : 'pending', createdAt: tx.timestamp, updatedAt: tx.timestamp });
    })
  );

  const newsCommentDelete = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx));
    const c = ctx.db.newsComment.id.find(a.id);
    if (!c || c.accountId !== me.id) fail('NOT_FOUND');
    for (const r of [...ctx.db.newsComment.newsId.filter(c.newsId)].filter(r => r.parentId === c.id)) ctx.db.newsComment.id.update({ ...r, parentId: 0n });
    ctx.db.newsComment.id.delete(c.id);
  });

  const newsIngest = st.httpHandler((ctx, req) => {
    if (req.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED' });
    const q = query(req.url);
    const key = (q.source ?? q.key ?? '').trim().toLowerCase();
    const src = ctx.withTx(tx => {
      const s = /^[a-z][a-z0-9_-]{0,63}$/.test(key) ? tx.db.newsSource.key.find(key) : undefined;
      return s && s.isActive ? { ...s } : undefined;
    });
    if (!src) return json(404, { code: 'SOURCE_NOT_FOUND' });
    const s = ctx.withTx(tx => ({ ...newsSettings(tx) }));
    const bytes = req.bytes();
    if (bytes.length > s.ingestMaxKb * 1024) return json(413, { code: 'PAYLOAD_TOO_LARGE' });
    const realNow = ctx.timestamp.microsSinceUnixEpoch;
    if (!ctx.withTx(tx => rateLeft(tx, `ingest|${src.id}`, src.rateLimitPerMinute))) return json(429, { code: 'RATE_LIMITED' }, { 'Retry-After': String(60 - Number((realNow / 1_000_000n) % 60n)) });
    const body = req.text();
    const reject = (status: number, code: string, logBody: string) => {
      ctx.withTx(tx => writeLog(tx, src, s, 'rejected', status, code, [], logBody));
      return json(status, { code });
    };
    if (src.authMode === 'token') {
      let got = headerOf(req.headers, src.tokenHeader);
      if (src.tokenHeader === 'authorization') got = got.replace(/^bearer\s+/i, '').trim();
      if (!got || !ctEqual(got, src.secret)) return reject(401, 'INVALID_TOKEN', '');
    } else {
      const tsRaw = headerOf(req.headers, src.timestampHeader);
      if (!/^\d{9,13}$/.test(tsRaw)) return reject(401, 'INVALID_TIMESTAMP', '');
      let ts = Number(tsRaw);
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      const nowSec = Number(realNow / 1_000_000n);
      if (Math.abs(nowSec - ts) > src.skewSeconds) return reject(401, 'TIMESTAMP_OUT_OF_WINDOW', '');
      const sig = headerOf(req.headers, src.signatureHeader).toLowerCase().replace(/^sha256=/, '');
      const want = signHex(src.secret, `${tsRaw}.${body}`);
      if (!sig || !ctEqual(sig, want)) return reject(401, 'INVALID_SIGNATURE', '');
      const replayed = ctx.withTx(tx => {
        const rk = `${src.id}|${sig}`;
        if (tx.db.ingestReplay.key.find(rk)) return true;
        tx.db.ingestReplay.insert({ key: rk, expiresAt: realNow + BigInt(src.skewSeconds * 2) * 1_000_000n });
        return false;
      });
      if (replayed) return reject(409, 'REPLAYED', '');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return reject(400, 'INVALID_JSON', body);
    }
    const root = src.itemsPath ? lookup(payload, src.itemsPath) : payload;
    if (root === undefined) return reject(400, 'ITEMS_NOT_FOUND', body);
    const items = Array.isArray(root) ? root : root && typeof root === 'object' ? [root] : undefined;
    if (!items) return reject(400, 'ITEMS_NOT_FOUND', body);
    if (!items.length) return reject(400, 'NO_ITEMS', body);
    if (items.length > MAX_ITEMS) return reject(400, 'TOO_MANY_ITEMS', body);
    const results: IngestResult[] = items.map((item, index) => {
      try {
        return ctx.withTx(tx => ingestItem(tx, tx.db.newsSource.id.find(src.id) ?? src, newsSettings(tx), item, index));
      } catch (e) {
        return { index, externalId: '', status: 'failed', newsId: 0n, code: String((e as Error)?.message ?? e).slice(0, 100), notes: [] };
      }
    });
    const count = (st: string) => results.filter(r => r.status === st).length;
    const sum = { results, created: count('created'), updated: count('updated'), unchanged: count('unchanged'), ignored: count('ignored'), failed: count('failed') };
    const status = sum.created ? 'created' : sum.updated ? 'updated' : sum.failed && !sum.unchanged && !sum.ignored ? 'error' : sum.ignored && !sum.unchanged ? 'ignored' : 'unchanged';
    ctx.withTx(tx => {
      const row = tx.db.newsSource.id.find(src.id);
      if (row) tx.db.newsSource.id.update({ ...row, lastReceivedAt: realNow });
      writeLog(tx, src, s, status, 200, '', results, body);
      newsTick(tx);
    });
    return json(200, sum);
  });

  const publicState = (ctx: { withTx: <T>(f: (tx: PTx) => T) => T }, need: (s: Settings) => boolean, build: (tx: PTx, s: Settings, now: bigint) => SyncResponse) =>
    ctx.withTx(tx => {
      const s = tx.db.newsSettings.id.find(0);
      if (!s || !s.publicEnabled || !s.publicBaseUrl || !need(s)) return json(404, { code: 'NOT_FOUND' });
      return build(tx, s, nowUs(tx));
    });

  const publicList = (tx: PTx, s: Settings, now: bigint) => sortNews([...tx.db.news.status.filter('published')].filter(n => isLive(n, now) && !isExpired(n, now) && !n.noindex));

  const cache = (s: Settings) => ({ 'Cache-Control': `public, max-age=${s.publicCacheSeconds}` });

  const publicNews = st.httpHandler((ctx, req) =>
    publicState(ctx as never, () => true, (tx, s, now) => {
      const q = query(req.url);
      const lang = langList(tx).has(q.lang ?? '') ? q.lang! : defaultLang(tx);
      const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
      const offset = Math.max(Number(q.cursor) || 0, 0);
      const cat = q.category ? [...tx.db.category.byTypeKey.filter(['news', q.category])][0] : undefined;
      const tag = q.tag ? [...tx.db.tag.byTypeKey.filter(['news', q.tag])][0] ?? [...tx.db.tag.byTypeKey.filter(['general', q.tag])][0] : undefined;
      if ((q.category && !cat) || (q.tag && !tag)) return json(200, { lang, items: [], cursor: '' }, cache(s));
      const list = publicList(tx, s, now).filter(n => (!cat || n.categoryId === cat.id) && (!tag || n.tagIds.includes(tag.id)));
      const rows = list.slice(offset, offset + limit);
      return json(
        200,
        {
          lang,
          items: rows.map(n => ({ id: n.id, slug: n.slug, title: pick(n.title, lang, tx), summary: pick(n.summary, lang, tx), coverUrl: n.coverUrl, publishedAt: iso(n.publishedAt), url: articleUrl(s, n) })),
          cursor: offset + limit < list.length ? String(offset + limit) : '',
        },
        cache(s)
      );
    })
  );

  const publicArticle = st.httpHandler((ctx, req) =>
    publicState(ctx as never, () => true, (tx, s, now) => {
      const q = query(req.url);
      const lang = langList(tx).has(q.lang ?? '') ? q.lang! : defaultLang(tx);
      const n = tx.db.news.slug.find(toLatinDigits((q.slug ?? '').trim()).toLowerCase());
      if (!n || !isLive(n, now) || isExpired(n, now) || n.noindex) return json(404, { code: 'NOT_FOUND' });
      const seo = seoOf(n);
      return json(
        200,
        {
          lang,
          id: n.id,
          slug: n.slug,
          title: pick(n.title, lang, tx),
          summary: pick(n.summary, lang, tx),
          bodyHtml: pick(n.body, lang, tx),
          coverUrl: n.coverUrl,
          publishedAt: iso(n.publishedAt),
          url: articleUrl(s, n),
          tags: n.tagIds.map(id => tx.db.tag.id.find(id)?.key).filter(Boolean),
          seo: { metaTitle: pick(seo.metaTitle, lang, tx), metaDescription: pick(seo.metaDescription, lang, tx), keywords: seo.keywords, canonicalUrl: articleUrl(s, n), ogImage: seo.ogImage },
        },
        cache(s)
      );
    })
  );

  const publicSitemap = st.httpHandler(ctx =>
    publicState(ctx as never, () => true, (tx, s, now) => {
      const urls = publicList(tx, s, now)
        .slice(0, 50_000)
        .map(n => `<url><loc>${xmlEscape(articleUrl(s, n))}</loc><lastmod>${iso(n.updatedAt.microsSinceUnixEpoch > n.publishedAt ? n.updatedAt.microsSinceUnixEpoch : n.publishedAt)}</lastmod></url>`)
        .join('');
      return new SyncResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', ...cache(s) } });
    })
  );

  const publicRss = st.httpHandler((ctx, req) =>
    publicState(ctx as never, s => s.rssEnabled, (tx, s, now) => {
      const q = query(req.url);
      const lang = langList(tx).has(q.lang ?? '') ? q.lang! : defaultLang(tx);
      const brand = tx.db.brand.id.find(0);
      const title = pick(s.siteTitle, lang, tx) || (brand ? pick(brand.name, lang, tx) : '') || 'News';
      const items = publicList(tx, s, now)
        .slice(0, 50)
        .map(n => `<item><title>${xmlEscape(pick(n.title, lang, tx))}</title><link>${xmlEscape(articleUrl(s, n))}</link><guid isPermaLink="false">news-${n.id}</guid><pubDate>${new Date(Number(n.publishedAt / 1000n)).toUTCString()}</pubDate><description>${xmlEscape(pick(n.summary, lang, tx) || htmlToText(pick(n.body, lang, tx)).slice(0, 300))}</description></item>`)
        .join('');
      return new SyncResponse(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xmlEscape(title)}</title><link>${xmlEscape(s.publicBaseUrl)}</link><description>${xmlEscape(title)}</description><language>${xmlEscape(lang)}</language>${items}</channel></rss>`, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', ...cache(s) },
      });
    })
  );

  const publicationRoutes = st.httpRouter(
    new Router()
      .post('/publication/news/ingest', newsIngest)
      .get('/publication/public/news', publicNews)
      .get('/publication/public/article', publicArticle)
      .get('/publication/public/sitemap', publicSitemap)
      .get('/publication/public/rss', publicRss)
  );

  return {
    adminNews,
    adminNewsSettings,
    adminNewsSources,
    adminSaveNewsSettings,
    adminSaveNews,
    adminReviewNews,
    adminDeleteNews,
    adminSaveReactionType,
    adminDeleteReactionType,
    adminSaveNewsSource,
    adminDeleteNewsSource,
    adminIngestLog,
    adminNewsComments,
    adminModerateComment,
    adminDeleteComment,
    newsList,
    newsGet,
    newsBySlug,
    newsUnread,
    newsSeen,
    newsReact,
    newsComments,
    newsComment,
    newsCommentDelete,
    newsIngest,
    publicNews,
    publicArticle,
    publicSitemap,
    publicRss,
    publicationRoutes,
  };
}

