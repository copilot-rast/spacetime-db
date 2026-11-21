import { baseTables, baseEnv } from '@stg/base';
import { playersTables, playersEnv } from '@stg/players';
import { economyTables, economyEnv } from '@stg/economy';

export const platformTables = { ...baseTables, ...playersTables, ...economyTables };
export const platformEnv = { ...baseEnv, ...playersEnv, ...economyEnv };
