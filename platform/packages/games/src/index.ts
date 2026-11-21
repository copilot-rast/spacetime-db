import { gamesTables, gamesEnv, Requirements, MetaRequirement, MinVersion, RankReward, MatchResult, type GamesSchema } from './schema';
import { defineCatalog } from './catalog';
import { defineBoards } from './boards';
import { seedGames } from './seed';

export { gamesTables, gamesEnv, Requirements, MetaRequirement, MinVersion, RankReward, MatchResult, seedGames };
export type { GamesSchema };
export { registerGame, finishMatch, startMatch, submitScore, gameSettingsOf, entryCheck, cancelMatch, toJalali, periodKey, nowUs as gamesNow, type GameDef, type Result as GameResult } from './engine';
export { cleanReq } from './catalog';

export function defineGames(spacetimedb: unknown) {
  const st = spacetimedb as GamesSchema;
  return { ...defineCatalog(st), ...defineBoards(st) };
}
