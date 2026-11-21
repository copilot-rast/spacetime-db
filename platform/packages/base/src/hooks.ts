import type { Tx } from './util';

export type GuardResult = { code: string; detail: string } | undefined;
export type AccountGuard = (ctx: Tx, accountId: bigint) => GuardResult;
export type ProfileValidator = (ctx: Tx, accountId: bigint, displayName: string) => void;

export const accountGuards: AccountGuard[] = [];
export const profileValidators: ProfileValidator[] = [];
export type LoginHook = (ctx: Tx, accountId: bigint, isNew: boolean) => void;
export const loginHooks: LoginHook[] = [];

export function checkAccountGuards(ctx: Tx, accountId: bigint): GuardResult {
  for (const g of accountGuards) {
    const r = g(ctx, accountId);
    if (r) return r;
  }
  return undefined;
}

export type ActivityEntry = { kind: string; action: string; refId?: string; data?: string; actor?: string };
export type ActivityWriter = (ctx: Tx, accountId: bigint, e: ActivityEntry) => void;
export const activityWriters: ActivityWriter[] = [];

export function logActivity(ctx: unknown, accountId: bigint, e: ActivityEntry) {
  for (const w of activityWriters) w(ctx as Tx, accountId, e);
}
