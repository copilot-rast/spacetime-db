import { ECONOMY_QUERIES, GAMIFICATION_QUERIES, PLAYER_QUERIES, check, connect, done, loginOwner, panelUser, errorOf, login, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const R = String(Date.now() % 10_000_000);
const c = (token?: string) => connect(token, [...PLAYER_QUERIES, ...ECONOMY_QUERIES, ...GAMIFICATION_QUERIES]);
const rows = <T>(it: Iterable<T>) => [...it];
const k = (s: string) => `${s}_${R}`;

let o: Client;

function bal(cl: Client, key: string) {
  return rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === key)?.balance ?? -1n;
}
function meta(cl: Client, key: string) {
  return rows(cl.conn.db.myMetas.iter()).find(m => m.metaKey === key)?.value;
}
async function player() {
  const p = await c();
  const r = await login(p, uniquePhone('0937'));
  return { p, id: r.accountId };
}
async function setDay(n: number) {
  await o.conn.reducers.adminSetClockOffset({ seconds: BigInt(n * 86400) });
}

async function eventType(key: string, clientAllowed: boolean, rateLimit = 0, valueMax = 1000) {
  const old = rows(o.conn.db.eventType.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSaveEventType({ id: old?.id ?? 0n, key, name: tr(key), description: [], clientAllowed, valueMin: 0, valueMax, rateLimit, isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.eventType.iter()).some(x => x.key === key));
  return rows(o.conn.db.eventType.iter()).find(x => x.key === key)!;
}
async function prize(key: string, items: { type: string; key: string; action: string; value: number }[]) {
  await o.conn.reducers.adminSavePrize({ id: 0n, key, name: tr(key), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === key));
  return rows(o.conn.db.prize.iter()).find(x => x.key === key)!.id;
}
async function metaDef(key: string) {
  await o.conn.reducers.adminSaveMeta({ id: 0n, key, name: tr(key), defaultValue: 0, serverOnly: false });
  await waitFor(() => rows(o.conn.db.meta.iter()).some(x => x.key === key));
}
const gold = (n: number) => [{ type: 'currency', key: k('gold'), action: 'add', value: n }];

async function rule(key: string, p: Partial<Parameters<Client['conn']['reducers']['adminSaveEventRule']>[0]>) {
  await o.conn.reducers.adminSaveEventRule({
    id: 0n,
    key,
    name: tr(key),
    description: [],
    eventKey: '',
    measure: 'count',
    period: 'total',
    threshold: 1,
    repeat: 'once',
    maxClaims: 0,
    prizeId: 0n,
    grantMode: 'auto',
    audienceTagIds: [],
    startsAt: 0n,
    endsAt: 0n,
    isActive: true,
    sort: 0,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.adminEventRules.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminEventRules.iter()).find(x => x.key === key)!.id;
}
type TaskArgs = Parameters<Client['conn']['reducers']['adminSaveTask']>[0];
async function task(key: string, p: Partial<TaskArgs>) {
  const old = rows(o.conn.db.adminTasks.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSaveTask({
    id: old?.id ?? 0n,
    key,
    name: tr(key),
    description: [],
    iconUrl: '',
    categoryId: 0n,
    tagIds: [],
    condition: 'event',
    eventKey: '',
    metric: 'count',
    target: 1,
    valueMin: undefined,
    valueMax: undefined,
    repeat: 'once',
    repeatMinutes: 0,
    maxCompletions: 0,
    parentId: 0n,
    dependsOn: [],
    groupId: 0n,
    prizeId: 0n,
    grantMode: 'auto',
    audienceTagIds: [],
    levelTableId: 0n,
    minLevel: 0,
    maxLevel: 0,
    startsAt: 0n,
    endsAt: 0n,
    isActive: true,
    sort: 0,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.adminTasks.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminTasks.iter()).find(x => x.key === key)!.id;
}
type AchArgs = Parameters<Client['conn']['reducers']['adminSaveAchievement']>[0];
async function achievement(key: string, p: Partial<AchArgs>) {
  await o.conn.reducers.adminSaveAchievement({
    id: 0n,
    key,
    name: tr(key),
    description: [],
    hint: tr('راهنما'),
    iconUrl: '',
    lockedIconUrl: '',
    categoryId: 0n,
    tagIds: [],
    rarity: 'common',
    points: 10,
    isHidden: false,
    source: 'manual',
    eventKey: '',
    metric: 'count',
    valueMin: undefined,
    valueMax: undefined,
    taskId: 0n,
    taskGroupId: 0n,
    tiers: [],
    isActive: true,
    sort: 0,
    ...p,
  });
  await waitFor(() => rows(o.conn.db.adminAchievements.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminAchievements.iter()).find(x => x.key === key)!.id;
}
type StreakArgs = Parameters<Client['conn']['reducers']['adminSaveStreak']>[0];
async function streak(p: StreakArgs) {
  await o.conn.reducers.adminSaveStreak(p);
  await waitFor(() => rows(o.conn.db.adminStreaks.iter()).some(x => x.key === p.key && x.repayAfterFall === p.repayAfterFall));
  return rows(o.conn.db.adminStreaks.iter()).find(x => x.key === p.key)!.id;
}
async function relation(key: string, metaKey: string, targets: { metaKey: string; action: string; amount: number }[], extra: Partial<Parameters<Client['conn']['reducers']['adminSaveMetaRelation']>[0]> = {}) {
  await o.conn.reducers.adminSaveMetaRelation({
    id: 0n,
    key,
    name: tr(key),
    description: [],
    metaKey,
    operator: 'gte',
    value: 1,
    targets,
    prizeId: 0n,
    grantMode: 'auto',
    repeat: 'once',
    maxFires: 0,
    audienceTagIds: [],
    clientVisible: true,
    startsAt: 0n,
    endsAt: 0n,
    isActive: true,
    sort: 0,
    ...extra,
  });
  await waitFor(() => rows(o.conn.db.adminMetaRelations.iter()).some(x => x.key === key));
  return rows(o.conn.db.adminMetaRelations.iter()).find(x => x.key === key)!.id;
}
const send = (p: Client, key: string, value = 1, metadata = '') => p.conn.procedures.recordEvent({ key, value, metadata });
async function streakOf(p: Client, key: string) {
  return (await p.conn.procedures.myStreaks()).find(s => s.key === key)!;
}
async function taskOf(p: Client, key: string) {
  return (await p.conn.procedures.myTasks()).tasks.find(x => x.key === key);
}
function ach(p: Client, id: bigint) {
  return rows(p.conn.db.myAchievements.iter()).find(a => a.achievementId === id);
}

async function main() {
  o = await c();
  const ownerLogin = await loginOwner(o);
  await setDay(0);
  await o.conn.reducers.adminSaveGamificationSettings({ weekStart: 6, playerRateLimit: 120, retentionDays: 30, chainDepth: 8 });
  check('settings row seeded with defaults', await waitFor(() => {
    const s = rows(o.conn.db.adminGamificationSettings.iter())[0];
    return !!s && s.chainDepth === 8 && s.playerRateLimit === 120 && s.clockOffsetSec === 0n;
  }));
  check('system event types seeded', ['login', 'purchase_completed', 'level_up', 'task_completed', 'achievement_unlocked', 'meta_relation_completed'].every(key => rows(o.conn.db.eventType.iter()).some(x => x.key === key && x.isSystem && !x.clientAllowed)));
  check('task and achievement key types seeded', ['task', 'achievement'].every(key => rows(o.conn.db.keyType.iter()).some(x => x.key === key)));
  const loginType = rows(o.conn.db.eventType.iter()).find(x => x.key === 'login')!;
  check('system event cannot become client-sent', (await errorOf(o.conn.reducers.adminSaveEventType({ ...loginType, clientAllowed: true }))).includes('SYSTEM_EVENT_SERVER_ONLY'));
  check('system event cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteEventType({ id: loginType.id }))).includes('SYSTEM_EVENT'));
  check('bad event key refused', (await errorOf(o.conn.reducers.adminSaveEventType({ id: 0n, key: 'Bad Key', name: tr('x'), description: [], clientAllowed: true, valueMin: 0, valueMax: 1, rateLimit: 0, isActive: true, sort: 0 }))).includes('INVALID_EVENT_KEY'));

  await o.conn.reducers.adminSaveCurrency({ id: 0n, key: k('gold'), name: tr('طلا'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === k('gold')));
  const g1 = await prize(k('g1'), gold(1));
  const g2 = await prize(k('g2'), gold(2));
  const g5 = await prize(k('g5'), gold(5));
  const g10 = await prize(k('g10'), gold(10));

  const play = k('play');
  const secret = k('secret');
  const rate = k('rate');
  await eventType(play, true);
  await eventType(secret, false);
  await eventType(rate, true, 2);

  const { p: p1, id: id1 } = await player();
  check('player cannot save event types', (await errorOf(p1.conn.reducers.adminSaveEventType({ id: 0n, key: k('hack'), name: tr('x'), description: [], clientAllowed: true, valueMin: 0, valueMax: 1, rateLimit: 0, isActive: true, sort: 0 }))).includes('FORBIDDEN'));
  check('player cannot move the clock', (await errorOf(p1.conn.reducers.adminSetClockOffset({ seconds: 86400n }))).includes('FORBIDDEN'));
  const ok = await send(p1, play);
  check('client event allowed', ok.eventId > 0n);
  check('server-only event refused from the client', (await errorOf(send(p1, secret))).includes('EVENT_NOT_ALLOWED'));
  check('system event refused from the client', (await errorOf(send(p1, 'login'))).includes('EVENT_NOT_ALLOWED'));
  check('unknown event refused', (await errorOf(send(p1, k('nope')))).includes('EVENT_TYPE_NOT_FOUND'));
  check('value outside the range refused', (await errorOf(send(p1, play, 5000))).includes('VALUE_OUT_OF_RANGE'));
  check('bad metadata refused', (await errorOf(send(p1, play, 1, '[1,2]'))).includes('INVALID_METADATA'));
  if (new Date().getSeconds() > 50) await new Promise(r => setTimeout(r, 11_000));
  await send(p1, rate);
  await send(p1, rate);
  check('per-type rate limit', (await errorOf(send(p1, rate))).includes('TOO_MANY_EVENTS'));
  const adminEv = await o.conn.procedures.adminRecordEvent({ accountId: id1, key: secret, value: 3, metadata: '{"by":"test"}' });
  check('admin records a server-only event', adminEv.eventId > 0n);
  const log = await o.conn.procedures.adminEventLog({ accountId: id1, typeKey: '', source: '', page: 1, pageSize: 50 });
  check('event log keeps source and refused events are absent', log.rows.some(e => e.typeKey === secret && e.source === 'admin') && log.rows.filter(e => e.typeKey === rate).length === 2 && log.rows.some(e => e.typeKey === 'login' && e.source === 'server'), log.rows.map(e => `${e.typeKey}:${e.source}`));

  const { p: pr } = await player();
  await o.conn.reducers.adminSaveGamificationSettings({ weekStart: 6, playerRateLimit: 3, retentionDays: 30, chainDepth: 8 });
  if (new Date().getSeconds() > 50) await new Promise(r => setTimeout(r, 11_000));
  await send(pr, play);
  await send(pr, play);
  await send(pr, play);
  check('per-player rate limit over all types', (await errorOf(send(pr, play))).includes('TOO_MANY_EVENTS'));
  await o.conn.reducers.adminSaveGamificationSettings({ weekStart: 6, playerRateLimit: 120, retentionDays: 30, chainDepth: 8 });

  const ev = k('ev');
  await eventType(ev, true);
  check('rule needs a period for repeat=period', (await errorOf(rule(k('bad_rule'), { eventKey: ev, repeat: 'period', period: 'total', prizeId: g1 }))).includes('REPEAT_NEEDS_PERIOD'));
  const ruleA = await rule(k('rule_a'), { eventKey: ev, measure: 'count', period: 'day', threshold: 3, repeat: 'period', prizeId: g10, grantMode: 'auto' });
  const ruleB = await rule(k('rule_b'), { eventKey: ev, measure: 'sum', period: 'total', threshold: 100, repeat: 'every', maxClaims: 2, prizeId: g5, grantMode: 'claim' });
  const { p: p2, id: id2 } = await player();
  await send(p2, ev);
  await send(p2, ev);
  const third = await send(p2, ev);
  check('rule reached grants an auto prize at once', third.claims.length === 1 && third.claims[0].status === 'granted' && (await waitFor(() => bal(p2, k('gold')) === 10n)), third.claims);
  await send(p2, ev);
  const big = await send(p2, ev, 250);
  check('every-threshold rule makes one claim per multiple', big.claims.length === 2 && big.claims.every(x => x.status === 'ready' && x.grantMode === 'claim'), big.claims);
  const capped = await send(p2, ev, 300);
  check('max claims caps the rule', capped.claims.length === 0);
  check('same-day repeat of a period rule pays nothing', bal(p2, k('gold')) === 10n);
  const rules = await p2.conn.procedures.myEventRules();
  const rb = rules.find(r => r.ruleId === ruleB)!;
  check('rule progress shows claimable rewards', rb.claimable.length === 2 && rb.current === 554 && rules.find(r => r.ruleId === ruleA)!.current === 6, rb);
  check('another player cannot take my claim', (await errorOf(p1.conn.procedures.claimReward({ claimId: rb.claimable[0] }))).includes('CLAIM_NOT_FOUND'));
  const cl = await p2.conn.procedures.claimReward({ claimId: rb.claimable[0] });
  check('claim mode reward collected', cl.status === 'granted' && (await waitFor(() => bal(p2, k('gold')) === 15n)), cl);
  check('second claim refused', (await errorOf(p2.conn.procedures.claimReward({ claimId: rb.claimable[0] }))).includes('ALREADY_CLAIMED'));
  await setDay(1);
  await send(p2, ev);
  await send(p2, ev);
  const nextDay = await send(p2, ev);
  check('period rule pays again in the next day', nextDay.claims.length === 1 && (await waitFor(() => bal(p2, k('gold')) === 25n)));
  check('claims listed in my_rewards', await waitFor(() => rows(p2.conn.db.myRewards.iter()).filter(x => x.kind === 'event').length === 4));
  const ac = await o.conn.procedures.adminClaims({ accountId: id2, kind: 'event', status: '', page: 1, pageSize: 50 });
  check('admin claims list', ac.total === 4 && ac.rows.filter(x => x.status === 'granted').length === 3, ac.total);
  await setDay(0);

  const xp = k('xp');
  const lvl = k('lvl');
  await metaDef(xp);
  await metaDef(lvl);
  const xp150 = await prize(k('xp150'), [{ type: 'meta', key: xp, action: 'add', value: 150 }]);
  check('level thresholds must be ordered', (await errorOf(o.conn.reducers.adminSaveLevelTable({ id: 0n, key: k('bad_lt'), name: tr('x'), description: [], metaKey: xp, levelMetaKey: '', steps: [{ level: 1, threshold: 50, title: [], prizeId: 0n, grantMode: 'auto' }, { level: 2, threshold: 10, title: [], prizeId: 0n, grantMode: 'auto' }], isActive: true, sort: 0 }))).includes('THRESHOLDS_NOT_ORDERED'));
  await o.conn.reducers.adminSaveLevelTable({
    id: 0n,
    key: k('levels'),
    name: tr('سطح'),
    description: [],
    metaKey: xp,
    levelMetaKey: lvl,
    steps: [
      { level: 1, threshold: 100, title: tr('تازه‌کار'), prizeId: g5, grantMode: 'auto' },
      { level: 2, threshold: 300, title: tr('حرفه‌ای'), prizeId: g10, grantMode: 'auto' },
      { level: 3, threshold: 1000, title: tr('استاد'), prizeId: 0n, grantMode: 'auto' },
    ],
    isActive: true,
    sort: 0,
  });
  await waitFor(() => rows(o.conn.db.adminLevelTables.iter()).some(x => x.key === k('levels')));
  const lt = rows(o.conn.db.adminLevelTables.iter()).find(x => x.key === k('levels'))!;
  await o.conn.reducers.adminSavePaymentMethod({ method: 'in_app', isActive: true, config: '{}' });
  await o.conn.reducers.adminSaveProduct({ id: 0n, key: k('xp_pack'), name: tr('بستهٔ تجربه'), description: [], isActive: true, categoryId: 0n, tagIds: [], audienceTagIds: [], priceToman: 0n, coinCurrency: k('gold'), coinAmount: 5n, discountPercent: 0, paymentMethods: ['in_app'], skuBazaar: '', skuMyket: '', prizeId: xp150, iconUrl: '', coverUrl: '', sort: 0 });
  const prod = (await o.conn.procedures.adminProducts({ query: k('xp_pack'), categoryId: 0n, isActive: '', page: 1, pageSize: 5 })).rows[0];
  const { p: p3, id: id3 } = await player();
  await o.conn.reducers.adminAdjust({ accountId: id3, kind: 'currency', key: k('gold'), action: 'set', value: 100, note: '' });
  await waitFor(() => bal(p3, k('gold')) === 100n);
  const buy = await p3.conn.procedures.purchaseStart({ productId: prod.id, method: 'in_app', giftCode: '' });
  check('purchase settles', buy.status === 'success');
  check('purchase raises the level and writes the level meta', await waitFor(() => rows(p3.conn.db.myLevels.iter()).find(l => l.tableId === lt.id)?.level === 1 && meta(p3, lvl) === 1 && meta(p3, xp) === 150));
  check('level prize paid once reached', await waitFor(() => bal(p3, k('gold')) === 100n));
  await o.conn.procedures.adminGrantPrize({ accountId: id3, prizeId: xp150, note: '' });
  check('prize grant raises the level again', await waitFor(() => rows(p3.conn.db.myLevels.iter()).find(l => l.tableId === lt.id)?.level === 2 && meta(p3, lvl) === 2 && bal(p3, k('gold')) === 110n));
  await o.conn.reducers.adminAdjust({ accountId: id3, kind: 'meta', key: xp, action: 'set', value: 50, note: '' });
  await o.conn.reducers.adminAdjust({ accountId: id3, kind: 'meta', key: xp, action: 'set', value: 350, note: '' });
  await waitFor(() => meta(p3, xp) === 350);
  await new Promise(r => setTimeout(r, 500));
  check('level never goes down and pays once', rows(p3.conn.db.myLevels.iter()).find(l => l.tableId === lt.id)?.level === 2 && bal(p3, k('gold')) === 110n);
  const log3 = await o.conn.procedures.adminEventLog({ accountId: id3, typeKey: '', source: '', page: 1, pageSize: 50 });
  check('purchase and level-up events recorded', log3.rows.some(e => e.typeKey === 'purchase_completed' && e.value === 5) && log3.rows.filter(e => e.typeKey === 'level_up').length === 2, log3.rows.map(e => e.typeKey));
  check('used meta cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteMeta({ id: rows(o.conn.db.meta.iter()).find(m => m.key === lvl)!.id }))).includes('IN_USE'));

  const [ca, cb, cc, cd, ce] = ['ca', 'cb', 'cc', 'cd', 'ce'].map(k);
  for (const m of [ca, cb, cc, cd, ce]) await metaDef(m);
  const r1 = await relation(k('r1'), ca, [{ metaKey: cb, action: 'add', amount: 1 }], { prizeId: g5 });
  await relation(k('r2'), cb, [{ metaKey: cc, action: 'add', amount: 1 }]);
  await relation(k('r3'), cc, [{ metaKey: cd, action: 'add', amount: 1 }]);
  await relation(k('r4'), cd, [{ metaKey: ce, action: 'add', amount: 1 }]);
  check('relation needs a result', (await errorOf(relation(k('r_bad'), ca, []))).includes('RELATION_NEEDS_RESULT'));
  await o.conn.reducers.adminSaveGamificationSettings({ weekStart: 6, playerRateLimit: 120, retentionDays: 30, chainDepth: 1 });
  const { p: p4, id: id4 } = await player();
  await o.conn.reducers.adminAdjust({ accountId: id4, kind: 'meta', key: ca, action: 'add', value: 1, note: '' });
  check('relation chain stops at the depth limit', await waitFor(() => meta(p4, cb) === 1 && meta(p4, cc) === 1) && meta(p4, cd) === 0 && meta(p4, ce) === 0, [meta(p4, cb), meta(p4, cc), meta(p4, cd), meta(p4, ce)]);
  check('relation prize paid', await waitFor(() => bal(p4, k('gold')) === 5n));
  check('client sees completed relations', await waitFor(() => rows(p4.conn.db.myMetaRelations.iter()).find(x => x.relationId === r1)?.completed === true));
  await o.conn.reducers.adminSaveGamificationSettings({ weekStart: 6, playerRateLimit: 120, retentionDays: 30, chainDepth: 8 });
  const { p: p5, id: id5 } = await player();
  await o.conn.reducers.adminAdjust({ accountId: id5, kind: 'meta', key: ca, action: 'add', value: 1, note: '' });
  check('full chain runs under a higher limit', await waitFor(() => meta(p5, ce) === 1));
  await o.conn.reducers.adminAdjust({ accountId: id5, kind: 'meta', key: ca, action: 'add', value: 1, note: '' });
  await new Promise(r => setTimeout(r, 300));
  check('once relation fires once', meta(p5, cb) === 1);
  const cr = k('cr');
  const crl = k('crl');
  await metaDef(cr);
  await metaDef(crl);
  await relation(k('rearm'), cr, [{ metaKey: cr, action: 'add', amount: -100 }, { metaKey: crl, action: 'add', amount: 1 }], { value: 100, repeat: 'rearm' });
  await o.conn.reducers.adminAdjust({ accountId: id5, kind: 'meta', key: cr, action: 'add', value: 100, note: '' });
  await o.conn.reducers.adminAdjust({ accountId: id5, kind: 'meta', key: cr, action: 'add', value: 100, note: '' });
  check('rearm relation fires again after the condition drops', await waitFor(() => meta(p5, crl) === 2 && meta(p5, cr) === 0), [meta(p5, cr), meta(p5, crl)]);

  const daily = k('daily');
  await eventType(daily, true);
  const sKey = k('streak');
  const sArgs: StreakArgs = {
    id: 0n,
    key: sKey,
    name: tr('ورود روزانه'),
    description: [],
    eventKey: daily,
    periodDays: 1,
    gracePeriods: 0,
    missAction: 'reset',
    cycleLength: 0,
    repayAfterFall: false,
    rewards: [
      { day: 2, prizeId: g1, grantMode: 'auto' },
      { day: 4, prizeId: g1, grantMode: 'auto' },
      { day: 5, prizeId: g1, grantMode: 'auto' },
    ],
    milestones: [
      { day: 3, prizeId: g10, grantMode: 'auto' },
      { day: 6, prizeId: 0n, grantMode: 'auto' },
    ],
    isActive: true,
    sort: 0,
  };
  check('duplicate milestone refused', (await errorOf(streak({ ...sArgs, milestones: [...sArgs.milestones, { day: 3, prizeId: 0n, grantMode: 'auto' }] }))).includes('DUPLICATE_MILESTONE'));
  const sId = await streak(sArgs);
  const sbKey = k('streak_sb');
  await streak({ ...sArgs, key: sbKey, missAction: 'step_back', gracePeriods: 1, rewards: [], milestones: [] });
  const { p: p6, id: id6 } = await player();
  const d0 = await send(p6, daily);
  const d0b = await send(p6, daily);
  await send(p6, daily);
  check('streak counts one step per day', d0.streaks.find(s => s.key === sKey)?.count === 1 && d0b.streaks.find(s => s.key === sKey)?.advanced === false && (await streakOf(p6, sKey)).count === 1);
  for (let d = 1; d <= 4; d++) {
    await setDay(d);
    await send(p6, daily);
  }
  let s6 = await streakOf(p6, sKey);
  check('streak reached day 5 with the milestone passed', s6.count === 5 && s6.floor === 3 && s6.nextMilestone === 6 && s6.milestones.find(m => m.day === 3)?.reached === true, s6);
  check('day rewards and milestone prize paid', await waitFor(() => bal(p6, k('gold')) === 13n), bal(p6, k('gold')));
  await setDay(7);
  s6 = await streakOf(p6, sKey);
  check('missed streak shows the safe day', s6.broken && s6.floored && s6.count === 3 && s6.storedCount === 5 && s6.milestones.find(m => m.day === 3)?.safe === true, s6);
  const back = await send(p6, daily);
  const st6 = back.streaks.find(s => s.key === sKey)!;
  check('after a miss the count restarts from the safe day', st6.count === 4 && st6.fell && st6.floor === 3, st6);
  await setDay(8);
  await send(p6, daily);
  await new Promise(r => setTimeout(r, 300));
  check('re-reached days pay nothing with re-pay off', bal(p6, k('gold')) === 13n && (await streakOf(p6, sKey)).count === 5, bal(p6, k('gold')));
  const sb = await streakOf(p6, sbKey);
  check('step back loses one day per missed period beyond the grace', sb.count === 6 && sb.best === 6, sb);
  await streak({ ...sArgs, id: sId, repayAfterFall: true });
  await setDay(11);
  await send(p6, daily);
  check('re-pay on pays the re-reached day after a fall', await waitFor(() => bal(p6, k('gold')) === 14n) && (await streakOf(p6, sKey)).falls === 2, bal(p6, k('gold')));
  await o.conn.reducers.adminResetStreak({ accountId: id6, streakId: sId });
  s6 = await streakOf(p6, sKey);
  check('admin reset goes to zero and clears the safe day', s6.count === 0 && s6.floor === 0 && s6.peak === 0 && s6.best === 5, s6);
  await setDay(12);
  await send(p6, daily);
  await setDay(13);
  await send(p6, daily);
  await setDay(14);
  await send(p6, daily);
  await new Promise(r => setTimeout(r, 300));
  s6 = await streakOf(p6, sKey);
  check('milestone prize is never paid twice', s6.count === 3 && rows(p6.conn.db.myRewards.iter()).filter(x => x.kind === 'milestone').length === 1, s6.count);
  await setDay(0);

  const quest = k('quest');
  const qday = k('qday');
  const qkid = k('qkid');
  const qgrp = k('qgrp');
  for (const e of [quest, qday, qkid, qgrp]) await eventType(e, true);
  const t1 = await task(k('t1'), { eventKey: quest, target: 2, prizeId: g5, grantMode: 'claim' });
  const t2 = await task(k('t2'), { eventKey: quest, target: 1, dependsOn: [t1] });
  check('dependency cycle refused', (await errorOf(task(k('t1'), { eventKey: quest, target: 2, prizeId: g5, grantMode: 'claim', dependsOn: [t2] }))).includes('DEPENDENCY_CYCLE'));
  await task(k('t3'), { eventKey: qday, target: 1, repeat: 'daily', prizeId: g1, grantMode: 'auto' });
  const t4 = await task(k('t4'), { condition: 'children', prizeId: g2, grantMode: 'auto' });
  await task(k('t4a'), { eventKey: qkid, target: 1, parentId: t4 });
  await task(k('t4b'), { eventKey: qkid, metric: 'sum', target: 5, parentId: t4, valueMin: 2 });
  check('sub-task must count an event', (await errorOf(task(k('t4c'), { condition: 'children', parentId: t4 }))).includes('SUBTASK_NEEDS_EVENT'));
  check('event task with sub-tasks refused', (await errorOf(task(k('t4'), { condition: 'event', eventKey: qkid }))).includes('HAS_SUBTASKS'));
  const a3 = await achievement(k('a_task'), { source: 'task', taskId: t1 });
  const { p: p7, id: id7 } = await player();
  check('claim before completion refused', (await errorOf(p7.conn.procedures.claimTask({ taskId: t1 }))).includes('TASK_NOT_COMPLETED'));
  check('dependent task is locked', (await taskOf(p7, k('t2')))?.state === 'locked');
  await send(p7, quest);
  check('task progress counts', (await taskOf(p7, k('t1')))?.value === 1 && (await taskOf(p7, k('t2')))?.state === 'locked');
  const q2 = await send(p7, quest);
  check('task completes at the target', q2.tasks.some(x => x.key === k('t1') && x.status === 'completed'), q2.tasks);
  const t1v = (await taskOf(p7, k('t1')))!;
  check('completed task is claimable', t1v.state === 'completed' && t1v.claimable);
  check('task-linked achievement unlocked', await waitFor(() => ach(p7, a3)?.tier === 1));
  const tc = await p7.conn.procedures.claimTask({ taskId: t1 });
  check('task claim pays', tc.status === 'granted' && (await waitFor(() => bal(p7, k('gold')) === 5n)));
  check('second task claim refused', (await errorOf(p7.conn.procedures.claimTask({ taskId: t1 }))).includes('ALREADY_CLAIMED'));
  check('claimed task stays claimed', (await taskOf(p7, k('t1')))?.state === 'claimed' && (await taskOf(p7, k('t2')))?.state === 'active');
  await send(p7, quest);
  check('dependency met unlocks the next task', (await taskOf(p7, k('t2')))?.state === 'claimed' && (await taskOf(p7, k('t1')))?.value === 2);
  await send(p7, qday);
  check('daily task done today', (await taskOf(p7, k('t3')))?.state === 'claimed' && (await waitFor(() => bal(p7, k('gold')) === 6n)));
  await setDay(1);
  check('daily task opens again the next day', (await taskOf(p7, k('t3')))?.state === 'active');
  await send(p7, qday);
  check('daily task pays again the next day', await waitFor(() => bal(p7, k('gold')) === 7n));
  await setDay(0);
  await send(p7, qkid, 1);
  check('sub-task value range filters events', (await taskOf(p7, k('t4b')))?.value === 0 && (await taskOf(p7, k('t4a')))?.state === 'claimed');
  await send(p7, qkid, 5);
  check('parent completes when every sub-task is done', (await taskOf(p7, k('t4')))?.state === 'claimed' && (await waitFor(() => bal(p7, k('gold')) === 9n)));

  const gA = await task(k('ga'), { eventKey: qgrp, target: 1, prizeId: g1, grantMode: 'auto' });
  const gB = await task(k('gb'), { eventKey: qgrp, target: 1, prizeId: g1, grantMode: 'auto' });
  await o.conn.reducers.adminSaveTaskGroup({ id: 0n, key: k('grp'), name: tr('گروه'), description: [], iconUrl: '', categoryId: 0n, activeCount: 1, orderMode: 'ordered', handout: 'request', handoutMinutes: 0, isRepeatable: false, taskIds: [gA, gB], audienceTagIds: [], startsAt: 0n, endsAt: 0n, isActive: true, sort: 0 });
  await waitFor(() => rows(o.conn.db.adminTasks.iter()).filter(x => x.id === gA || x.id === gB).every(x => x.groupId !== 0n));
  const grpKey = k('grp');
  let list = await p7.conn.procedures.myTasks();
  check('group hands out the first task', list.groups.find(g => g.key === grpKey)?.handed.join(',') === k('ga') && !list.tasks.some(x => x.key === k('gb')));
  check('next task waits for the current one', (await errorOf(p7.conn.procedures.taskGroupNext({ groupKey: grpKey }))).includes('CURRENT_TASK_MUST_BE_DONE'));
  await send(p7, qgrp);
  const nx = await p7.conn.procedures.taskGroupNext({ groupKey: grpKey });
  check('next task handed on request', nx.handed.join(',') === k('gb'));
  await send(p7, qgrp);
  list = await p7.conn.procedures.myTasks();
  check('group finished after every task', list.groups.find(g => g.key === grpKey)?.finished === true && (await waitFor(() => bal(p7, k('gold')) === 11n)));
  check('finished group refuses more', (await errorOf(p7.conn.procedures.taskGroupNext({ groupKey: grpKey }))).includes('TASK_GROUP_FINISHED'));
  const { p: p7b, id: id7b } = await player();
  await o.conn.reducers.adminCompleteTask({ accountId: id7b, taskId: t1 });
  check('admin completes a task', (await taskOf(p7b, k('t1')))?.state === 'completed');
  await o.conn.reducers.adminResetTask({ accountId: id7b, taskId: t1 });
  check('admin resets an unclaimed task', (await taskOf(p7b, k('t1')))?.state === 'active' && rows(p7b.conn.db.myRewards.iter()).length === 0);

  const win = k('win');
  await eventType(win, true);
  check('tiers must go up', (await errorOf(achievement(k('a_bad'), { source: 'event', eventKey: win, tiers: [{ tier: 1, threshold: 3, name: [], iconUrl: '', prizeId: 0n, grantMode: 'auto' }, { tier: 2, threshold: 2, name: [], iconUrl: '', prizeId: 0n, grantMode: 'auto' }] }))).includes('THRESHOLDS_NOT_ORDERED'));
  check('manual achievement cannot have tiers', (await errorOf(achievement(k('a_bad2'), { source: 'manual', tiers: [{ tier: 1, threshold: 1, name: [], iconUrl: '', prizeId: 0n, grantMode: 'auto' }, { tier: 2, threshold: 2, name: [], iconUrl: '', prizeId: 0n, grantMode: 'auto' }] }))).includes('TIERS_NEED_EVENT'));
  const a1 = await achievement(k('a_win'), {
    source: 'event',
    eventKey: win,
    points: 25,
    tiers: [
      { tier: 1, threshold: 1, name: tr('برنزی'), iconUrl: '', prizeId: 0n, grantMode: 'auto' },
      { tier: 2, threshold: 3, name: tr('نقره‌ای'), iconUrl: '', prizeId: g5, grantMode: 'claim' },
      { tier: 3, threshold: 5, name: tr('طلایی'), iconUrl: '', prizeId: g10, grantMode: 'auto' },
    ],
  });
  const a2 = await achievement(k('a_secret'), { source: 'manual', isHidden: true, tiers: [{ tier: 1, threshold: 1, name: [], iconUrl: '', prizeId: g2, grantMode: 'auto' }] });
  check('prize with an unknown achievement refused', (await errorOf(o.conn.reducers.adminSavePrize({ id: 0n, key: k('p_badge_bad'), name: tr('x'), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'achievement', key: 'nope', action: 'give', value: 1 }] }))).includes('ACHIEVEMENT_NOT_FOUND'));
  const badge = await prize(k('p_badge'), [{ type: 'achievement', key: k('a_secret'), action: 'give', value: 1 }]);
  const { p: p8, id: id8 } = await player();
  check('hidden achievement shows no details', await waitFor(() => ach(p8, a2)?.state === 'hidden' && ach(p8, a2)?.name.length === 0 && ach(p8, a2)?.hint.length === 1));
  const w1 = await send(p8, win);
  check('first tier unlocks the achievement', w1.achievements.some(x => x.key === k('a_win') && x.from === 0 && x.to === 1) && (await waitFor(() => ach(p8, a1)?.state === 'unlocked')));
  const log8 = await o.conn.procedures.adminEventLog({ accountId: id8, typeKey: 'achievement_unlocked', source: '', page: 1, pageSize: 10 });
  check('unlock records an event with the points', log8.rows.length === 1 && log8.rows[0].value === 25);
  await send(p8, win);
  await send(p8, win);
  check('second tier claimable', await waitFor(() => ach(p8, a1)?.tier === 2 && ach(p8, a1)?.claimable.length === 1));
  check('unreached tier refused', (await errorOf(p8.conn.procedures.claimAchievement({ achievementId: a1, tier: 3 }))).includes('TIER_NOT_REACHED'));
  const ca2 = await p8.conn.procedures.claimAchievement({ achievementId: a1, tier: 2 });
  check('tier prize collected', ca2.length === 1 && ca2[0].status === 'granted' && (await waitFor(() => bal(p8, k('gold')) === 5n)));
  check('tier prize once', (await errorOf(p8.conn.procedures.claimAchievement({ achievementId: a1, tier: 2 }))).includes('ALREADY_CLAIMED'));
  await send(p8, win);
  const w5 = await send(p8, win);
  check('top tier pays automatically', w5.claims.some(x => x.status === 'granted') && (await waitFor(() => bal(p8, k('gold')) === 15n && ach(p8, a1)?.state === 'completed')));
  await o.conn.procedures.adminGrantPrize({ accountId: id8, prizeId: badge, note: '' });
  check('prize item unlocks the hidden achievement', await waitFor(() => ach(p8, a2)?.state === 'completed' && ach(p8, a2)?.name.length === 1 && bal(p8, k('gold')) === 17n));
  await o.conn.reducers.adminRevokeAchievement({ accountId: id8, achievementId: a1 });
  check('revoke clears the tier', await waitFor(() => ach(p8, a1)?.state === 'locked'));
  await o.conn.reducers.adminGiveAchievement({ accountId: id8, achievementId: a1, tier: 3 });
  await new Promise(r => setTimeout(r, 500));
  check('re-given tiers do not pay twice', ach(p8, a1)?.tier === 3 && bal(p8, k('gold')) === 17n, bal(p8, k('gold')));
  check('give below the current tier refused', (await errorOf(o.conn.reducers.adminGiveAchievement({ accountId: id8, achievementId: a1, tier: 2 }))).includes('ALREADY_UNLOCKED'));

  for (const [name, id] of [['rule', g10], ['level step', g5], ['streak reward', g1], ['task', g2]] as const) {
    check(`prize used by a ${name} cannot be deleted`, (await errorOf(o.conn.reducers.adminDeletePrize({ id }))).includes('IN_USE'));
  }
  const msOnly = await prize(k('ms_only'), gold(3));
  const s2 = rows(o.conn.db.adminStreaks.iter()).find(x => x.key === sbKey)!;
  await streak({ ...sArgs, id: s2.id, key: sbKey, missAction: 'step_back', gracePeriods: 1, rewards: [], milestones: [{ day: 9, prizeId: msOnly, grantMode: 'claim' }] });
  check('prize used only by a milestone cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrize({ id: msOnly }))).includes('IN_USE'));
  const free = await prize(k('free'), gold(1));
  await o.conn.reducers.adminDeletePrize({ id: free });
  check('unused prize can be deleted', await waitFor(() => !rows(o.conn.db.prize.iter()).some(x => x.id === free)));
  check('rule with claims cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteEventRule({ id: ruleA }))).includes('IN_USE'));
  check('event type in use cannot be deleted', (await errorOf(o.conn.reducers.adminDeleteEventType({ id: rows(o.conn.db.eventType.iter()).find(x => x.key === ev)!.id }))).includes('IN_USE'));

  const prog = await o.conn.procedures.adminPlayerProgress({ accountId: id7 });
  check('admin sees player progress', prog.tasks.length >= 5 && prog.achievements.length >= 1 && prog.totals.some(x => x.typeKey === quest && x.count === 3), prog.totals.length);
  const sum = await o.conn.procedures.adminGamificationSummary();
  check('summary counts', sum.tasks >= 7 && sum.achievements >= 3 && sum.streaks >= 2 && sum.clockOffsetSec === 0n && sum.eventsToday > 0);
  check('player cannot read the summary', (await errorOf(p8.conn.procedures.adminGamificationSummary())).includes('FORBIDDEN'));
  check('player sees no admin catalog', rows(p8.conn.db.adminTasks.iter()).length === 0 && rows(p8.conn.db.adminGamificationSettings.iter()).length === 0);
  check('clock offset back at zero', rows(o.conn.db.adminGamificationSettings.iter())[0]?.clockOffsetSec === 0n);
  void id1;
  void id7b;

  done('gamification');
}

main().catch(async e => {
  console.error('ERROR', e);
  try {
    await setDay(0);
  } catch {}
  process.exit(1);
});
