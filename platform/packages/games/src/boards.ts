import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, cleanKey, cleanTranslations, fail, requireAccount, requireRole, type Tr } from '@stg/base';
import { prizeGroupUseChecks, prizeUseChecks } from '@stg/economy';
import { RankReward, gamesRows, type GamesSchema } from './schema';
import { archiveBoard, base, gamesSettings, nowUs, page, periodKey, rerank, rollover, runPayouts, writeScore, type BoardRow, type GDb, type GTx } from './engine';

const PERIODS = ['all', 'daily', 'weekly', 'monthly'];
const MODES = ['best', 'sum', 'last'];
const SOURCES = ['score', 'wins', 'server'];

const BoardLine = t.row('LeaderboardLine', {
  id: t.u64().primaryKey(),
  key: t.string(),
  gameKey: t.string(),
  name: Translations,
  description: Translations,
  iconUrl: t.string(),
  period: t.string(),
  currentPeriod: t.string(),
  scoreMode: t.string(),
  order: t.string(),
  topN: t.u32(),
  players: t.u32(),
  myRank: t.u32(),
  myScore: t.f64(),
  rewards: t.array(RankReward),
  sort: t.i32(),
});
const TopLine = t.row('LeaderboardTopLine', {
  id: t.u64().primaryKey(),
  boardKey: t.string(),
  rank: t.u32(),
  name: t.string(),
  score: t.f64(),
  me: t.bool(),
});
const Standing = t.object('LeaderboardStanding', { accountId: t.u64(), displayName: t.string(), rank: t.u32(), score: t.f64(), writes: t.u32() });
const StandingPage = t.object('LeaderboardStandingPage', { period: t.string(), total: t.u32(), rows: t.array(Standing) });
const PeriodPage = t.object('LeaderboardPeriodPage', { total: t.u32(), rows: t.array(gamesRows.lbPeriod) });
const ResultLine = t.object('LeaderboardResultLine', { result: gamesRows.lbResult, displayName: t.string(), payoutStatus: t.string(), payoutId: t.u64() });
const HistoryLine = t.object('LeaderboardHistoryLine', { boardKey: t.string(), period: t.string(), endedAt: t.u64(), players: t.u32(), rank: t.u32(), score: t.f64(), prizeId: t.u64(), prizeGroupId: t.u64(), payoutStatus: t.string() });
const WinnerLine = t.object('LeaderboardWinnerLine', { rank: t.u32(), name: t.string(), score: t.f64(), me: t.bool() });
const Winners = t.object('LeaderboardWinners', { boardKey: t.string(), period: t.string(), endedAt: t.u64(), players: t.u32(), winners: t.array(WinnerLine) });

function sessionId(ctx: { db: GTx['db']; sender: GTx['sender'] }) {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return undefined;
  const a = ctx.db.account.id.find(s.accountId);
  return a && a.status === 'active' ? a.id : undefined;
}

function liveRows(ctx: GDb, lb: BoardRow) {
  return [...ctx.db.lbScore.byBoardPeriod.filter([lb.id, lb.currentPeriod])];
}

function payoutOf(ctx: GDb, periodId: bigint, accountId: bigint) {
  return ctx.db.gamePayout.uniq.find(`lb|${periodId}|${accountId}`);
}

function boardUses(ctx: GDb, test: (r: { prizeId: bigint; prizeGroupId: bigint }) => boolean) {
  return [...ctx.db.leaderboard.iter()].some(l => l.rewards.some(test));
}

