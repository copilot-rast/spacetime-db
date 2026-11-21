import { itemsTables, itemsEnv, Price, ItemService, MetaCondition, TagCount, type ItemsSchema } from './schema';
import { defineInventory } from './inventory';
import { defineOffers } from './offers';
import { seedItems } from './seed';

export { itemsTables, itemsEnv, Price, ItemService, MetaCondition, TagCount, seedItems };
export type { ItemsSchema };
export { addItem, takeItem, invRow, owns, contentsOwned, productBlock, nowUs as itemsNow } from './engine';
export { itemUseChecks } from './inventory';

export function defineItems(spacetimedb: unknown) {
  const st = spacetimedb as ItemsSchema;
  return { ...defineOffers(st), ...defineInventory(st) };
}
