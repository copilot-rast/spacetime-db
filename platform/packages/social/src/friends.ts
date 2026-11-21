import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { adminOrNull, audit, fail, requireAccount, requireRole } from '@stg/base';
import { socialRows, type SocialSchema } from './schema';
import {
  DAY_US,
  HOUR_US,
  areFriends,
  base,
  bump,
  checkPriority,
  cleanName,
  edgeOf,
  friendIds,
  isPlayer,
  matchingRules,
  metaBonus,
  metaOk,
  nameOf,
  nowUs,
  oneOf,
  resolveLimits,
  sessionId,
  tagsOk,
  tehranDay,
  tehranDayEnd,
  withBonus,
  type SDb,
  type STx,
} from './engine';

const FriendEntry = t.row('FriendEntry', { accountId: t.u64().primaryKey(), displayName: t.string(), since: t.timestamp() });
const FriendRequestEntry = t.row('FriendRequestEntry', { accountId: t.u64().primaryKey(), displayName: t.string(), sentAt: t.timestamp(), expiresAt: t.u64() });
const BlockedEntry = t.row('BlockedEntry', { accountId: t.u64().primaryKey(), displayName: t.string(), blockedAt: t.timestamp() });

const RuleRef = t.object('FriendRuleRef', { id: t.u64(), name: t.string() });
const LimitPair = t.object('FriendLimitPair', { dailyRequests: t.u32(), maxFriends: t.u32() });
const FriendRules = t.object('FriendRulesResult', {
  dailyRequests: t.u32(),
  sentToday: t.u32(),
  remainingToday: t.option(t.u32()),
  resetsAt: t.timestamp(),
  maxFriends: t.u32(),
  friends: t.u32(),
  friendSlotsLeft: t.option(t.u32()),
  expiryDays: t.u32(),
  rejectCooldownHours: t.u32(),
  base: LimitPair,
  bonus: LimitPair,
  tier: t.option(RuleRef),
  overLimit: t.string(),
  matchPolicy: t.string(),
});
const RequestResult = t.object('FriendRequestResult', { sent: t.array(t.u64()), accepted: t.array(t.u64()), skipped: t.array(t.u64()), remainingToday: t.option(t.u32()) });
const AdminEdge = t.object('AdminFriendEdge', { accountId: t.u64(), displayName: t.string(), state: t.string(), since: t.timestamp(), expiresAt: t.u64() });
const AdminFriends = t.object('AdminPlayerFriends', { edges: t.array(AdminEdge), rules: FriendRules });

