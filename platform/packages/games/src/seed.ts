import { ScheduleAt } from 'spacetimedb';
import { SYSTEM_EVENTS, defaultsOf, emptyReq, gameRegistry, type GTx } from './engine';

const tr = (fa: string, en: string) => [
  { lang: 'fa', text: fa },
  { lang: 'en', text: en },
];

export function seedGames(raw: unknown) {
  const ctx = raw as GTx;
  if (!ctx.db.gamesSettings.id.find(0)) {
    ctx.db.gamesSettings.insert({ id: 0, ticketTtlSeconds: 300, startTimeoutSeconds: 60, playTimeoutSeconds: 3600, maxTicketsPerPlayer: 3, payoutMaxTries: 8, weekStart: 6, monthCalendar: 'jalali', historyDays: 90, clockOffsetSec: 0n, updatedAt: ctx.timestamp });
  }
  if (!ctx.db.keyType.key.find('game')) ctx.db.keyType.insert({ key: 'game', title: tr('بازی', 'Game'), forCategory: true, forTag: true, system: true });
  SYSTEM_EVENTS.forEach(([key, fa, en], i) => {
    if (ctx.db.eventType.key.find(key)) return;
    ctx.db.eventType.insert({ id: 0n, key, name: tr(fa, en), description: [], clientAllowed: false, valueMin: -1e15, valueMax: 1e15, rateLimit: 0, isActive: true, isSystem: true, sort: 200 + i, createdAt: ctx.timestamp });
  });
  for (const def of gameRegistry.values()) {
    const old = ctx.db.game.key.find(def.key);
    if (old) {
      if (!old.registered || old.realtime !== def.realtime || old.codeName !== def.name || old.settingsSchema !== def.settingsSchema) {
        let settings = old.settings;
        try {
          settings = JSON.stringify({ ...defaultsOf(def.settingsSchema), ...(JSON.parse(old.settings || '{}') as object) });
        } catch {
          settings = JSON.stringify(defaultsOf(def.settingsSchema));
        }
        ctx.db.game.id.update({ ...old, registered: true, realtime: def.realtime, codeName: def.name, settingsSchema: def.settingsSchema, settings, updatedAt: ctx.timestamp });
      }
      continue;
    }
    const g = ctx.db.game.insert({
      id: 0n,
      key: def.key,
      registered: true,
      realtime: def.realtime,
      codeName: def.name,
      settingsSchema: def.settingsSchema,
      name: [{ lang: 'en', text: def.name }],
      description: [],
      iconUrl: '',
      isActive: true,
      maintenance: false,
      maintenanceMessage: [],
      sort: 0,
      categoryId: 0n,
      tagIds: [],
      minPlayers: def.minPlayers,
      maxPlayers: def.maxPlayers,
      turnSeconds: 0,
      matchSeconds: 0,
      botsAllowed: false,
      botAfterSeconds: 20,
      friendAllowed: true,
      platforms: [],
      minVersions: [],
      skillMetaKey: '',
      bandSize: 3,
      widenEverySeconds: 10,
      widenStep: 2,
      maxBand: 0,
      fillAfterSeconds: 30,
      settings: JSON.stringify(defaultsOf(def.settingsSchema)),
      requirements: emptyReq(),
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    if (![...ctx.db.gameRoom.gameId.filter(g.id)].length) {
      ctx.db.gameRoom.insert({ id: 0n, gameId: g.id, key: 'main', name: tr('اتاق اصلی', 'Main room'), entryCurrency: '', entryFee: 0n, prizeId: 0n, prizeGroupId: 0n, minLevel: 0, isLocked: false, isHidden: false, isActive: true, inheritGame: true, requirements: emptyReq(), sort: 0, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
    }
  }
  for (const g of [...ctx.db.game.iter()]) {
    if (g.registered && !gameRegistry.has(g.key)) ctx.db.game.id.update({ ...g, registered: false, updatedAt: ctx.timestamp });
  }
  if (ctx.db.gamesTickTimer.count() === 0n) ctx.db.gamesTickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(2_000_000n) });
}
