import { playersTables, playersEnv, StoreLink, ReportNote, type PlayersSchema } from './schema';
import { defineRules } from './rules';
import { defineModeration, fileReport, restrict } from './moderation';
import { seedPlayers } from './seed';

export { playersTables, playersEnv, StoreLink, ReportNote, seedPlayers, restrict, fileReport };
export type { PlayersSchema };
export * from './util';

export function definePlayers(spacetimedb: unknown) {
  const st = spacetimedb as PlayersSchema;
  return { ...defineRules(st), ...defineModeration(st) };
}
