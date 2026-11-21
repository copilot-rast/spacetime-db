import { baseTables, baseEnv, Translations, Translation, ROLES, type BaseSchema, type Role } from './schema';
import { defineAuth } from './auth';
import { defineAdmin } from './admin';
import { seedBase } from './seed';

export { baseTables, baseEnv, Translations, Translation, ROLES, seedBase };
export type { BaseSchema, Role };
export * from './util';
export * from './hooks';
export { sendSms, SMS_KINDS } from './sms';

export function defineBase(spacetimedb: unknown) {
  const st = spacetimedb as BaseSchema;
  return { ...defineAuth(st), ...defineAdmin(st) };
}
