import { createHmac, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { DB, ECONOMY_QUERIES, GAMIFICATION_QUERIES, PLAYER_QUERIES, PUBLICATION_QUERIES, check, connect, done, errorOf, login, loginOwner, panelUser, sql, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const R = String(Date.now() % 10_000_000);
const k = (s: string) => `${s}_${R}`;
const QUERIES = [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES, ...PUBLICATION_QUERIES];
const c = (token?: string) => connect(token, QUERIES);
const rows = <T>(it: Iterable<T>) => [...it];
const HTTP = (process.env.STG_URI ?? 'ws://127.0.0.1:7500').replace(/^ws/, 'http');
const route = (path: string) => `${HTTP}/v1/database/${DB}/route${path}`;
const HOUR = 3600;
const DAY = 86400;

let o: Client;
let off = 0;
type SettingsArgs = Parameters<Client['conn']['reducers']['adminSavePublicationSettings']>[0];
type NewsSettingsArgs = Parameters<Client['conn']['reducers']['adminSaveNewsSettings']>[0];
type CampaignArgs = Parameters<Client['conn']['reducers']['adminSaveCampaign']>[0];
type RuleArgs = Parameters<Client['conn']['reducers']['adminSaveAutoRule']>[0];
type NewsArgs = Parameters<Client['conn']['reducers']['adminSaveNews']>[0];
type SourceArgs = Parameters<Client['conn']['reducers']['adminSaveNewsSource']>[0];

const DEFAULTS: SettingsArgs = {
  inboxKeepDays: 90,
  inboxMaxPerPlayer: 200,
  maxDevices: 10,
  devicePerMinute: 20,
  prefsPerMinute: 30,
  inboxPerMinute: 60,
  batchSize: 200,
  batchesPerTick: 5,
  capPerDay: 5,
  capPerWeek: 20,
  pushRetries: 3,
  smsMaxChars: 600,
  liveNoticeMinutes: 60,
  inactiveScanMinutes: 10,
};
const NEWS_DEFAULTS: NewsSettingsArgs = {
  commentsPerMinute: 5,
  reactionsPerMinute: 30,
  listPerMinute: 120,
  unreadScope: 'signup',
  showExpired: false,
  fillDefaultLang: true,
  realtimeOnPublish: true,
  notifyCategoryKey: 'news',
  logRetentionDays: 30,
  logPayloadBytes: 16384,
  ingestMaxKb: 256,
  slugStyle: 'native',
  publicEnabled: false,
  publicBaseUrl: '',
  publicPath: '/news/{slug}',
  rssEnabled: false,
  publicCacheSeconds: 300,
  siteTitle: [],
};

const gold = k('gold');
const bal = (cl: Client) => rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === gold)?.balance ?? 0n;
const inbox = (cl: Client) => rows(cl.conn.db.myInbox.iter());
const inboxOf = (cl: Client, campaignTitle: string) => inbox(cl).filter(i => i.title.some(t => t.text.includes(campaignTitle)));
const campaignRow = (id: bigint) => rows(o.conn.db.adminCampaigns.iter()).find(x => x.id === id);
const nowUs = (extraSec = 0) => BigInt(Date.now() + (off + extraSec) * 1000) * 1000n;
const tehranMinute = () => Math.floor(((Date.now() + off * 1000 + 3.5 * HOUR * 1000) % 86_400_000) / 60_000);

async function clock(sec: number) {
  off = sec;
  await o.conn.reducers.adminSetPublicationClockOffset({ seconds: BigInt(sec) });
  await waitFor(() => rows(o.conn.db.adminPublicationSettings.iter())[0]?.clockOffsetSec === BigInt(sec));
}
async function settings(p: Partial<SettingsArgs>) {
  const want = { ...DEFAULTS, ...p };
  await o.conn.reducers.adminSavePublicationSettings(want);
  await waitFor(() => {
    const s = rows(o.conn.db.adminPublicationSettings.iter())[0];
    return !!s && s.batchSize === want.batchSize && s.capPerDay === want.capPerDay && s.maxDevices === want.maxDevices;
  });
}
async function newsSettings(p: Partial<NewsSettingsArgs>) {
  const want = { ...NEWS_DEFAULTS, ...p };
  await o.conn.reducers.adminSaveNewsSettings(want);
  await waitFor(() => {
    const s = rows(o.conn.db.adminNewsSettings.iter())[0];
    return !!s && s.publicEnabled === want.publicEnabled && s.showExpired === want.showExpired && s.rssEnabled === want.rssEnabled && s.ingestMaxKb === want.ingestMaxKb;
  });
}
async function run(times = 1) {
  let last = { batches: 0, fires: 0, outbox: 0 };
  for (let i = 0; i < times; i++) last = await o.conn.procedures.adminPublicationRun();
  return last;
}
async function player(tags: bigint[] = []) {
  const p = await c();
  const r = await login(p, uniquePhone('0938'));
  if (tags.length) await o.conn.reducers.adminSetPlayerTags({ accountId: r.accountId, tagIds: tags });
  return { p, id: r.accountId };
}
async function userTag(key: string) {
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key, title: tr(key), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === key));
  return rows(o.conn.db.tag.iter()).find(x => x.key === key)!.id;
}
function campaignArgs(name: string, p: Partial<CampaignArgs>): CampaignArgs {
  return {
    id: 0n,
    name,
    categoryKey: k('promo'),
    channels: ['inbox'],
    title: tr(`${name} {player}`, `${name} en`),
    body: tr(`متن ${name}`),
    imageUrl: 'https://cdn.example.com/c.png',
    actionType: 'none',
    actionValue: '',
    actionLabel: [],
    prizeId: 0n,
    target: 'all',
    accountIds: [],
    tagIds: [],
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
    ...p,
  };
}
async function campaign(name: string, p: Partial<CampaignArgs>, send = true) {
  await o.conn.reducers.adminSaveCampaign(campaignArgs(name, p));
  await waitFor(() => rows(o.conn.db.adminCampaigns.iter()).some(x => x.name === name));
  const row = rows(o.conn.db.adminCampaigns.iter()).find(x => x.name === name)!;
  if (send) {
    await o.conn.reducers.adminSendCampaign({ id: row.id });
    await waitFor(() => campaignRow(row.id)?.status !== 'draft');
  }
  return row.id;
}
async function finish(id: bigint, max = 30) {
  for (let i = 0; i < max && campaignRow(id)?.status !== 'done'; i++) {
    await run();
    await waitFor(() => campaignRow(id)?.status === 'done', 300);
  }
  return campaignRow(id)!;
}
function ruleArgs(key: string, p: Partial<RuleArgs>): RuleArgs {
  return {
    id: 0n,
    key,
    name: key,
    trigger: 'event',
    eventKey: '',
    matchField: '',
    matchValue: '',
    inactiveDays: 0,
    categoryKey: 'rewards',
    channels: ['inbox'],
    title: tr(`${key} {player} {value}`),
    body: tr(`${key} body {mode}`),
    imageUrl: '',
    actionType: 'none',
    actionValue: '',
    actionLabel: [],
    prizeId: 0n,
    cooldownMinutes: 0,
    quietStart: 0,
    quietEnd: 0,
    isActive: true,
    ...p,
  };
}
function newsArgs(title: string, p: Partial<NewsArgs>): NewsArgs {
  return {
    id: 0n,
    slug: '',
    status: 'draft',
    categoryId: 0n,
    tagIds: [],
    title: tr(title, `${title} en`),
    summary: tr(`خلاصه ${title}`),
    body: tr(`<p>${title}</p>`),
    coverUrl: 'https://cdn.example.com/n.png',
    isPinned: false,
    publishedAt: 0n,
    expiresAt: 0n,
    allowComment: true,
    freeComment: false,
    allowReaction: true,
    notifyMode: 'none',
    notifyTagIds: [],
    metaTitle: [],
    metaDescription: [],
    keywords: [],
    canonicalUrl: '',
    ogImage: '',
    noindex: false,
    ...p,
  };
}
const newsRow = (title: string) => rows(o.conn.db.adminNews.iter()).find(n => n.title.some(t => t.text === title));
async function news(title: string, p: Partial<NewsArgs>) {
  await o.conn.reducers.adminSaveNews(newsArgs(title, p));
  await waitFor(() => !!newsRow(title));
  return newsRow(title)!;
}
function sourceArgs(key: string, p: Partial<SourceArgs>): SourceArgs {
  return {
    id: 0n,
    key,
    name: key,
    isActive: true,
    authMode: 'token',
    tokenHeader: '',
    signatureHeader: '',
    timestampHeader: '',
    skewSeconds: 300,
    secret: `secret-${key}-0123456789`,
    itemsPath: '',
    mapping: '',
    bodyFormat: 'auto',
    defaultCategoryId: 0n,
    defaultLang: 'fa',
    defaultTagIds: [],
    publishMode: 'review',
    updateMode: 'update',
    rateLimitPerMinute: 60,
    notifyMode: 'none',
    allowComment: false,
    allowReaction: true,
    ...p,
  };
}
const ingest = (key: string, body: string, headers: Record<string, string>) => fetch(route(`/publication/news/ingest?source=${key}`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

async function main() {
  o = await c();
  await loginOwner(o);
  await clock(0);
  await settings({});
  await newsSettings({});
  const op = await panelUser(o, 'operator', QUERIES);
  const oc = op.client;

  check('notification categories seeded', ['system', 'offers', 'rewards', 'reminders', 'news'].every(key => rows(o.conn.db.notifyCategory.iter()).some(x => x.key === key)));
  check('system category is mandatory', rows(o.conn.db.notifyCategory.iter()).find(x => x.key === 'system')?.mandatory === true);
  check('reaction types seeded', ['like', 'love', 'haha', 'wow', 'sad'].every(key => rows(o.conn.db.reactionType.iter()).some(x => x.key === key)));
  check('news and faq key types seeded', ['news', 'faq'].every(key => rows(o.conn.db.keyType.iter()).some(x => x.key === key)));
  await o.conn.reducers.adminSavePushConfig({ provider: 'log', serviceAccount: '' });
  check('push provider log is active', await waitFor(() => rows(o.conn.db.adminPushConfig.iter())[0]?.provider === 'log'));
  check('operator reads publication settings', rows(oc.conn.db.adminPublicationSettings.iter()).length === 1);
  check('operator cannot change publication settings', (await errorOf(oc.conn.reducers.adminSavePublicationSettings(DEFAULTS))).includes('FORBIDDEN'));
  check('settings are checked', (await errorOf(o.conn.reducers.adminSavePublicationSettings({ ...DEFAULTS, batchSize: 0 }))).includes('INVALID_SETTING:batchSize'));
  check('clock offset bounded', (await errorOf(o.conn.reducers.adminSetPublicationClockOffset({ seconds: 4000n * 86400n }))).includes('INVALID_CLOCK_OFFSET'));

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const sa = JSON.stringify({ type: 'service_account', project_id: `proj-${R}`, private_key_id: `kid${R}`, private_key: privateKey, client_email: `push@proj-${R}.iam.gserviceaccount.com`, token_uri: 'https://example.com/ignored' });
  check('bad service account refused', (await errorOf(o.conn.reducers.adminSavePushConfig({ provider: 'fcm', serviceAccount: '{"type":"service_account"}' }))).includes('INVALID_SERVICE_ACCOUNT'));
  check('service account without a real key refused', (await errorOf(o.conn.reducers.adminSavePushConfig({ provider: 'fcm', serviceAccount: JSON.stringify({ ...JSON.parse(sa), private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }) }))).includes('INVALID_SERVICE_ACCOUNT'));
  check('operator cannot save the push provider', (await errorOf(oc.conn.reducers.adminSavePushConfig({ provider: 'fcm', serviceAccount: sa }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminSavePushConfig({ provider: 'fcm', serviceAccount: sa });
  await waitFor(() => rows(o.conn.db.adminPushConfig.iter())[0]?.provider === 'fcm');
  await waitFor(() => rows(oc.conn.db.adminPushConfig.iter())[0]?.provider === 'fcm');
  const pc = rows(oc.conn.db.adminPushConfig.iter())[0];
  check('push config shows project, never the key', pc?.projectId === `proj-${R}` && pc.configured && pc.keyHint === '********' && !JSON.stringify(pc, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).includes('PRIVATE'), pc);
  const jp = await o.conn.procedures.adminPushJwtPreview();
  const [jh, jb, js] = jp.jwt.split('.');
  const header = JSON.parse(Buffer.from(jh, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(jb, 'base64url').toString());
  check('module JWT header is RS256 with key id', header.alg === 'RS256' && header.typ === 'JWT' && header.kid === `kid${R}`, header);
  check('module JWT claims target FCM', claims.iss === `push@proj-${R}.iam.gserviceaccount.com` && claims.scope === 'https://www.googleapis.com/auth/firebase.messaging' && claims.aud === 'https://oauth2.googleapis.com/token' && claims.exp - claims.iat === 3600, claims);
  check('module RS256 signature verifies with node crypto', createVerify('RSA-SHA256').update(`${jh}.${jb}`).verify(publicKey, Buffer.from(js, 'base64url')));
  check('module RS256 signature equals the node vector byte for byte', createSign('RSA-SHA256').update(`${jh}.${jb}`).sign(privateKey).toString('base64url') === js);
  check('operator cannot preview the JWT', (await errorOf(oc.conn.procedures.adminPushJwtPreview())).includes('FORBIDDEN'));
  await o.conn.reducers.adminSavePushConfig({ provider: 'log', serviceAccount: '' });
  await waitFor(() => rows(o.conn.db.adminPushConfig.iter())[0]?.provider === 'log');
  check('switching to log keeps the saved key', rows(o.conn.db.adminPushConfig.iter())[0]?.configured === true);

  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: gold, name: tr('طلا'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await o.conn.reducers.adminSavePrize({ id: 0n, key: k('gift'), name: tr('هدیه'), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: gold, action: 'add', value: 50 }] });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === k('gift')));
  const giftId = rows(o.conn.db.prize.iter()).find(x => x.key === k('gift'))!.id;

  await o.conn.reducers.adminSaveNotifyCategory({ id: 0n, key: k('promo'), name: tr('تبلیغ'), description: [], mandatory: false, defaultOn: true, isActive: true, sort: 10 });
  await waitFor(() => rows(o.conn.db.notifyCategory.iter()).some(x => x.key === k('promo')));
  check('operator cannot save categories', (await errorOf(oc.conn.reducers.adminSaveNotifyCategory({ id: 0n, key: k('x'), name: tr('x'), description: [], mandatory: false, defaultOn: true, isActive: true, sort: 0 }))).includes('FORBIDDEN'));
  check('a mandatory category must be on by default', (await errorOf(o.conn.reducers.adminSaveNotifyCategory({ id: 0n, key: k('bad'), name: tr('x'), description: [], mandatory: true, defaultOn: false, isActive: true, sort: 0 }))).includes('MANDATORY_MUST_BE_ON'));
  const sysId = rows(o.conn.db.notifyCategory.iter()).find(x => x.key === 'system')!.id;
  check('the system category cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteNotifyCategory({ id: sysId }))).includes('CATEGORY_LOCKED'));

  const tagA = await userTag(k('vip'));
  const tagB = await userTag(k('banned'));
  const P1 = await player([tagA]);
  const P2 = await player([tagA]);
  const P3 = await player([tagA]);
  const P4 = await player();
  const P5 = await player([tagA, tagB]);
  const [p1, p2, p3, p4, p5] = [P1.p, P2.p, P3.p, P4.p, P5.p];

  const t1 = `tok-${R}-p1-aaaaaaaaaaaaaaaa`;
  const r1 = await p1.conn.procedures.pushRegister({ token: t1, platform: 'android', appVersion: '1.2.3', deviceKey: 'd1' });
  check('push token registered', r1.active && r1.platform === 'android');
  await waitFor(() => rows(p1.conn.db.myPushDevices.iter()).length === 1);
  check('own devices view masks the token', rows(p1.conn.db.myPushDevices.iter())[0].token.includes('****') && !rows(p1.conn.db.myPushDevices.iter())[0].token.includes('p1-aaaa'));
  check('short token refused', (await errorOf(p1.conn.procedures.pushRegister({ token: 'short', platform: 'android', appVersion: '', deviceKey: '' }))).includes('INVALID_TOKEN'));
  check('token with spaces refused', (await errorOf(p1.conn.procedures.pushRegister({ token: 'a b c d e f g h i j k l m n', platform: 'android', appVersion: '', deviceKey: '' }))).includes('INVALID_TOKEN'));
  check('unknown platform refused', (await errorOf(p1.conn.procedures.pushRegister({ token: `tok-${R}-xxxxxxxxxxxxxxxxxxxx`, platform: 'symbian', appVersion: '', deviceKey: '' }))).includes('INVALID_PLATFORM'));
  await settings({ maxDevices: 3 });
  for (let i = 0; i < 3; i++) await p2.conn.procedures.pushRegister({ token: `tok-${R}-p2-${i}-bbbbbbbbbbbbbbbb`, platform: 'ios', appVersion: '2.0', deviceKey: `k${i}` });
  const over = await p2.conn.procedures.pushRegister({ token: `sandbox-dead-${R}-p2-cccccccccccc`, platform: 'web', appVersion: '2.0', deviceKey: 'k9' });
  check('a fourth device switches the oldest off', over.active && over.deactivated === 1, over);
  await waitFor(() => rows(p2.conn.db.myPushDevices.iter()).length === 4);
  check('the player keeps three active devices', rows(p2.conn.db.myPushDevices.iter()).filter(d => d.isActive).length === 3);
  check('a token of someone else cannot be removed', (await errorOf(p3.conn.reducers.pushUnregister({ token: t1 }))).includes('DEVICE_NOT_FOUND'));
  const t3 = `tok-${R}-p3-dddddddddddddddd`;
  await p3.conn.procedures.pushRegister({ token: t3, platform: 'android', appVersion: '', deviceKey: '' });
  await p3.conn.reducers.pushUnregister({ token: t3 });
  await waitFor(() => rows(p3.conn.db.myPushDevices.iter()).length === 0);
  check('push token unregistered', rows(p3.conn.db.myPushDevices.iter()).length === 0);
  await p3.conn.procedures.pushRegister({ token: t3, platform: 'android', appVersion: '', deviceKey: '' });
  const devs = await oc.conn.procedures.adminPushDevices({ accountId: P2.id });
  check('operator lists devices with masked tokens', devs.length === 4 && devs.every(d => d.token.includes('****')));
  await settings({});

  const prefs0 = await p1.conn.procedures.notifyPrefs();
  check('prefs list categories with channels', prefs0.some(x => x.key === k('promo') && x.channels.length === 3 && x.channels.every(ch => ch.enabled)) && prefs0.find(x => x.key === 'system')?.mandatory === true);
  await p1.conn.reducers.notifyPrefsSet({ prefs: [{ categoryKey: k('promo'), channel: 'push', enabled: false }] });
  await p3.conn.reducers.notifyPrefsSet({ prefs: [{ categoryKey: k('promo'), channel: 'push', enabled: false }, { categoryKey: k('promo'), channel: 'inbox', enabled: false }] });
  await waitFor(() => rows(p3.conn.db.myNotifyPrefs.iter()).length === 2);
  check('opt-out stored per category and channel', rows(p1.conn.db.myNotifyPrefs.iter()).length === 1 && rows(p1.conn.db.myNotifyPrefs.iter())[0].channel === 'push');
  check('a mandatory category cannot be turned off', (await errorOf(p1.conn.reducers.notifyPrefsSet({ prefs: [{ categoryKey: 'system', channel: 'inbox', enabled: false }] }))).includes('CATEGORY_LOCKED'));
  check('unknown category refused', (await errorOf(p1.conn.reducers.notifyPrefsSet({ prefs: [{ categoryKey: 'nope', channel: 'inbox', enabled: false }] }))).includes('CATEGORY_NOT_FOUND'));
  check('unknown channel refused', (await errorOf(p1.conn.reducers.notifyPrefsSet({ prefs: [{ categoryKey: k('promo'), channel: 'fax', enabled: false }] }))).includes('INVALID_CHANNEL'));
  const prefs1 = await p1.conn.procedures.notifyPrefs();
  check('prefs show the opt-out', prefs1.find(x => x.key === k('promo'))!.channels.find(ch => ch.channel === 'push')?.enabled === false);

  check('campaign target tags required', (await errorOf(o.conn.reducers.adminSaveCampaign(campaignArgs(k('bad1'), { target: 'tags' })))).includes('TARGET_TAGS_REQUIRED'));
  check('campaign channel checked', (await errorOf(o.conn.reducers.adminSaveCampaign(campaignArgs(k('bad2'), { channels: ['email'] })))).includes('INVALID_CHANNEL'));
  check('campaign category checked', (await errorOf(o.conn.reducers.adminSaveCampaign(campaignArgs(k('bad3'), { categoryKey: 'nope' })))).includes('CATEGORY_NOT_FOUND'));
  check('campaign schedule in the past refused', (await errorOf(o.conn.reducers.adminSaveCampaign(campaignArgs(k('bad4'), { schedule: 'at', scheduledAt: nowUs(-60) })))).includes('SCHEDULE_IN_PAST'));
  check('recurring campaign needs a repeat', (await errorOf(o.conn.reducers.adminSaveCampaign(campaignArgs(k('bad5'), { schedule: 'recurring', repeatMinutes: 5 })))).includes('INVALID_REPEAT'));
  check('quiet hours checked', (await errorOf(o.conn.reducers.adminSaveCampaign(campaignArgs(k('bad6'), { quietStart: 1500 })))).includes('INVALID_QUIET_HOURS'));
  check('operator cannot save campaigns', (await errorOf(oc.conn.reducers.adminSaveCampaign(campaignArgs(k('bad7'), {})))).includes('FORBIDDEN'));

  await settings({ batchSize: 2 });
  const cname = k('vipcamp');
  const camp = await campaign(cname, { target: 'tags', tagIds: [tagA], excludeTagIds: [tagB], channels: ['inbox', 'push'], prizeId: giftId }, false);
  const prev = await oc.conn.procedures.adminCampaignPreview({ id: camp });
  check('campaign preview counts the tagged audience', prev.targeted === 3 && prev.optedOut === 1 && prev.withPush === 3 && prev.withPhone === 3, prev);
  check('operator cannot send campaigns', (await errorOf(oc.conn.reducers.adminSendCampaign({ id: camp }))).includes('FORBIDDEN'));
  await o.conn.reducers.adminSendCampaign({ id: camp });
  await waitFor(() => campaignRow(camp)?.status !== 'draft');
  const cr = await finish(camp);
  check('batched campaign finished in several batches', cr.status === 'done' && cr.batches >= 2, { status: cr.status, batches: cr.batches });
  check('campaign counts the tagged audience', cr.recipients === 3 && cr.sent === 2 && cr.skipped === 1 && cr.inboxCount === 2, cr);
  const dl = await oc.conn.procedures.adminCampaignDeliveries({ campaignId: camp, status: '', page: 1, pageSize: 50 });
  const dOf = (id: bigint) => dl.rows.find(r => r.accountId === id);
  check('delivery log: p3 opted out of both channels', dOf(P3.id)?.status === 'skipped' && dOf(P3.id)?.reason === 'opted_out', dl.rows);
  check('delivery log: p1 got the inbox only', dOf(P1.id)?.status === 'sent' && dOf(P1.id)!.channels.join(',') === 'inbox');
  check('delivery log: p2 got inbox and push', dOf(P2.id)!.channels.join(',') === 'inbox,push');
  check('excluded and untagged players are not recipients', !dOf(P4.id) && !dOf(P5.id) && dl.total === 3);
  await waitFor(() => inboxOf(p2, cname).length === 1 && inboxOf(p1, cname).length === 1);
  check('inbox view shows the campaign', inboxOf(p2, cname)[0]?.prizeId === giftId && !inboxOf(p2, cname)[0].read && inboxOf(p4, cname).length === 0 && inboxOf(p5, cname).length === 0 && inboxOf(p3, cname).length === 0);
  check('player name filled into the title', inboxOf(p2, cname)[0].title.find(t => t.lang === 'fa')!.text.includes(String(P2.id)) || inboxOf(p2, cname)[0].title.find(t => t.lang === 'fa')!.text.length > cname.length + 1);
  await run(2);
  await waitFor(() => (campaignRow(camp)?.pushSent ?? 0) >= 2);
  const log = await oc.conn.procedures.adminPushLog({ accountId: P2.id, page: 1, pageSize: 50 });
  check('log provider delivered to the active devices', log.rows.filter(l => l.status === 'sent' && l.provider === 'log').length === 2 && log.rows.some(l => l.status === 'dead'), log.rows.map(l => l.status));
  check('push log masks tokens', log.rows.every(l => l.token.includes('****')));
  await waitFor(() => !rows(p2.conn.db.myPushDevices.iter()).some(d => d.token.startsWith('sandbo')));
  check('a dead token is removed', rows(p2.conn.db.myPushDevices.iter()).length === 3 && !rows(p2.conn.db.myPushDevices.iter()).some(d => d.token.startsWith('sandbo')));
  check('campaign counts push devices', campaignRow(camp)!.pushSent === 2 && campaignRow(camp)!.pushFailed === 1, campaignRow(camp));
  const ob = await oc.conn.procedures.adminOutbox({ accountId: 0n, campaignId: camp, page: 1, pageSize: 10 });
  check('outbox row for p2 is sent', ob.rows.length === 1 && ob.rows[0].status === 'sent' && ob.rows[0].sent === 2, ob.rows);

  const e1 = inboxOf(p1, cname)[0];
  check('an unclaimed prize cannot be deleted', (await errorOf(p1.conn.reducers.inboxDelete({ ids: [e1.id] }))).includes('PRIZE_NOT_CLAIMED'));
  const e2 = inboxOf(p2, cname)[0];
  const before = bal(p2);
  const cl1 = await p2.conn.procedures.inboxClaim({ id: e2.id });
  await waitFor(() => bal(p2) === before + 50n);
  check('inbox claim grants the prize', !cl1.already && cl1.rewards.length === 1 && cl1.rewards[0].value === 50 && bal(p2) === before + 50n, cl1);
  const cl2 = await p2.conn.procedures.inboxClaim({ id: e2.id });
  await new Promise(r => setTimeout(r, 300));
  check('a second claim grants nothing more', cl2.already && cl2.rewards.length === 1 && bal(p2) === before + 50n, { cl2, bal: bal(p2) });
  await waitFor(() => inboxOf(p2, cname)[0]?.claimed === true);
  check('claimed and read in the view', inboxOf(p2, cname)[0].claimed && inboxOf(p2, cname)[0].read);
  check('claim of another player refused', (await errorOf(p1.conn.procedures.inboxClaim({ id: e2.id }))).includes('NOT_FOUND'));
  await p1.conn.reducers.inboxRead({ ids: [e1.id], all: false });
  await waitFor(() => inboxOf(p1, cname)[0]?.read === true);
  await waitFor(() => (campaignRow(camp)?.opened ?? 0) >= 2);
  check('read counts as opened once', campaignRow(camp)!.opened === 2, campaignRow(camp)?.opened);
  await p2.conn.reducers.inboxDelete({ ids: [e2.id] });
  await waitFor(() => inboxOf(p2, cname).length === 0);
  check('a claimed message can be deleted', inboxOf(p2, cname).length === 0);
  await settings({});

  const mname = k('mand');
  const mand = await campaign(mname, { categoryKey: 'system', target: 'players', accountIds: [P3.id] });
  await finish(mand);
  await waitFor(() => inboxOf(p3, mname).length === 1);
  check('a mandatory category reaches a player who opted out of others', inboxOf(p3, mname).length === 1);

  await settings({ capPerDay: 2, capPerWeek: 10 });
  const caps: string[] = [];
  for (let i = 0; i < 3; i++) {
    const name = k(`cap${i}`);
    const id = await campaign(name, { target: 'players', accountIds: [P4.id] });
    await finish(id);
    const d = await oc.conn.procedures.adminCampaignDeliveries({ campaignId: id, status: '', page: 1, pageSize: 5 });
    caps.push(`${d.rows[0]?.status}:${d.rows[0]?.reason}`);
  }
  check('frequency cap stops the third message of the day', caps.join(',') === 'sent:,sent:,skipped:cap', caps);
  const mc = await campaign(k('capsys'), { categoryKey: 'system', target: 'players', accountIds: [P4.id] });
  await finish(mc);
  check('mandatory messages ignore the cap', (await oc.conn.procedures.adminCampaignDeliveries({ campaignId: mc, status: 'sent', page: 1, pageSize: 5 })).total === 1);
  await settings({});

  const m = tehranMinute();
  const qname = k('quiet');
  const quiet = await campaign(qname, { target: 'players', accountIds: [P5.id], quietStart: (m - 10 + 1440) % 1440, quietEnd: (m + 60) % 1440 });
  await run(2);
  await new Promise(r => setTimeout(r, 300));
  check('quiet hours hold the campaign', campaignRow(quiet)!.status === 'scheduled' && campaignRow(quiet)!.recipients === 0 && campaignRow(quiet)!.nextAt > nowUs(), campaignRow(quiet));
  await clock(2 * HOUR);
  const qd = await finish(quiet);
  await waitFor(() => inboxOf(p5, qname).length === 1);
  check('the campaign goes out after quiet hours', qd.status === 'done' && inboxOf(p5, qname).length === 1);
  await clock(0);

  const sname = k('later');
  const later = await campaign(sname, { target: 'players', accountIds: [P5.id], schedule: 'at', scheduledAt: nowUs(HOUR) });
  await run();
  await new Promise(r => setTimeout(r, 300));
  check('a scheduled campaign waits for its time', campaignRow(later)!.status === 'scheduled' && inboxOf(p5, sname).length === 0);
  await clock(HOUR + 60);
  await finish(later);
  await waitFor(() => inboxOf(p5, sname).length === 1);
  check('a scheduled campaign goes out at its time', inboxOf(p5, sname).length === 1);
  await clock(0);

  const rname = k('repeat');
  const rep = await campaign(rname, { categoryKey: 'system', target: 'players', accountIds: [P5.id], schedule: 'recurring', repeatMinutes: 60 });
  for (let i = 0; i < 5 && (campaignRow(rep)?.run ?? 0) < 1; i++) {
    await run();
    await waitFor(() => (campaignRow(rep)?.run ?? 0) >= 1, 300);
  }
  check('a recurring campaign is rescheduled after a run', campaignRow(rep)!.status === 'scheduled' && campaignRow(rep)!.run === 1 && campaignRow(rep)!.sent === 1, campaignRow(rep));
  await clock(HOUR + 60);
  for (let i = 0; i < 5 && (campaignRow(rep)?.sent ?? 0) < 2; i++) {
    await run();
    await waitFor(() => (campaignRow(rep)?.sent ?? 0) >= 2, 300);
  }
  await waitFor(() => inboxOf(p5, rname).length === 2);
  check('a recurring campaign sends again on the next run', campaignRow(rep)!.sent === 2 && inboxOf(p5, rname).length === 2);
  await o.conn.reducers.adminCancelCampaign({ id: rep });
  await waitFor(() => campaignRow(rep)?.status === 'cancelled');
  check('a recurring campaign can be cancelled', campaignRow(rep)!.status === 'cancelled');
  check('a cancelled campaign cannot be cancelled again', (await errorOf(o.conn.reducers.adminCancelCampaign({ id: rep }))).includes('NOT_CANCELLABLE'));
  await clock(0);

  const tname = k('tick');
  const tick = await campaign(tname, { categoryKey: 'system', target: 'players', accountIds: [P4.id] });
  check('the scheduled worker sends without a manual run', await waitFor(() => campaignRow(tick)?.status === 'done', 15000));

  const smsName = k('sms');
  const smsc = await campaign(smsName, { categoryKey: 'system', target: 'players', accountIds: [P4.id], channels: ['sms'] });
  await finish(smsc);
  await run(2);
  await waitFor(() => (campaignRow(smsc)?.smsSent ?? 0) === 1, 5000);
  const phone4 = rows(p4.conn.db.me.iter())[0].phone;
  const smsRows = sql(`SELECT text FROM base_sandbox_sms WHERE phone = '${phone4}'`);
  check('sms channel goes through the sandbox provider', campaignRow(smsc)!.smsSent === 1 && smsRows.includes(smsName), smsRows);

  const test1 = await o.conn.procedures.adminTestNotification({ accountId: P3.id, categoryKey: k('promo'), channels: ['inbox', 'push'], title: tr(k('testmsg')), body: tr('x'), imageUrl: '', actionType: 'url', actionValue: 'https://example.com/a', actionLabel: tr('باز کن'), prizeId: 0n });
  check('test send ignores the player choice', test1 === 'sent:inbox,push', test1);
  check('action url checked', (await errorOf(o.conn.procedures.adminTestNotification({ accountId: P3.id, categoryKey: k('promo'), channels: ['inbox'], title: tr('x'), body: tr('x'), imageUrl: '', actionType: 'url', actionValue: 'javascript:alert(1)', actionLabel: [], prizeId: 0n }))).includes('INVALID_URL'));

  const evKey = k('boss');
  await o.conn.reducers.adminSaveEventType({ id: 0n, key: evKey, name: tr(evKey), description: [], clientAllowed: true, valueMin: 0, valueMax: 1000, rateLimit: 0, isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.eventType.iter()).some(x => x.key === evKey));
  check('rule event type checked', (await errorOf(o.conn.reducers.adminSaveAutoRule(ruleArgs(k('r0'), { eventKey: 'nope' })))).includes('EVENT_TYPE_NOT_FOUND'));
  check('rule trigger checked', (await errorOf(o.conn.reducers.adminSaveAutoRule(ruleArgs(k('r0'), { trigger: 'moon' })))).includes('INVALID_TRIGGER'));
  const rk = k('bossrule');
  await o.conn.reducers.adminSaveAutoRule(ruleArgs(rk, { eventKey: evKey, matchField: 'mode', matchValue: 'hard', cooldownMinutes: 60 }));
  await waitFor(() => rows(o.conn.db.adminAutoRules.iter()).some(x => x.key === rk));
  const ruleId = rows(o.conn.db.adminAutoRules.iter()).find(x => x.key === rk)!.id;
  await p4.conn.procedures.recordEvent({ key: evKey, value: 7, metadata: '{"mode":"easy"}' });
  await p4.conn.procedures.recordEvent({ key: evKey, value: 9, metadata: '{"mode":"hard"}' });
  await run();
  await waitFor(() => inbox(p4).some(i => i.title.some(t => t.text.startsWith(rk))));
  const autoMsg = inbox(p4).find(i => i.title.some(t => t.text.startsWith(rk)))!;
  check('an automatic notification follows the event', autoMsg.kind === 'auto' && autoMsg.title[0].text.endsWith(' 9') && autoMsg.body[0].text === `${rk} body hard`, autoMsg);
  await p4.conn.procedures.recordEvent({ key: evKey, value: 11, metadata: '{"mode":"hard"}' });
  await run();
  const fires = await oc.conn.procedures.adminAutoFires({ ruleId, status: '', page: 1, pageSize: 20 });
  check('match field filters events', fires.total === 2, fires.rows);
  check('cooldown skips the second fire', fires.rows.some(f => f.status === 'skipped' && f.reason === 'cooldown') && fires.rows.some(f => f.status === 'sent'), fires.rows.map(f => `${f.status}:${f.reason}`));
  check('only one automatic message reached the inbox', inbox(p4).filter(i => i.title.some(t => t.text.startsWith(rk))).length === 1);

  const fk = k('welcome');
  await o.conn.reducers.adminSaveAutoRule(ruleArgs(fk, { trigger: 'first_login', title: tr(`${fk} {player}`), body: tr('خوش آمدی') }));
  await waitFor(() => rows(o.conn.db.adminAutoRules.iter()).some(x => x.key === fk));
  const P6 = await player();
  await run();
  check('first login sends the welcome rule', await waitFor(() => inbox(P6.p).some(i => i.title.some(t => t.text.startsWith(fk)))));
  await o.conn.reducers.adminSaveAutoRule({ ...ruleArgs(fk, { trigger: 'first_login' }), id: rows(o.conn.db.adminAutoRules.iter()).find(x => x.key === fk)!.id, isActive: false });

  const ik = k('miss');
  await o.conn.reducers.adminSaveAutoRule(ruleArgs(ik, { trigger: 'inactive', inactiveDays: 3, categoryKey: 'reminders', title: tr(`${ik} {days}`), body: tr('برگرد') }));
  await waitFor(() => rows(o.conn.db.adminAutoRules.iter()).some(x => x.key === ik));
  const ikId = rows(o.conn.db.adminAutoRules.iter()).find(x => x.key === ik)!.id;
  await clock(3 * DAY + HOUR);
  for (let i = 0; i < 40 && !inbox(P6.p).some(x => x.title.some(t => t.text === `${ik} 3`)); i++) {
    await run();
    await waitFor(() => inbox(P6.p).some(x => x.title.some(t => t.text === `${ik} 3`)), 200);
  }
  check('inactive players get the reminder rule', inbox(P6.p).some(x => x.title.some(t => t.text === `${ik} 3`)));
  await o.conn.reducers.adminSaveAutoRule({ ...ruleArgs(ik, { trigger: 'inactive', inactiveDays: 3, categoryKey: 'reminders' }), id: ikId, isActive: false });
  await clock(0);

  const newsCatKey = k('ncat');
  await o.conn.reducers.adminSaveCategory({ id: 0n, keyType: 'news', key: newsCatKey, title: tr('اطلاعیه'), description: [], parentId: 0n, iconUrl: '', sort: 0, isActive: true });
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'news', key: k('ntag'), title: tr('رویداد'), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.category.iter()).some(x => x.key === newsCatKey) && rows(o.conn.db.tag.iter()).some(x => x.key === k('ntag')));
  const newsCat = rows(o.conn.db.category.iter()).find(x => x.key === newsCatKey)!.id;
  const newsTag = rows(o.conn.db.tag.iter()).find(x => x.key === k('ntag'))!.id;

  const dirty = '<p onclick="steal()">سلام<script>alert(1)</script></p><a href="javascript:alert(1)">bad</a><a href=" JaVa&#x53;cript:alert(2)">bad2</a><img src=x onerror=alert(3)><a href="https://example.com" onmouseover="x()">ok</a><p style="text-align: center">c</p><iframe src="https://evil"></iframe>';
  const title1 = `خبر تازه ${R}`;
  const n1 = await news(title1, { body: tr(dirty), categoryId: newsCat, tagIds: [newsTag] });
  const clean = n1.body[0].text;
  check('sanitiser drops scripts', !clean.includes('script') && !clean.includes('alert(1)') && clean.includes('سلام'), clean);
  check('sanitiser drops on* attributes', !/on(click|error|mouseover)/i.test(clean), clean);
  check('sanitiser drops javascript: urls', !/javascript/i.test(clean) && clean.includes('href="https://example.com"'), clean);
  check('sanitiser drops images and frames', !clean.includes('<img') && !clean.includes('iframe'), clean);
  check('sanitiser keeps allowed alignment and forces safe links', clean.includes('<p style="text-align: center">c</p>') && clean.includes('rel="noopener noreferrer nofollow"'), clean);
  check('slug made from the Persian title', n1.slug === `خبر-تازه-${R}`, n1.slug);
  check('a taken slug is refused', (await errorOf(o.conn.reducers.adminSaveNews(newsArgs(`other ${R}`, { slug: n1.slug })))).includes('SLUG_EXISTS'));
  check('a bad slug is refused', (await errorOf(o.conn.reducers.adminSaveNews(newsArgs(`other ${R}`, { slug: 'a b!' })))).includes('INVALID_SLUG'));
  check('operator cannot write news', (await errorOf(oc.conn.reducers.adminSaveNews(newsArgs(`op ${R}`, {})))).includes('FORBIDDEN'));
  check('operator reads news', rows(oc.conn.db.adminNews.iter()).some(n => n.id === n1.id));
  const listed = async (cl: Client, id: bigint, p: Partial<Parameters<Client['conn']['procedures']['newsList']>[0]> = {}) =>
    (await cl.conn.procedures.newsList({ page: 1, pageSize: 100, categoryKey: '', tagKeys: [], tagMode: 'any', expired: 'exclude', unreadOnly: false, includeSeo: false, ...p })).items.find(x => x.id === id);
  check('a draft is hidden from players', !(await listed(p1, n1.id)));
  check('draft cannot be rejected directly', (await errorOf(o.conn.reducers.adminSaveNews({ ...newsArgs(title1, { body: tr(dirty) }), id: n1.id, status: 'rejected' }))).includes('USE_REVIEW'));
  await o.conn.reducers.adminReviewNews({ ids: [n1.id], status: 'pending_review', reason: '' });
  await waitFor(() => newsRow(title1)?.status === 'pending_review');
  check('pending review is hidden', !(await listed(p1, n1.id)));
  check('reject needs a reason', (await errorOf(o.conn.reducers.adminReviewNews({ ids: [n1.id], status: 'rejected', reason: '' }))).includes('REASON_REQUIRED'));
  await o.conn.reducers.adminSaveNews({ ...newsArgs(title1, { body: tr(dirty), categoryId: newsCat, tagIds: [newsTag] }), id: n1.id, status: 'pending_review', notifyMode: 'inbox' });
  const noticesBefore = rows(p1.conn.db.liveNotice.iter()).filter(x => x.newsId === n1.id).length;
  await o.conn.reducers.adminReviewNews({ ids: [n1.id], status: 'published', reason: '' });
  await waitFor(() => newsRow(title1)?.status === 'published');
  check('approved news is visible', !!(await listed(p1, n1.id)));
  await waitFor(() => rows(p1.conn.db.liveNotice.iter()).some(x => x.newsId === n1.id));
  check('a live notice goes out when the article becomes visible', noticesBefore === 0 && rows(p1.conn.db.liveNotice.iter()).filter(x => x.newsId === n1.id && x.event === 'news_published').length === 1);
  check('published news cannot go back to review', (await errorOf(o.conn.reducers.adminReviewNews({ ids: [n1.id], status: 'pending_review', reason: '' }))).includes('INVALID_TRANSITION'));
  const newsCampaign = newsRow(title1)!.campaignId;
  check('publishing creates one news campaign', newsCampaign > 0n);
  await finish(newsCampaign, 60);
  await waitFor(() => inbox(p1).some(i => i.newsId === n1.id));
  check('the news notice reaches the inbox with a news action', inbox(p1).some(i => i.newsId === n1.id && i.actionType === 'news' && i.actionValue === String(n1.id) && i.categoryKey === 'news'));
  await o.conn.reducers.adminReviewNews({ ids: [n1.id], status: 'archived', reason: '' });
  await waitFor(() => newsRow(title1)?.status === 'archived');
  check('archived news is hidden', !(await listed(p1, n1.id)));
  await o.conn.reducers.adminReviewNews({ ids: [n1.id], status: 'published', reason: '' });
  await waitFor(() => newsRow(title1)?.status === 'published');
  await run();
  await new Promise(r => setTimeout(r, 300));
  check('republishing sends no second notice', rows(p1.conn.db.liveNotice.iter()).filter(x => x.newsId === n1.id).length === 1 && newsRow(title1)!.campaignId === newsCampaign);

  const full = await p1.conn.procedures.newsGet({ id: n1.id });
  check('article has body, tags, category and seo fallbacks', full.body[0].text === clean && full.tags[0]?.key === k('ntag') && full.categoryKey === newsCatKey && full.seo?.metaTitle[0].text === title1 && full.seo.ogImage === 'https://cdn.example.com/n.png' && full.seo.metaDescription[0].text.startsWith('خلاصه'), full.seo);
  check('article by slug', (await p1.conn.procedures.newsBySlug({ slug: n1.slug })).id === n1.id);
  check('list filters by category and tag', !!(await listed(p1, n1.id, { categoryKey: newsCatKey, tagKeys: [k('ntag')] })) && !(await listed(p1, n1.id, { tagKeys: [k('ntag'), 'nope'], tagMode: 'all' })));

  const u0 = await p2.conn.procedures.newsUnread({ categoryKey: '' });
  check('unread counts the visible article', u0 >= 1 && (await listed(p2, n1.id))?.seen === false);
  const u1 = await p2.conn.procedures.newsSeen({ ids: [n1.id], all: false });
  check('seen lowers unread', u1 === u0 - 1 && (await listed(p2, n1.id))?.seen === true, { u0, u1 });
  check('unread-only hides seen articles', !(await listed(p2, n1.id, { unreadOnly: true })));
  const u2 = await p2.conn.procedures.newsSeen({ ids: [], all: true });
  check('seen all clears unread', u2 === 0);

  const re1 = await p1.conn.procedures.newsReact({ newsId: n1.id, reaction: 'like' });
  await p2.conn.procedures.newsReact({ newsId: n1.id, reaction: 'like' });
  const re2 = await p2.conn.procedures.newsReact({ newsId: n1.id, reaction: 'love' });
  check('reactions counted per player', re1.myReaction === 'like' && re2.reactionCount === 2 && re2.myReaction === 'love' && re2.reactions.find(r => r.key === 'like')?.count === 1, re2);
  const re3 = await p2.conn.procedures.newsReact({ newsId: n1.id, reaction: '' });
  check('an empty reaction removes it', re3.reactionCount === 1 && re3.myReaction === '');
  check('unknown reaction refused', (await errorOf(p1.conn.procedures.newsReact({ newsId: n1.id, reaction: 'angry' }))).includes('REACTION_NOT_FOUND'));
  await o.conn.reducers.adminSaveReactionType({ key: 'angry', emoji: '😡', name: tr('عصبانی'), isActive: false, sort: 9 });
  check('inactive reaction refused', (await errorOf(p1.conn.procedures.newsReact({ newsId: n1.id, reaction: 'angry' }))).includes('REACTION_NOT_FOUND'));
  check('a reaction in use cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteReactionType({ key: 'like' }))).includes('IN_USE'));
  await o.conn.reducers.adminDeleteReactionType({ key: 'angry' });
  check('list carries reactions', (await listed(p2, n1.id))?.reactionCount === 1);

  const cm = await p1.conn.procedures.newsComment({ newsId: n1.id, message: 'نظر من', parentId: 0n });
  check('a comment waits for moderation', cm.status === 'pending');
  check('others do not see a pending comment', (await p2.conn.procedures.newsComments({ newsId: n1.id, page: 1, pageSize: 20 })).rows.every(r => r.id !== cm.id));
  check('the author sees the pending comment', (await p1.conn.procedures.newsComments({ newsId: n1.id, page: 1, pageSize: 20 })).rows.some(r => r.id === cm.id && r.mine));
  check('empty comment refused', (await errorOf(p1.conn.procedures.newsComment({ newsId: n1.id, message: '  ', parentId: 0n }))).includes('INVALID_MESSAGE'));
  const pend = await oc.conn.procedures.adminNewsComments({ newsId: n1.id, status: 'pending', page: 1, pageSize: 20 });
  check('operator lists pending comments', pend.rows.some(r => r.id === cm.id));
  check('a player cannot moderate', (await errorOf(p2.conn.reducers.adminModerateComment({ id: cm.id, accept: true }))).includes('FORBIDDEN'));
  await oc.conn.reducers.adminModerateComment({ id: cm.id, accept: true });
  check('an accepted comment is public', (await p2.conn.procedures.newsComments({ newsId: n1.id, page: 1, pageSize: 20 })).rows.some(r => r.id === cm.id && !r.mine));
  const reply = await p2.conn.procedures.newsComment({ newsId: n1.id, message: 'پاسخ', parentId: cm.id });
  const reply2 = await p1.conn.procedures.newsComment({ newsId: n1.id, message: 'پاسخ دوم', parentId: reply.id });
  check('a reply to a reply attaches to the root', reply.parentId === cm.id && reply2.parentId === cm.id);
  await oc.conn.reducers.adminDeleteComment({ id: reply.id });
  check('operator deletes a comment', (await oc.conn.procedures.adminNewsComments({ newsId: n1.id, status: '', page: 1, pageSize: 20 })).rows.every(r => r.id !== reply.id));
  await p1.conn.reducers.newsCommentDelete({ id: reply2.id });
  check('a player deletes an own comment', (await p1.conn.procedures.newsComments({ newsId: n1.id, page: 1, pageSize: 20 })).rows.every(r => r.id !== reply2.id));
  check('list counts accepted comments', (await listed(p2, n1.id))?.commentCount === 1);

  const title2 = `آینده ${R}`;
  const n2 = await news(title2, { status: 'published', publishedAt: nowUs(HOUR), expiresAt: nowUs(3 * HOUR), allowReaction: false, allowComment: false });
  check('future publish time hides the article', !(await listed(p1, n2.id)) && (await errorOf(p1.conn.procedures.newsGet({ id: n2.id }))).includes('NEWS_NOT_FOUND'));
  check('no live notice before it is visible', !rows(p1.conn.db.liveNotice.iter()).some(x => x.newsId === n2.id));
  await clock(2 * HOUR);
  check('the article shows once its time comes', !!(await listed(p1, n2.id)));
  await run();
  check('its live notice goes out then', await waitFor(() => rows(p1.conn.db.liveNotice.iter()).some(x => x.newsId === n2.id)));
  check('reactions can be switched off', (await errorOf(p1.conn.procedures.newsReact({ newsId: n2.id, reaction: 'like' }))).includes('REACTION_NOT_ALLOWED'));
  check('comments can be switched off', (await errorOf(p1.conn.procedures.newsComment({ newsId: n2.id, message: 'x', parentId: 0n }))).includes('COMMENTS_CLOSED'));
  await clock(4 * HOUR);
  check('an ended article is hidden', !(await listed(p1, n2.id)) && !(await listed(p1, n2.id, { expired: 'include' })));
  check('an ended article takes no reactions', (await errorOf(p1.conn.procedures.newsReact({ newsId: n2.id, reaction: 'like' }))).includes('NEWS_EXPIRED'));
  await newsSettings({ showExpired: true });
  const ex = await listed(p1, n2.id, { expired: 'only' });
  check('ended articles can be listed when the admin allows', ex?.expired === true && !(await listed(p1, n1.id, { expired: 'only' })));
  await newsSettings({});
  await clock(0);
  check('end must follow the start', (await errorOf(o.conn.reducers.adminSaveNews(newsArgs(`w ${R}`, { publishedAt: nowUs(HOUR), expiresAt: nowUs(60) })))).includes('INVALID_WINDOW'));

  const tokKey = k('wire');
  await o.conn.reducers.adminSaveNewsSource(sourceArgs(tokKey, { mapping: JSON.stringify({ title: 'headline', body: 'content.html', externalId: 'guid', cover: 'media', tags: 'labels' }), defaultCategoryId: newsCat }));
  check('source secret must be long', (await errorOf(o.conn.reducers.adminSaveNewsSource(sourceArgs(k('s2'), { secret: 'short' })))).includes('SECRET_TOO_SHORT'));
  check('source mapping fields checked', (await errorOf(o.conn.reducers.adminSaveNewsSource(sourceArgs(k('s3'), { mapping: '{"nope":"x"}' })))).includes('INVALID_MAPPING'));
  await waitFor(() => rows(o.conn.db.adminNewsSources.iter()).some(x => x.key === tokKey));
  const srcInfo = rows(oc.conn.db.adminNewsSources.iter()).find(x => x.key === tokKey)!;
  check('source secret is never returned', srcInfo.secretHint === '****6789' && !JSON.stringify(srcInfo, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).includes(`secret-${tokKey}`));
  const secret = `secret-${tokKey}-0123456789`;
  const item = { guid: `g-${R}`, headline: `وایر ${R}`, content: { html: '<p>متن<script>x()</script></p>' }, media: { image: { url: 'https://cdn.example.com/w.png' } }, labels: [k('ntag'), 'unknown_tag'], lang: 'fa-IR' };
  const noAuth = await ingest(tokKey, JSON.stringify(item), {});
  check('ingest without a token is 401', noAuth.status === 401 && (await noAuth.json()).code === 'INVALID_TOKEN');
  const badTok = await ingest(tokKey, JSON.stringify(item), { 'X-News-Token': 'wrong-token-wrong-token' });
  check('ingest with a wrong token is 401', badTok.status === 401);
  const ok1 = await ingest(tokKey, JSON.stringify(item), { 'X-News-Token': secret });
  const j1 = await ok1.json();
  check('ingest with a token creates the article', ok1.status === 200 && j1.created === 1 && j1.results[0].status === 'created', j1);
  check('unknown tags are noted', j1.results[0].notes.includes('TAGS_UNKNOWN'), j1.results[0]);
  await waitFor(() => rows(o.conn.db.adminNews.iter()).some(n => n.source === `webhook:${tokKey}`));
  const wire = rows(o.conn.db.adminNews.iter()).find(n => n.source === `webhook:${tokKey}`);
  check('ingested article waits for review, cleaned and mapped', !!wire && wire.status === 'pending_review' && !wire.body[0].text.includes('script') && wire.coverUrl === 'https://cdn.example.com/w.png' && wire.tagIds.includes(newsTag) && wire.categoryId === newsCat && wire.lang === 'fa', wire);
  const dup = await (await ingest(tokKey, JSON.stringify(item), { 'X-News-Token': secret })).json();
  check('same content is unchanged', dup.unchanged === 1 && dup.results[0].newsId === j1.results[0].newsId, dup);
  const upd = await (await ingest(tokKey, JSON.stringify({ ...item, content: { html: '<p>نسخه دوم</p>' } }), { 'X-News-Token': secret })).json();
  check('new content for the same id updates the article', upd.updated === 1 && upd.results[0].newsId === j1.results[0].newsId, upd);
  await waitFor(() => rows(o.conn.db.adminNews.iter()).find(n => n.id === wire!.id)?.body[0].text === '<p>نسخه دوم</p>');
  check('update keeps the review status', rows(o.conn.db.adminNews.iter()).find(n => n.id === wire!.id)?.status === 'pending_review');
  const noTitle = await (await ingest(tokKey, JSON.stringify([{ guid: 'x' }, { ...item, guid: `g2-${R}` }]), { 'X-News-Token': secret })).json();
  check('items without a title fail alone', noTitle.failed === 1 && noTitle.created === 1 && noTitle.results[0].code === 'ITEM_TITLE_REQUIRED', noTitle);
  const big = await ingest(tokKey, JSON.stringify({ headline: 'x', pad: 'a'.repeat(270 * 1024) }), { 'X-News-Token': secret });
  check('a body over 256 KB is 413', big.status === 413, big.status);
  const badJson = await ingest(tokKey, '{not json', { 'X-News-Token': secret });
  check('broken JSON is 400', badJson.status === 400 && (await badJson.json()).code === 'INVALID_JSON');
  const unknown = await ingest('nope', '{}', {});
  check('unknown source is 404', unknown.status === 404);

  const hKey = k('signed');
  const hSecret = `hmac-${R}-abcdefghijklmnop`;
  await o.conn.reducers.adminSaveNewsSource(sourceArgs(hKey, { authMode: 'hmac', secret: hSecret, publishMode: 'publish', itemsPath: 'data.items', updateMode: 'ignore', rateLimitPerMinute: 6 }));
  await waitFor(() => rows(o.conn.db.adminNewsSources.iter()).some(x => x.key === hKey));
  const signed = (body: string, ts = String(Math.floor(Date.now() / 1000))) => ({ 'X-News-Timestamp': ts, 'X-News-Signature': `sha256=${createHmac('sha256', hSecret).update(`${ts}.${body}`).digest('hex')}` });
  const hBody = JSON.stringify({ data: { items: [{ id: `h1-${R}`, title: `امضا ${R}`, body: '## تیتر\n\n**پررنگ** [لینک](https://example.com)' }, { id: `h2-${R}`, title: `امضا دو ${R}`, body: 'متن ساده' }] } });
  const h1 = signed(hBody);
  const hr = await ingest(hKey, hBody, h1);
  const hj = await hr.json();
  check('ingest with HMAC creates published articles', hr.status === 200 && hj.created === 2, hj);
  await waitFor(() => rows(o.conn.db.adminNews.iter()).some(n => n.title.some(t => t.text === `امضا ${R}`)));
  const hn = rows(o.conn.db.adminNews.iter()).find(n => n.title.some(t => t.text === `امضا ${R}`));
  check('markdown bodies are rendered and cleaned', !!hn && hn.status === 'published' && hn.body[0].text.includes('<h2>') && hn.body[0].text.includes('<strong>') && hn.body[0].text.includes('href="https://example.com"'), hn?.body);
  check('webhook articles are visible to players', !!(await listed(p1, hn!.id)));
  const replay = await ingest(hKey, hBody, h1);
  check('a replayed signature is 409', replay.status === 409 && (await replay.json()).code === 'REPLAYED');
  const badSig = await ingest(hKey, hBody, { ...signed(hBody), 'X-News-Signature': 'sha256=' + '0'.repeat(64) });
  check('a bad signature is 401', badSig.status === 401 && (await badSig.json()).code === 'INVALID_SIGNATURE');
  const oldTs = await ingest(hKey, hBody, signed(hBody, String(Math.floor(Date.now() / 1000) - 3600)));
  check('an old timestamp is 401', oldTs.status === 401 && (await oldTs.json()).code === 'TIMESTAMP_OUT_OF_WINDOW');
  const ch = JSON.stringify({ data: { items: [{ id: `h1-${R}`, title: `امضا ${R}`, body: 'changed' }] } });
  const ign = await (await ingest(hKey, ch, signed(ch))).json();
  check('update mode ignore keeps the article', ign.ignored === 1, ign);
  let limited = 0;
  for (let i = 0; i < 4; i++) {
    const b = JSON.stringify({ data: { items: [{ id: `rl-${i}-${R}`, title: `rl ${i}` }] } });
    if ((await ingest(hKey, b, signed(b))).status === 429) limited++;
  }
  check('per-source rate limit answers 429', limited >= 1, limited);
  const logs = await oc.conn.procedures.adminIngestLog({ sourceId: 0n, status: '', page: 1, pageSize: 100 });
  const tokId = rows(o.conn.db.adminNewsSources.iter()).find(x => x.key === tokKey)!.id;
  const tokLogs = logs.rows.filter(l => l.sourceId === tokId);
  check('ingest log keeps rejected and accepted calls', tokLogs.some(l => l.status === 'rejected' && l.code === 'INVALID_TOKEN' && l.body === '') && tokLogs.some(l => l.status === 'created' && l.created === 1) && tokLogs.some(l => l.status === 'unchanged'), tokLogs.map(l => `${l.status}:${l.code}`));

  const pub = (path: string) => fetch(route(path));
  check('public news is off by default', (await pub('/publication/public/news')).status === 404 && (await pub('/publication/public/sitemap')).status === 404);
  check('public pages need a site address', (await errorOf(o.conn.reducers.adminSaveNewsSettings({ ...NEWS_DEFAULTS, publicEnabled: true }))).includes('PUBLIC_BASE_URL_REQUIRED'));
  await o.conn.reducers.adminSaveNews({ ...newsArgs(`hidden ${R}`, { status: 'published', noindex: true }) });
  await newsSettings({ publicEnabled: true, publicBaseUrl: 'https://game.example.com', siteTitle: tr('اخبار بازی') });
  const pl = await pub('/publication/public/news?limit=50');
  const plj = await pl.json();
  check('public news lists visible articles', pl.status === 200 && pl.headers.get('cache-control') === 'public, max-age=300' && plj.items.some((x: { slug: string }) => x.slug === n1.slug), plj.items?.length);
  check('noindex and drafts stay out of the public list', !plj.items.some((x: { title: string }) => x.title === `hidden ${R}` || x.title === `وایر ${R}`));
  const pa = await pub(`/publication/public/article?slug=${encodeURIComponent(n1.slug)}&lang=en`);
  const paj = await pa.json();
  check('public article has the body and canonical url', pa.status === 200 && paj.bodyHtml === clean && paj.title === `${title1} en` && paj.url === `https://game.example.com/news/${encodeURIComponent(n1.slug)}`, paj.url);
  check('a missing public article is 404', (await pub('/publication/public/article?slug=nope')).status === 404);
  const sm = await pub('/publication/public/sitemap');
  const smt = await sm.text();
  check('sitemap lists the article', sm.status === 200 && sm.headers.get('content-type')!.includes('xml') && smt.startsWith('<?xml') && smt.includes(`<loc>https://game.example.com/news/${encodeURIComponent(n1.slug)}</loc>`));
  check('rss stays off until enabled', (await pub('/publication/public/rss')).status === 404);
  await newsSettings({ publicEnabled: true, publicBaseUrl: 'https://game.example.com', siteTitle: tr('اخبار بازی'), rssEnabled: true });
  const rss = await pub('/publication/public/rss');
  const rsst = await rss.text();
  check('rss lists the latest articles', rss.status === 200 && rsst.includes('<rss version="2.0">') && rsst.includes('<title>اخبار بازی</title>') && rsst.includes(`news-${n1.id}`));
  await newsSettings({});
  check('public news off again', (await pub('/publication/public/news')).status === 404);

  await o.conn.reducers.adminSaveCategory({ id: 0n, keyType: 'faq', key: k('fcat'), title: tr('حساب', 'Account'), description: [], parentId: 0n, iconUrl: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.category.iter()).some(x => x.key === k('fcat')));
  const fcat = rows(o.conn.db.category.iter()).find(x => x.key === k('fcat'))!.id;
  await o.conn.reducers.adminSaveFaq({ id: 0n, categoryId: fcat, question: tr(`چطور وارد شوم ${R}`, `How to sign in ${R}`), answer: tr('با **شماره** موبایل', 'With your **phone**'), isActive: true, sort: 2 });
  await o.conn.reducers.adminSaveFaq({ id: 0n, categoryId: fcat, question: tr(`رمز ${R}`, `Password ${R}`), answer: tr('ندارد'), isActive: true, sort: 1 });
  await o.conn.reducers.adminSaveFaq({ id: 0n, categoryId: fcat, question: tr(`پنهان ${R}`), answer: tr('x'), isActive: false, sort: 0 });
  await waitFor(() => rows(p1.conn.db.faqEntries.iter()).filter(f => f.categoryId === fcat).length === 2);
  check('faq view shows active entries only', rows(p1.conn.db.faqEntries.iter()).filter(f => f.categoryId === fcat).length === 2);
  check('faq answers rendered to html', rows(p1.conn.db.faqEntries.iter()).some(f => f.answerHtml.some(a => a.text === '<p>با <strong>شماره</strong> موبایل</p>')));
  const fl = await p1.conn.procedures.faqList({ categoryKey: k('fcat'), q: '', lang: 'en' });
  check('faq list is ordered and translated', fl.lang === 'en' && fl.items.length === 2 && fl.items[0].question === `Password ${R}` && fl.items[1].question === `How to sign in ${R}` && fl.categories[0]?.key === k('fcat'), fl);
  const fq = await p1.conn.procedures.faqList({ categoryKey: '', q: `وارد شوم ${R}`, lang: '' });
  check('faq search covers every translation', fq.items.length === 1 && fq.items[0].question === `چطور وارد شوم ${R}` && fq.lang === 'fa', fq.items);
  check('faq needs a question', (await errorOf(o.conn.reducers.adminSaveFaq({ id: 0n, categoryId: 0n, question: [], answer: tr('x'), isActive: true, sort: 0 }))).includes('QUESTION_REQUIRED'));
  check('faq category kind checked', (await errorOf(o.conn.reducers.adminSaveFaq({ id: 0n, categoryId: newsCat, question: tr('x'), answer: tr('x'), isActive: true, sort: 0 }))).includes('CATEGORY_KIND_MISMATCH'));
  check('operator cannot write faq', (await errorOf(oc.conn.reducers.adminSaveFaq({ id: 0n, categoryId: 0n, question: tr('x'), answer: tr('x'), isActive: true, sort: 0 }))).includes('FORBIDDEN'));

  const audits = async (a: string) => (await o.conn.procedures.adminAudit({ action: a, page: 1, pageSize: 100 })).rows.map(r => r.action);
  check('campaign changes audited', (await audits('campaign.')).includes('campaign.send') && (await audits('campaign.')).includes('campaign.cancel'));
  check('news changes audited', (await audits('news.')).includes('news.published') && (await audits('news.')).includes('news.create'));
  check('push, source, faq and settings changes audited', (await audits('push_config.')).includes('push_config.save') && (await audits('news_source.')).includes('news_source.create') && (await audits('faq.')).includes('faq.create') && (await audits('publication_settings.')).includes('publication_settings.clock') && (await audits('news_comment.')).includes('news_comment.accept'));

  await clock(0);
  check('publication clock back at zero', rows(o.conn.db.adminPublicationSettings.iter())[0]?.clockOffsetSec === 0n);
  done('publication');
}

main().catch(async e => {
  console.error('ERROR', e);
  try {
    await clock(0);
    await settings({});
    await newsSettings({});
    await o.conn.reducers.adminSavePushConfig({ provider: 'log', serviceAccount: '' });
  } catch {}
  process.exit(1);
});
