import { gamificationTables, gamificationEnv, LevelStep, StreakDay, RelationTarget, AchievementTier, type GamificationSchema } from './schema';
import { defineEvents } from './events';
import { defineMissions } from './missions';
import { seedGamification } from './seed';

export { gamificationTables, gamificationEnv, LevelStep, StreakDay, RelationTarget, AchievementTier, seedGamification };
export type { GamificationSchema };
export { recordEvent, giveAchievement, nowMicros, dayNumber, windowOf, playerLevel, mainLevelTable, userLevelOf, type Outcome } from './engine';

export function defineGamification(spacetimedb: unknown) {
  const st = spacetimedb as GamificationSchema;
  return { ...defineEvents(st), ...defineMissions(st) };
}
