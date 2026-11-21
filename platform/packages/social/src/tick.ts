import { requireRole } from '@stg/base';
import { socialTables, type SocialSchema } from './schema';
import { MIN_US, base, nowUs, type STx } from './engine';
import { dropPair } from './friends';
import { giftTick } from './gifts';

export function socialSweep(ctx: STx) {
  const now = nowUs(ctx);
  for (const e of [...ctx.db.edge.iter()]) {
    if ((e.state === 'sent' || e.state === 'received') && e.expiresAt && e.expiresAt <= now) dropPair(ctx, e.accountId, e.otherId);
  }
  giftTick(ctx);
  const minute = ctx.timestamp.microsSinceUnixEpoch / MIN_US;
  for (const r of [...ctx.db.socialRate.iter()]) if (r.minute < minute - 2n) ctx.db.socialRate.key.delete(r.key);
}

export function defineTick(st: SocialSchema) {
  const socialTick = st.reducer({ onSchedule: socialTables.socialTickTimer }, { timer: socialTables.socialTickTimer.rowType }, ctx => {
    socialSweep(ctx);
  });

  const adminSocialRun = st.reducer(ctx => {
    requireRole(base(ctx), 'admin');
    socialSweep(ctx);
  });

  return {
    socialTick,
    adminSocialRun
  };
}
