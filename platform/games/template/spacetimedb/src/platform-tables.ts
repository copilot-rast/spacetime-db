import { baseTables, baseEnv } from '@stg/base';
import { playersTables, playersEnv } from '@stg/players';
import { economyTables, economyEnv } from '@stg/economy';
import { gamificationTables, gamificationEnv } from '@stg/gamification';
import { itemsTables, itemsEnv } from '@stg/items';
import { promoTables, promoEnv } from '@stg/promo';
import { publicationTables, publicationEnv } from '@stg/publication';
import { socialTables, socialEnv } from '@stg/social';

export const platformTables = { ...baseTables, ...playersTables, ...economyTables, ...gamificationTables, ...itemsTables, ...promoTables, ...publicationTables, ...socialTables };
export const platformEnv = { ...baseEnv, ...playersEnv, ...economyEnv, ...gamificationEnv, ...itemsEnv, ...promoEnv, ...publicationEnv, ...socialEnv };
