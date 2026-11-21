import { promoTables, promoEnv, ChanceSlot, TicketPrice, type PromoSchema } from './schema';
import { defineBanners } from './banners';
import { defineSponsors } from './sponsors';
import { defineChance } from './chance';
import { seedPromo } from './seed';

export { promoTables, promoEnv, ChanceSlot, TicketPrice, seedPromo };
export type { PromoSchema };
export { CHANCE_STATUS } from './chance';
export { nowUs as promoNow, bannerBlock, sponsorLive } from './engine';

export function definePromo(spacetimedb: unknown) {
  const st = spacetimedb as PromoSchema;
  return { ...defineBanners(st), ...defineSponsors(st), ...defineChance(st) };
}
