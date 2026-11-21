import { sql } from '../src/lib.ts';

export const OWNER = '09120000001';

export function tehranDay(ms = Date.now()) {
  return new Date(ms + 3.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function globalSetup() {
  sql(`DELETE FROM base_otp_daily WHERE key = '${OWNER}|${tehranDay()}'`);
  sql(`DELETE FROM base_otp WHERE phone = '${OWNER}'`);
}
