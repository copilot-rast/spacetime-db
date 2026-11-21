import { supportTables, supportEnv, Attachment, ConfigRule, type SupportSchema } from './schema';
import { defineTickets } from './tickets';
import { defineChat } from './chat';
import { defineReferral } from './referral';
import { defineConfig } from './config';
import { defineActivity } from './activity';
import { seedSupport } from './seed';

export { supportTables, supportEnv, Attachment, ConfigRule, seedSupport };
export type { SupportSchema };
export { recordActivity, nowUs as supportNow } from './engine';
export { resolveKey, factsOf, CONFIG_TYPES } from './config';

export function defineSupport(spacetimedb: unknown) {
  const st = spacetimedb as SupportSchema;
  return { ...defineTickets(st), ...defineChat(st), ...defineReferral(st), ...defineConfig(st), ...defineActivity(st) };
}
