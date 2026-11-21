import { t } from 'spacetimedb/server';
import { fail, requireAccount, sign } from '@stg/base';
import { finishMatch, gameSettingsOf, registerGame } from '@stg/games';
import spacetimedb from '../schema';

const SAMPLE_GAME = registerGame({
  key: 'sample_duel',
  name: 'Sample Duel',
  realtime: true,
  minPlayers: 2,
  maxPlayers: 2,
  settingsSchema: {
    type: 'object',
    properties: {
      rounds: { type: 'integer', minimum: 1, maximum: 9, default: 3 },
      theme: { type: 'string', enum: ['day', 'night'], default: 'day' },
    },
    additionalProperties: false,
  },
});

registerGame({ key: 'sample_party', name: 'Sample Party', minPlayers: 2, maxPlayers: 4 });

export const sampleDuelPlay = spacetimedb.reducer({ matchId: t.u64() }, (ctx, a) => {
  const me = requireAccount(ctx as never);
  const m = ctx.db.gameMatch.id.find(a.matchId);
  if (!m || m.gameKey !== SAMPLE_GAME) fail('MATCH_NOT_FOUND');
  if (!m.players.includes(me.id)) fail('NOT_IN_MATCH');
  const rounds = Number(gameSettingsOf(ctx, SAMPLE_GAME).rounds ?? 3);
  const mac = sign(ctx.env.OTP_SECRET, `sample_duel|${m.id}`);
  const seats = m.players.length + m.bots;
  const winner = mac[0] % seats;
  finishMatch(
    ctx,
    m.id,
    m.players.map((accountId, i) => ({ accountId, rank: i === winner ? 1 : 2, score: i === winner ? rounds : mac[1 + i] % rounds })),
  );
});