export function defineBoards(st: GamesSchema) {
  prizeUseChecks.push((ctx, id) => boardUses(ctx as unknown as GDb, r => r.prizeId === id));
  prizeGroupUseChecks.push((ctx, id) => boardUses(ctx as unknown as GDb, r => r.prizeGroupId === id));

  const leaderboards = st.view({ name: 'leaderboards', public: true }, t.array(BoardLine), ctx => {
    try {
      const me = sessionId(ctx as any);
      return [...ctx.db.leaderboard.iter()]
        .filter(l => l.isActive)
        .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))
        .map(l => {
          const mine = me === undefined ? undefined : ctx.db.lbScore.uniq.find(`${l.id}|${l.currentPeriod}|${me}`);
          return {
            id: l.id,
            key: l.key,
            gameKey: l.gameId ? ctx.db.game.id.find(l.gameId)?.key ?? '' : '',
            name: l.name,
            description: l.description,
            iconUrl: l.iconUrl,
            period: l.period,
            currentPeriod: l.currentPeriod,
            scoreMode: l.scoreMode,
            order: l.order,
            topN: l.topN,
            players: liveRows(ctx as any, l).length,
            myRank: mine?.rank ?? 0,
            myScore: mine?.score ?? 0,
            rewards: l.rewards,
            sort: l.sort,
          };
        });
    } catch {
      return [];
    }
  });

  const leaderboardTop = st.view({ name: 'leaderboard_top', public: true }, t.array(TopLine), ctx => {
    try {
      const me = sessionId(ctx as any);
      const out = [];
      for (const l of ctx.db.leaderboard.iter()) {
        if (!l.isActive) continue;
        for (const r of liveRows(ctx as any, l)) {
          if (r.rank < 1 || (r.rank > l.topN && r.accountId !== me)) continue;
          out.push({ id: r.id, boardKey: l.key, rank: r.rank, name: ctx.db.account.id.find(r.accountId)?.displayName ?? '', score: r.score, me: r.accountId === me });
        }
      }
      return out;
    } catch {
      return [];
    }
  });

  const leaderboardHistory = st.procedure({ boardKey: t.string(), limit: t.u32() }, t.array(HistoryLine), (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const limit = Math.min(Math.max(a.limit || 20, 1), 100);
      const key = a.boardKey.trim();
      return [...tx.db.lbResult.accountId.filter(me.id)]
        .sort((x, y) => (x.id < y.id ? 1 : -1))
        .map(r => ({ r, lb: tx.db.leaderboard.id.find(r.boardId), per: tx.db.lbPeriod.id.find(r.periodId) }))
        .filter(x => !!x.per && (!key || x.lb?.key === key))
        .slice(0, limit)
        .map(({ r, lb, per }) => ({ boardKey: lb?.key ?? '', period: per!.period, endedAt: per!.endedAt, players: per!.players, rank: r.rank, score: r.score, prizeId: r.prizeId, prizeGroupId: r.prizeGroupId, payoutStatus: payoutOf(tx, r.periodId, me.id)?.status ?? '' }));
    })
  );

  const leaderboardWinners = st.procedure({ boardKey: t.string(), periodId: t.u64(), limit: t.u32() }, Winners, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const lb = tx.db.leaderboard.key.find(a.boardKey.trim());
      if (!lb || !lb.isActive) fail('LEADERBOARD_NOT_FOUND');
      const periods = [...tx.db.lbPeriod.boardId.filter(lb.id)].sort((x, y) => (x.id < y.id ? 1 : -1));
      const per = a.periodId ? periods.find(p => p.id === a.periodId) : periods[0];
      if (!per) fail('LEADERBOARD_PERIOD_NOT_FOUND');
      const limit = Math.min(Math.max(a.limit || 10, 1), 100);
      const winners = [...tx.db.lbResult.periodId.filter(per.id)]
        .sort((x, y) => x.rank - y.rank)
        .slice(0, limit)
        .map(r => ({ rank: r.rank, name: tx.db.account.id.find(r.accountId)?.displayName ?? '', score: r.score, me: r.accountId === me.id }));
      return { boardKey: lb.key, period: per.period, endedAt: per.endedAt, players: per.players, winners };
    })
  );

  const adminLeaderboards = st.view({ name: 'admin_leaderboards', public: true }, t.array(gamesRows.leaderboard), ctx => (adminOrNull(ctx as any) ? [...ctx.db.leaderboard.iter()] : []));

  const adminSaveLeaderboard = st.reducer(
    {
      id: t.u64(),
      key: t.string(),
      gameId: t.u64(),
      name: Translations,
      description: Translations,
      iconUrl: t.string(),
      period: t.string(),
      scoreMode: t.string(),
      order: t.string(),
      source: t.string(),
      topN: t.u32(),
      rewards: t.array(RankReward),
      isActive: t.bool(),
      sort: t.i32(),
    },
    (ctx, a) => {
      const me = requireRole(base(ctx), 'admin');
      const key = cleanKey(a.key);
      const old = a.id ? ctx.db.leaderboard.id.find(a.id) : undefined;
      if (a.id && !old) fail('NOT_FOUND');
      if (old && old.key !== key) fail('KEY_LOCKED');
      const same = ctx.db.leaderboard.key.find(key);
      if (same && same.id !== a.id) fail('KEY_TAKEN');
      if (a.gameId && !ctx.db.game.id.find(a.gameId)) fail('GAME_NOT_FOUND');
      if (!PERIODS.includes(a.period)) fail('INVALID_PERIOD');
      if (!MODES.includes(a.scoreMode)) fail('INVALID_SCORE_MODE');
      if (!['desc', 'asc'].includes(a.order)) fail('INVALID_ORDER');
      if (!SOURCES.includes(a.source)) fail('INVALID_SOURCE');
      if (a.source !== 'server' && !a.gameId) fail('SOURCE_NEEDS_GAME');
      if (a.topN > 200) fail('INVALID_TOP_N');
      if (a.rewards.length > 20) fail('TOO_MANY_REWARDS');
      for (const r of a.rewards) {
        if (r.fromRank < 1 || (r.toRank && r.toRank < r.fromRank)) fail('INVALID_RANK_RANGE');
        if (!!r.prizeId === !!r.prizeGroupId) fail('PRIZE_OR_GROUP');
        if (r.prizeId && !ctx.db.prize.id.find(r.prizeId)) fail('PRIZE_NOT_FOUND');
        if (r.prizeGroupId && !ctx.db.prizeGroup.id.find(r.prizeGroupId)) fail('PRIZE_GROUP_NOT_FOUND');
      }
      const now = nowUs(ctx);
      const s = gamesSettings(ctx);
      const row = {
        id: a.id,
        key,
        gameId: a.gameId,
        name: cleanTranslations(a.name as Tr[], base(ctx), true),
        description: cleanTranslations(a.description as Tr[], base(ctx), false),
        iconUrl: a.iconUrl.trim().slice(0, 500),
        period: a.period,
        scoreMode: a.scoreMode,
        order: a.order,
        source: a.source,
        topN: a.topN || 50,
        rewards: [...a.rewards].sort((x, y) => x.fromRank - y.fromRank),
        isActive: a.isActive,
        sort: a.sort,
        currentPeriod: old?.currentPeriod ?? periodKey(a.period, now, s),
        periodStartedAt: old?.periodStartedAt ?? now,
        resets: old?.resets ?? 0,
        createdAt: old?.createdAt ?? ctx.timestamp,
        updatedAt: ctx.timestamp,
      };
      if (!old) {
        const saved = ctx.db.leaderboard.insert({ ...row, id: 0n });
        audit(base(ctx), me.id, 'leaderboard.create', String(saved.id), key);
        return;
      }
      let saved = ctx.db.leaderboard.id.update(row);
      if (old.period !== a.period) saved = archiveBoard(ctx, saved, 'restart', false, `${periodKey(a.period, now, s)}#${saved.resets + 1}`, now);
      else if (old.order !== a.order) rerank(ctx, saved);
      audit(base(ctx), me.id, 'leaderboard.update', String(saved.id), key);
    }
  );

  const adminDeleteLeaderboard = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    const lb = ctx.db.leaderboard.id.find(id);
    if (!lb) fail('NOT_FOUND');
    for (const per of ctx.db.lbPeriod.boardId.filter(id)) {
      if ([...ctx.db.gamePayout.refId.filter(per.id)].some(p => p.kind === 'leaderboard' && p.status !== 'granted')) fail('IN_USE');
    }
    for (const r of liveRows(ctx, lb)) ctx.db.lbScore.id.delete(r.id);
    ctx.db.leaderboard.id.delete(id);
    audit(base(ctx), me.id, 'leaderboard.delete', String(id), lb.key);
  });

  const adminResetLeaderboard = st.reducer({ id: t.u64(), pay: t.bool() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const lb = ctx.db.leaderboard.id.find(a.id);
    if (!lb) fail('NOT_FOUND');
    const now = nowUs(ctx);
    const cur = rollover(ctx, lb, now);
    archiveBoard(ctx, cur, 'manual', a.pay, `${periodKey(cur.period, now, gamesSettings(ctx))}#${cur.resets + 1}`, now);
    audit(base(ctx), me.id, 'leaderboard.reset', String(lb.id), JSON.stringify({ pay: a.pay, period: cur.currentPeriod }));
  });

  const adminSetLeaderboardScore = st.reducer({ boardId: t.u64(), accountId: t.u64(), score: t.f64(), mode: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const lb = ctx.db.leaderboard.id.find(a.boardId);
    if (!lb) fail('NOT_FOUND');
    if (!ctx.db.account.id.find(a.accountId)) fail('ACCOUNT_NOT_FOUND');
    const now = nowUs(ctx);
    if (a.mode === 'remove') {
      const cur = rollover(ctx, lb, now);
      const row = ctx.db.lbScore.uniq.find(`${cur.id}|${cur.currentPeriod}|${a.accountId}`);
      if (row) ctx.db.lbScore.id.delete(row.id);
      rerank(ctx, cur);
    } else {
      if (!['set', 'add'].includes(a.mode)) fail('INVALID_MODE');
      writeScore(ctx, lb, a.accountId, a.score, a.mode === 'set' ? 'last' : 'sum', now);
    }
    audit(base(ctx), me.id, 'leaderboard.score', String(lb.id), JSON.stringify({ accountId: String(a.accountId), score: a.score, mode: a.mode }));
  });

  const adminLeaderboardStandings = st.procedure({ boardId: t.u64(), page: t.u32(), pageSize: t.u32() }, StandingPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const lb = tx.db.leaderboard.id.find(a.boardId);
      if (!lb) fail('NOT_FOUND');
      const rows = liveRows(tx, lb)
        .sort((x, y) => x.rank - y.rank)
        .map(r => ({ accountId: r.accountId, displayName: tx.db.account.id.find(r.accountId)?.displayName ?? '', rank: r.rank, score: r.score, writes: r.writes }));
      return { period: lb.currentPeriod, ...page(rows, a.page, a.pageSize) };
    })
  );

  const adminLeaderboardPeriods = st.procedure({ boardId: t.u64(), page: t.u32(), pageSize: t.u32() }, PeriodPage, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      return page([...tx.db.lbPeriod.boardId.filter(a.boardId)].sort((x, y) => (x.id < y.id ? 1 : -1)), a.page, a.pageSize);
    })
  );

  const adminLeaderboardResults = st.procedure({ periodId: t.u64() }, t.array(ResultLine), (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      return [...tx.db.lbResult.periodId.filter(a.periodId)]
        .sort((x, y) => x.rank - y.rank)
        .map(r => {
          const p = payoutOf(tx, r.periodId, r.accountId);
          return { result: r, displayName: tx.db.account.id.find(r.accountId)?.displayName ?? '', payoutStatus: p?.status ?? '', payoutId: p?.id ?? 0n };
        });
    })
  );

  const adminLeaderboardPay = st.procedure({ periodId: t.u64() }, t.u32(), (ctx, a) => {
    const ids = ctx.withTx(tx => {
      requireRole(base(tx), 'admin');
      return [...tx.db.gamePayout.refId.filter(a.periodId)].filter(p => p.kind === 'leaderboard' && p.status === 'pending').map(p => p.id);
    });
    return runPayouts(ctx, ids);
  });

  return {
    leaderboards,
    leaderboardTop,
    leaderboardHistory,
    leaderboardWinners,
    adminLeaderboards,
    adminSaveLeaderboard,
    adminDeleteLeaderboard,
    adminResetLeaderboard,
    adminSetLeaderboardScore,
    adminLeaderboardStandings,
    adminLeaderboardPeriods,
    adminLeaderboardResults,
    adminLeaderboardPay,
  };
}
