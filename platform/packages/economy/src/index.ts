import { economyTables, economyEnv, PrizeItem, GroupEntry, type EconomySchema } from './schema';
import { defineCatalog } from './catalog';
import { definePayments } from './payments';
import { seedEconomy } from './seed';

export { economyTables, economyEnv, PrizeItem, GroupEntry, seedEconomy };
export type { EconomySchema };
export * from './engine';
export { checkGift, prizeUseChecks, metaUseChecks, itemValidators, shopFilters, discounted, productVisible, activeMethods, METHODS, GATEWAYS, STORES } from './catalog';
export { paymentHooks, grantPayment, startPurchase, purchaseChecks, purchaseCreatedHooks, settleChecks, StartResult, type PurchaseQuote, type PurchaseRequest, type ProductRow, type PaymentRow } from './payments';

export function defineEconomy(spacetimedb: unknown) {
  const st = spacetimedb as EconomySchema;
  return { ...defineCatalog(st), ...definePayments(st) };
}