export function friendSettings(ctx: SDb) {
  const s = ctx.db.friendSettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

export function friendLimits(ctx: SDb, accountId: bigint) {
  const s = friendSettings(ctx);
  const r = resolveLimits(
    matchingRules(ctx, accountId, ctx.db.friendRule.iter()),
    s.matchPolicy,
    { dailyRequests: s.dailyRequests, maxFriends: s.maxFriends, rejectCooldownHours: s.rejectCooldownHours },
    (x, f) => x[f] ?? undefined,
    ['rejectCooldownHours']
  );
  const bonus = { dailyRequests: metaBonus(ctx, accountId, s.requestsBonusMeta), maxFriends: metaBonus(ctx, accountId, s.friendsBonusMeta) };
  return {
    s,
    base: { dailyRequests: r.values.dailyRequests, maxFriends: r.values.maxFriends },
    bonus,
    dailyRequests: withBonus(r.values.dailyRequests, bonus.dailyRequests),
    maxFriends: withBonus(r.values.maxFriends, bonus.maxFriends),
    rejectCooldownHours: r.values.rejectCooldownHours,
    tier: r.rule,
  };
}

function setEdge(ctx: STx, a: bigint, b: bigint, state: string, expiresAt = 0n) {
  const key = `${a}|${b}`;
  const old = ctx.db.edge.key.find(key);
  const row = { key, accountId: a, otherId: b, state, createdAt: old?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp, expiresAt };
  if (old) ctx.db.edge.key.update(row);
  else ctx.db.edge.insert(row);
}

function dropEdge(ctx: STx, a: bigint, b: bigint) {
  ctx.db.edge.key.delete(`${a}|${b}`);
}

export function dropPair(ctx: STx, a: bigint, b: bigint) {
  const x = edgeOf(ctx, a, b);
  const y = edgeOf(ctx, b, a);
  if (x && x.state !== 'blocked') dropEdge(ctx, a, b);
  if (y && y.state !== 'blocked') dropEdge(ctx, b, a);
}

function isLive(ctx: STx, e: { expiresAt: bigint }) {
  return !e.expiresAt || e.expiresAt > nowUs(ctx);
}

export function expireInvites(ctx: STx, accountId: bigint) {
  for (const e of [...ctx.db.edge.accountId.filter(accountId)]) {
    if ((e.state === 'sent' || e.state === 'received') && !isLive(ctx, e)) dropPair(ctx, e.accountId, e.otherId);
  }
}

function sentToday(ctx: STx, accountId: bigint) {
  return ctx.db.friendDay.key.find(`${accountId}|${tehranDay(nowUs(ctx))}`)?.count ?? 0;
}

function rulesOf(ctx: STx, accountId: bigint) {
  const l = friendLimits(ctx, accountId);
  const used = sentToday(ctx, accountId);
  const friends = friendIds(ctx, accountId).length;
  return {
    dailyRequests: l.dailyRequests,
    sentToday: used,
    remainingToday: l.dailyRequests ? Math.max(l.dailyRequests - used, 0) : undefined,
    resetsAt: new Timestamp(tehranDayEnd(tehranDay(nowUs(ctx))) - (nowUs(ctx) - ctx.timestamp.microsSinceUnixEpoch)),
    maxFriends: l.maxFriends,
    friends,
    friendSlotsLeft: l.maxFriends ? Math.max(l.maxFriends - friends, 0) : undefined,
    expiryDays: l.s.expiryDays,
    rejectCooldownHours: l.rejectCooldownHours,
    base: l.base,
    bonus: l.bonus,
    tier: l.tier,
    overLimit: l.s.overLimit,
    matchPolicy: l.s.matchPolicy,
  };
}

function accept(ctx: STx, me: bigint, other: bigint, extra = 0) {
  const mine = friendLimits(ctx, me);
  if (mine.maxFriends && friendIds(ctx, me).length + extra >= mine.maxFriends) fail('FRIEND_LIMIT_REACHED');
  const theirs = friendLimits(ctx, other);
  if (theirs.maxFriends && friendIds(ctx, other).length >= theirs.maxFriends) fail('FRIEND_TARGET_LIMIT_REACHED');
  setEdge(ctx, me, other, 'friend');
  setEdge(ctx, other, me, 'friend');
  ctx.db.rejection.key.delete(`${me}|${other}`);
  ctx.db.rejection.key.delete(`${other}|${me}`);
}

function target(ctx: STx, me: bigint, id: bigint) {
  if (id === me) fail('CANNOT_TARGET_SELF');
  if (!isPlayer(ctx, id)) fail('USER_NOT_FOUND');
}

export function defineFriends(st: SocialSchema) {
  const friendRequest = st.procedure({ targetIds: t.array(t.u64()) }, RequestResult, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      const ids = [...new Set(a.targetIds)];
      if (!ids.length) fail('NO_USERS');
      if (ids.length > 100) fail('FRIEND_TOO_MANY_USERS');
      for (const id of ids) target(tx, me, id);
      expireInvites(tx, me);
      const lim = friendLimits(tx, me);
      const now = nowUs(tx);
      const invites: bigint[] = [];
      const accepts: bigint[] = [];
      const skipped: bigint[] = [];
      for (const id of ids) {
        expireInvites(tx, id);
        const mine = edgeOf(tx, me, id);
        const theirs = edgeOf(tx, id, me);
        if (theirs?.state === 'blocked' || mine?.state === 'blocked' || mine?.state === 'friend' || mine?.state === 'sent') skipped.push(id);
        else if (mine?.state === 'received') accepts.push(id);
        else invites.push(id);
      }
      if (invites.length && lim.maxFriends && friendIds(tx, me).length >= lim.maxFriends) fail('FRIEND_LIMIT_REACHED');
      if (lim.rejectCooldownHours) {
        for (const id of invites) {
          const r = tx.db.rejection.key.find(`${me}|${id}`);
          if (r && now - r.at < BigInt(lim.rejectCooldownHours) * HOUR_US) fail('FRIEND_REQUEST_COOLDOWN');
        }
      }
      const used = sentToday(tx, me);
      let send = invites;
      if (lim.dailyRequests) {
        const left = Math.max(lim.dailyRequests - used, 0);
        if (invites.length > left) {
          if (lim.s.overLimit === 'trim' && left > 0) {
            send = invites.slice(0, left);
            skipped.push(...invites.slice(left));
          } else fail('FRIEND_DAILY_LIMIT');
        }
      }
      accepts.forEach((id, i) => accept(tx, me, id, i));
      const exp = lim.s.expiryDays ? now + BigInt(lim.s.expiryDays) * DAY_US : 0n;
      for (const id of send) {
        setEdge(tx, me, id, 'sent', exp);
        setEdge(tx, id, me, 'received', exp);
        tx.db.rejection.key.delete(`${id}|${me}`);
      }
      if (send.length) bump(tx.db.friendDay, `${me}|${tehranDay(now)}`, send.length);
      const after = used + send.length;
      return { sent: send, accepted: accepts, skipped, remainingToday: lim.dailyRequests ? Math.max(lim.dailyRequests - after, 0) : undefined };
    })
  );

  const friendAccept = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const e = edgeOf(ctx, me, a.accountId);
    if (!e || e.state !== 'received') fail('REQUEST_NOT_FOUND');
    if (!isLive(ctx, e)) {
      dropPair(ctx, me, a.accountId);
      fail('REQUEST_EXPIRED');
    }
    accept(ctx, me, a.accountId);
  });

  const friendDecline = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    const e = edgeOf(ctx, me, a.accountId);
    if (!e || e.state !== 'received') fail('REQUEST_NOT_FOUND');
    dropPair(ctx, me, a.accountId);
    const row = { key: `${a.accountId}|${me}`, requesterId: a.accountId, rejecterId: me, at: nowUs(ctx) };
    if (ctx.db.rejection.key.find(row.key)) ctx.db.rejection.key.update(row);
    else ctx.db.rejection.insert(row);
  });

  const friendCancel = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    if (edgeOf(ctx, me, a.accountId)?.state !== 'sent') fail('REQUEST_NOT_FOUND');
    dropPair(ctx, me, a.accountId);
  });

  const friendRemove = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    if (!areFriends(ctx, me, a.accountId)) fail('NOT_FRIENDS');
    dropPair(ctx, me, a.accountId);
  });

  const friendBlock = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    target(ctx, me, a.accountId);
    dropPair(ctx, me, a.accountId);
    setEdge(ctx, me, a.accountId, 'blocked');
  });

  const friendUnblock = st.reducer({ accountId: t.u64() }, (ctx, a) => {
    const me = requireAccount(base(ctx)).id;
    if (edgeOf(ctx, me, a.accountId)?.state !== 'blocked') fail('NOT_BLOCKED');
    dropEdge(ctx, me, a.accountId);
  });

  const friendRules = st.procedure(FriendRules, ctx =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx)).id;
      return rulesOf(tx, me);
    })
  );

  const myFriends = st.view({ name: 'my_friends', public: true }, t.array(FriendEntry), ctx => {
    const me = sessionId(ctx as never);
    if (me === undefined) return [];
    return [...ctx.db.edge.accountId.filter(me)].filter(e => e.state === 'friend').map(e => ({ accountId: e.otherId, displayName: nameOf(ctx as never, e.otherId), since: e.updatedAt }));
  });

  const requests = (ctx: { db: STx['db']; sender: STx['sender'] }, state: string) => {
    const me = sessionId(ctx);
    if (me === undefined) return [];
    return [...ctx.db.edge.accountId.filter(me)].filter(e => e.state === state).map(e => ({ accountId: e.otherId, displayName: nameOf(ctx, e.otherId), sentAt: e.createdAt, expiresAt: e.expiresAt }));
  };

  const myFriendRequestsIn = st.view({ name: 'my_friend_requests_in', public: true }, t.array(FriendRequestEntry), ctx => requests(ctx as never, 'received'));

  const myFriendRequestsOut = st.view({ name: 'my_friend_requests_out', public: true }, t.array(FriendRequestEntry), ctx => requests(ctx as never, 'sent'));

  const myBlocked = st.view({ name: 'my_blocked', public: true }, t.array(BlockedEntry), ctx => {
    const me = sessionId(ctx as never);
    if (me === undefined) return [];
    return [...ctx.db.edge.accountId.filter(me)].filter(e => e.state === 'blocked').map(e => ({ accountId: e.otherId, displayName: nameOf(ctx as never, e.otherId), blockedAt: e.updatedAt }));
  });

  const adminFriendSettings = st.view({ name: 'admin_friend_settings', public: true }, t.option(socialRows.friendSettings), ctx =>
    adminOrNull(ctx as any) ? ctx.db.friendSettings.id.find(0) ?? undefined : undefined
  );

  const adminSaveFriendSettings = st.reducer(
    {
      dailyRequests: t.u32(),
      maxFriends: t.u32(),
      expiryDays: t.u32(),
      rejectCooldownHours: t.u32(),
      matchPolicy: t.string(),
      requestsBonusMeta: t.string(),
      friendsBonusMeta: t.string(),
      overLimit: t.string(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      if (a.dailyRequests > 1000) fail('INVALID_RULE:dailyRequests');
      if (a.maxFriends > 10000) fail('INVALID_RULE:maxFriends');
      if (a.expiryDays > 365) fail('INVALID_RULE:expiryDays');
      if (a.rejectCooldownHours > 8760) fail('INVALID_RULE:rejectCooldownHours');
      oneOf(a.matchPolicy, ['priority', 'generous'], 'matchPolicy');
      oneOf(a.overLimit, ['refuse', 'trim'], 'overLimit');
      const row = { id: 0, ...a, requestsBonusMeta: metaOk(ctx, a.requestsBonusMeta), friendsBonusMeta: metaOk(ctx, a.friendsBonusMeta), updatedAt: ctx.timestamp };
      ctx.db.friendSettings.id.update(row);
      audit(base(ctx), me.id, 'friend_settings.save', 'settings', JSON.stringify(a));
    }
  );

  const adminFriendRules = st.view({ name: 'admin_friend_rules', public: true }, t.array(socialRows.friendRule), ctx => (adminOrNull(ctx as any) ? [...ctx.db.friendRule.iter()] : []));

  const adminSaveFriendRule = st.reducer(
    {
      id: t.u64(),
      name: t.string(),
      tagIds: t.array(t.u64()),
      priority: t.i32(),
      dailyRequests: t.option(t.u32()),
      maxFriends: t.option(t.u32()),
      rejectCooldownHours: t.option(t.u32()),
      isActive: t.bool(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const name = cleanName(a.name);
      const tagIds = tagsOk(ctx, a.tagIds);
      checkPriority(a.priority);
      if (a.dailyRequests === undefined && a.maxFriends === undefined && a.rejectCooldownHours === undefined) fail('LIMIT_REQUIRED');
      if ((a.dailyRequests ?? 0) > 1000 || (a.maxFriends ?? 0) > 10000 || (a.rejectCooldownHours ?? 0) > 8760) fail('INVALID_RULE');
      const old = a.id ? ctx.db.friendRule.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      const row = { ...a, dailyRequests: a.dailyRequests, maxFriends: a.maxFriends, rejectCooldownHours: a.rejectCooldownHours, name, tagIds, createdAt: old?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
      const saved = old ? ctx.db.friendRule.id.update(row) : ctx.db.friendRule.insert({ ...row, id: 0n });
      audit(base(ctx), me.id, old ? 'friend_rule.update' : 'friend_rule.create', String(saved.id), name);
    }
  );

  const adminDeleteFriendRule = st.reducer({ id: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.friendRule.id.delete(a.id)) fail('NOT_FOUND');
    audit(base(ctx), me.id, 'friend_rule.delete', String(a.id));
  });

  const adminPlayerFriends = st.procedure({ accountId: t.u64() }, AdminFriends, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      if (!tx.db.account.id.find(a.accountId)) fail('USER_NOT_FOUND');
      const edges = [...tx.db.edge.accountId.filter(a.accountId)].map(e => ({ accountId: e.otherId, displayName: nameOf(tx, e.otherId), state: e.state, since: e.updatedAt, expiresAt: e.expiresAt }));
      return { edges, rules: rulesOf(tx, a.accountId) };
    })
  );

  const adminRemoveFriendship = st.reducer({ accountId: t.u64(), otherId: t.u64() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const x = edgeOf(ctx, a.accountId, a.otherId);
    const y = edgeOf(ctx, a.otherId, a.accountId);
    if (!x && !y) fail('NOT_FOUND');
    dropEdge(ctx, a.accountId, a.otherId);
    dropEdge(ctx, a.otherId, a.accountId);
    audit(base(ctx), me.id, 'friend.remove', `${a.accountId}|${a.otherId}`);
  });

  return {
    friendRequest,
    friendAccept,
    friendDecline,
    friendCancel,
    friendRemove,
    friendBlock,
    friendUnblock,
    friendRules,
    myFriends,
    myFriendRequestsIn,
    myFriendRequestsOut,
    myBlocked,
    adminFriendSettings,
    adminSaveFriendSettings,
    adminFriendRules,
    adminSaveFriendRule,
    adminDeleteFriendRule,
    adminPlayerFriends,
    adminRemoveFriendship
  };
}
