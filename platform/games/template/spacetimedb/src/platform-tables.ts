import { baseTables, baseEnv } from '@stg/base';
import { playersTables, playersEnv } from '@stg/players';
import { economyTables, economyEnv } from '@stg/economy';
import { gamificationTables, gamificationEnv } from '@stg/gamification';

export const platformTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables };
export const platformEnv = { ...baseEnv, ...playersEnv, ...economyEnv, ...gamificationEnv };
