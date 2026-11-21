import { baseTables, baseEnv } from '@stg/base';
import { playersTables, playersEnv } from '@stg/players';

export const platformTables = { ...baseTables, ...playersTables };
export const platformEnv = { ...baseEnv, ...playersEnv };
