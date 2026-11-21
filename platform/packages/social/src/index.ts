import { socialTables, socialEnv, GiftCurrency, type SocialSchema } from './schema';
import { defineFriends } from './friends';
import { defineChat } from './chat';
import { defineQuota } from './quota';
import { defineGifts } from './gifts';
import { defineTick } from './tick';
import { seedSocial } from './seed';

export { socialTables, socialEnv, GiftCurrency, seedSocial };
export type { SocialSchema };
export { applyFilter, filterText, normalizeText } from './filter';
export { areFriends, blockedEither } from './engine';

export function defineSocial(spacetimedb: unknown) {
  const st = spacetimedb as SocialSchema;
  return { ...defineFriends(st), ...defineChat(st), ...defineQuota(st), ...defineGifts(st), ...defineTick(st) };
}
