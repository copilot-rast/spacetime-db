# @stg/items contract

Phase 5: items and inventory (buy, unlock, upgrade, equip, services, starter items), product rules, and personal offers (daily offers and entry offers). Depends on `@stg/base`, `@stg/players` (audiences are player tags), `@stg/economy` (prices, prizes, payments) and `@stg/gamification` (levels, events). Ported from nakama-farsi `docs/economy/spec.md` («Items, inventory and product rules (phase 8)» and «Personal offers (phase 21)»), adapted to tables, reducers, procedures and views.

## Roles

`operator` reads lists, a player's items and offers. `admin` changes item types, items, product rules, offers and settings, gives or takes items, resets a player's offers and moves the test clock. Every admin change writes `base_audit`.

## Hooks into other packages

- `loginHooks`: every login grants missing starter items and stores the last two login times (for the lapsed trigger).
- `extraItemTypes` / `itemHandlers` / `itemValidators`: prize item `{type: 'item', key, action: 'give', value: quantity}` gives an item inside the grant (unique items: value is ignored and a second grant adds nothing, reward value 0; stackable items add up to `maxStack`). An unknown key is refused on save (`ITEM_NOT_FOUND`).
- `purchaseChecks`, `settleChecks`, `purchaseCreatedHooks`, `shopFilters` (new in economy, see below): product rules and offer prices.
- `paymentHooks`: a delivered offer payment counts for its copy and records `offer_bought`.

### New generic hooks in `@stg/economy`

`purchase_start` is now `startPurchase(ctx, {productId, method, giftCode}, context)`; the reducer calls it with `context = ''`. Nothing about items or offers lives in economy.

- `purchaseChecks: (tx, {accountId, product, method, context}, quote) => quote | void`, run in the start transaction before anything is written. The quote is `{available, originalToman, priceToman, discountPercent, coinCurrency, coinAmount, methods, giftAllowed}`, starting from the product itself (`available` = active and visible, and always false with a context). A hook refuses by throwing, or reprices by returning a new quote. After the hooks `available` must be true (`PRODUCT_NOT_FOUND`) and the method must be in `methods` (`METHOD_NOT_ALLOWED`); a gift code needs `giftAllowed` (`GIFT_NOT_ALLOWED`). The payment row stores the quote's prices.
- `purchaseCreatedHooks: (tx, paymentId, req)`, right after the payment row is inserted, in the same transaction.
- `settleChecks: (tx, payment, product) => errorCode | undefined`, run in the grant transaction before the prize. A code refuses delivery: the payment becomes `refused` with that `error` and `rewardError`, coins of an `in_app` payment are refunded at once, and nothing is retried (`admin_retry_grant` answers `NOTHING_TO_RETRY`). A refused gateway or store payment was paid and needs a refund. `purchase_start` with `in_app` then fails with the code.
- `shopFilters: (ctx, accountId, productId) => boolean`, read-only, run by the `shop` view; false hides the product.

## Settings

`items_settings` (id 0): `hideBoughtOneTime` (true), `hideAboveMaxLevel` (true), `requestTtlHours` (24, how long request ids are kept), `clockOffsetSec` (0). `admin_save_items_settings(hideBoughtOneTime, hideAboveMaxLevel, requestTtlHours)`; `admin_items_settings` view (operator).

### Test clock

`admin_set_items_clock_offset(seconds)` (admin, audited, at most ±3650 days) moves the clock of this package only: offer periods, countdowns, cooldowns, account age, login times for the lapsed trigger. Payments, request expiry and every other package keep the real clock (gamification has its own offset). It exists so tests can move days without waiting; keep it at 0 in production.

## Time

Periods and countdowns use Tehran time (UTC+3:30, like `dayKey`). Views have no clock, so every "now" decision (draws, expiry, triggers, timers) happens in procedures; views return stored state only.

## Items

`items_type` (public): `key` (locked), translated `name`, `slots` (how many items of this type can be equipped at once; 0 = not equippable, 1 = an exclusive slot), `sort`, `isSystem`. Seeded: `avatar`, `frame`, `skin`, `board`, `piece`, `ball`, `trail` (1 slot), `emote` (4), `booster`, `other` (0). `admin_save_item_type`, `admin_delete_item_type` (`SYSTEM_ITEM_TYPE`, `IN_USE`).

`items_item` (public): `key` (locked), `typeKey`, translated `name`/`description`, `iconUrl`, `imageUrl`, `categoryId` and `tagIds` (key type `item` or `general`), `rarity` (`common` … `legendary`), `stackable` + `maxStack` (0 = no cap; unique items have quantity 1), `requiresKey` (another item that must be owned first), `isStarter` + `starterQuantity`, `levelTableId` + `unlockLevel`, `price` `{currencyKey, amount}` or none, `upgrades` (`[{currencyKey, amount}]`, the cost of level 1, 2, …; at most 50; unique items only), `services` (`[{key, name, currencyKey, unitPrice, maxUnits ≤ 100, prizeId}]`, at most 20), `usePrizeId` (stackable consumables: paid per unit used), `metadata` (JSON), `sort`, `isActive`. `admin_save_item`, `admin_delete_item` (`IN_USE` when owned, in a prize or required by another item), `admin_items(query, typeKey, isActive, page, pageSize)` with `owners` and `equippedBy`.

Per player (`items_inventory`, private): `itemId`, `itemKey`, `slot` (the type), `quantity`, `level` (upgrade level), `equipped`, `source` (`starter`, `buy`, `unlock`, `prize`, `admin`), `sourceRef`, `ownedAt`. A stackable row is removed when its quantity reaches 0.

### Client calls

- `my_inventory` view: the caller's rows (row type `InventoryEntry`).
- `my_items(typeKey)` → `{total, owned, items[{itemId, key, typeKey, rarity, stackable, owned, quantity, level, maxLevel, equipped, equippable, unlockLevel, playerLevel, locked, requirementMet, canBuy, canUnlock, canUpgrade, nextUpgradePrice}]}` over active items. Also grants missing starters.
- `item_buy(key, quantity, requestId)`: price × quantity (unique items: 1). `ITEM_NOT_FOUND`, `NOT_FOR_SALE`, `INVALID_QUANTITY`, `LEVEL_TOO_LOW`, `REQUIRES_ITEM`, `ALREADY_OWNED`, `STACK_FULL`, `INSUFFICIENT_BALANCE`.
- `item_unlock(key)`: an item with `unlockLevel` and no price, free from that level. `NOT_UNLOCKABLE`, `LEVEL_TOO_LOW`, `REQUIRES_ITEM`, `ALREADY_OWNED`. An item with a price and a level is buyable from that level.
- `item_upgrade(key, fromLevel, requestId)`: pays `upgrades[level]`. `fromLevel` −1 = any; another value must match (`UPGRADE_CHANGED`). `NOT_OWNED`, `UPGRADE_MAXED`.
- `item_equip(key)` → `{itemKey, slot, equipped, unequipped[]}`: when the type's slots are full, the oldest equipped item of that slot comes off. `NOT_OWNED`, `NOT_EQUIPPABLE`. `item_unequip(key)`.
- `item_use(key, service, units, requestId)`: with `service = ''` a stackable item is consumed (`NOT_CONSUMABLE`, `NOT_ENOUGH_ITEMS`) and `usePrizeId` is paid per unit (up to 100); with a service the player pays `unitPrice × units` (`SERVICE_NOT_FOUND`, `INVALID_UNITS`) and gets the service prize per unit. Written to `items_use_log`. The game applies the effect; the server keeps the record.
- `sync_items()`: grants missing starters.

Buy, upgrade and use return `{itemKey, quantity, level, equipped, paid[{currencyKey, amount}], rewards, replayed}`. A `requestId` (`[A-Za-z0-9_.:-]{1,64}`, required for `item_use`, optional for buy and upgrade) makes the call idempotent for `requestTtlHours`: the same id answers the stored result with `replayed = true` and charges nothing; the same id for another action or detail is `REQUEST_ID_REUSED`. `items_tick` (every 10 min) sweeps expired ids.

Events (server only, system): `item_bought` (value = total price), `item_unlocked` (level), `item_upgraded` (new level), `item_equipped`, `item_used` (units), `offer_bought`.

### Starter items

Active starter items are granted once per player and item (`items_starter_given`) at login, by `sync_items` and by `my_items`; a starter added later reaches every player at their next login. The first starter of an equippable type is equipped when that slot is empty. A unique starter cannot be taken back (`STARTER_ITEM`).

Admin: `admin_user_items(accountId)` (inventory and last 50 uses), `admin_give_item(accountId, itemId, quantity, note)` (`ALREADY_OWNED` for an owned unique item), `admin_take_item(accountId, itemId, quantity, note)` (`NOT_OWNED`, `NOT_ENOUGH_ITEMS`, `STARTER_ITEM`).

## Product rules

`items_product_rule` (public), one optional row per product: `minLevel`, `maxLevel` (0 = none), `levelTableId` (0 = the main table: the first active one by `sort`), `isOneTime`, `checkContents` (default true, also when no row exists), translated `purchaseMessage`. `admin_save_product_rule`, `admin_delete_product_rule`. Levels come from `playerLevel(ctx, accountId, tableId)` in `@stg/gamification`.

At start (`purchaseChecks`): `LEVEL_TOO_LOW`, `LEVEL_TOO_HIGH`, `PRODUCT_ALREADY_BOUGHT` (any success payment of the product, delivered or not), and with `checkContents` `PRIZE_ALREADY_OWNED` (the prize gives only unique items the player owns) and `REQUIRES_ITEM` (an item's `requiresKey` is missing and not in the same prize). Levels are checked only at start.

At settlement (`settleChecks`): a one-time product already delivered (or paid by an older payment) refuses with `PRODUCT_ALREADY_BOUGHT`, so two gateway or store payments started in parallel deliver once; owned contents refuse with `PRIZE_ALREADY_OWNED`.

`shop_flags` view (row type `ShopFlagRow`), one row per active product for the caller: `minLevel`, `maxLevel`, `playerLevel`, `isOneTime`, `owned`, `levelLocked`, `aboveMaxLevel`, `requiresItem`, `bought`, `purchaseCount`, `purchaseMessage`, `itemKeys`. The economy `shop` view hides products above `maxLevel` and bought one-time products (the two settings). `my_purchases()` → `[{productId, key, count, lastPurchasedAt}]`. Purchase counts are delivered (`success` and granted) payments; offer purchases count as purchases of their product.

## Personal offers

An offer is a template over a shop product: the product keeps its prize, its rules and its payment methods, and buying an offer is a normal economy purchase at the price frozen in the player's copy.

### Templates (`items_offer`, admin view `admin_offers`)

`key` (locked), `kind` `daily` | `entry` (locked), translated `name` (empty = the product name), `description`, `badge`, `productId`; price: `priceMode` `discount` (`discountPercent` 1–100 on the product's Toman and coin price; 0 keeps the product price and its own discount) or `price` (`priceToman` 0 or ≥ 100, `coinAmount` ≥ 0; −1 keeps the product's); `purchaseLimit` per copy (default 1, 0 = none); `weight` (daily draw, 0 = never drawn); audience: `audienceTagIds` (any of), `excludeTagIds`, `minLevel`/`maxLevel` on `levelTableId`, `metaConditions` `[{metaKey, operator gt|gte|lt|lte|eq, value}]` (≤ 10), `minAccountDays`/`maxAccountDays`; entry only: `triggerType` `first_entry` | `level` (≥ `triggerValue` on table `triggerRefId`, 0 = main) | `meta` (`triggerMetaKey` ≥ value) | `tag` (player tag `triggerRefId`) | `account_days` (≥ value) | `lapsed` (the previous login is at least value days before the latest), `durationMinutes` (1440), `repeat` `once` | `cooldown` with `cooldownHours`, `maxTriggers` (0 = none); `startsAt`/`endsAt` (micros, 0 = open), `isActive`, `sort` (entry priority). `admin_save_offer`, `admin_delete_offer` (`IN_USE` once a copy has a payment; switch it off instead).

### Settings (`items_offer_settings`, id 0; `admin_save_offer_settings`, view `admin_offer_settings`)

| Setting | Default | Meaning |
|---|---|---|
| `dailyEnabled` | true | daily offers on |
| `periodDays`, `resetMinute` | 1, 0 | period length 1–30 days, starting `resetMinute` after Tehran midnight; periods are aligned on 1970-01-01 |
| `count`, `countByTag` | 3, [] | offers per player and period; a player tag in `countByTag` raises it (largest wins) |
| `weighting` | `weighted` | `weighted` (by weight, without replacement), `uniform`, `priority` (heaviest first, ties at random) |
| `noRepeatDays` | 1 | templates the player got in the last N days before this period are drawn only after fresh ones; 0 = off |
| `fillWithRepeats` | true | fill empty slots with those recent templates |
| `boughtCooldownDays` | 7 | a template the player bought is not drawn for N days; −1 = never again; 0 = off |
| `excludeOwned` | true | skip a template whose product only gives items the player owns |
| `respectProductRules` | true | skip a template whose product the player cannot buy now (level, one-time, contents, non-repeatable prize received) |
| `inactiveProducts` | `allow` | `allow`: a product switched off in the shop can still be sold as an offer (offer-only packs); `skip` |
| `showSoldOut` | true | a bought-out copy stays listed with `soldOut` until it ends |
| `giftCodes` | false | gateway discount codes also apply on an offer price |
| `rerollEnabled`, `rerollLimit` | true, 3 | rerolls per period (0 = no limit) |
| `rerollFree`, `rerollCurrency`, `rerollCost`, `rerollCostStep` | 1, '', 0, 0 | the first `rerollFree` rerolls are free, then each costs `rerollCost + step × (n − free)`; no currency or cost 0 = always free |
| `rerollAvoidCurrent` | true | the new draw leaves out the offers it replaces |
| `entryEnabled`, `entryMaxActive` | true, 1 | entry offers on; copies open at once per player (bought-out ones do not count) |
| `entryTimerStart` | `list` | when a countdown starts: `list` (the first `my_offers` that returns it) or `seen` (`offer_seen`, or the first buy) |

Errors: `INVALID_SETTING:<field>`, `INVALID_POLICY`, `CURRENCY_NOT_FOUND`, `DUPLICATE_TAG`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`.

### Daily selection

The first `my_offers` (or reroll) of a period draws the player's set once (`items_offer_period` keeps `drawn` and the reroll count): active daily templates in their window, minus those the audience, levels, metas, account age, product checks, payment methods (`no_method`), bought cooldown or weight 0 rule out. Each candidate gets `u = HMAC(OTP_SECRET, "offer-draw|account|period|reroll|offer")`; `weighted` sorts by `−ln(u) / weight`, so the same player, period and reroll always get the same set. Copies (`items_user_offer`) keep their price for the whole period even if the template changes; switching the template off hides them at once.

`offers_reroll()` checks `REROLL_DISABLED`, `REROLL_LIMIT`, `NOTHING_TO_REROLL` (every copy bought), takes the cost, and in one transaction replaces every unbought copy (`replaced`) with a new draw in the same slots; bought copies stay. An empty draw is `NO_OFFERS_LEFT` and nothing is paid.

### Entry offers

On every `my_offers` started entry copies whose timer ended become `expired` (gone for good), then templates are judged in `sort` order: rules, product checks, and the trigger. A template opens a copy when it holds, no copy of it is open, `maxTriggers` is not reached, and either it never opened or `repeat` is `cooldown`, `cooldownHours` passed since the last copy ended and, for `lapsed`, the return is newer than that copy. The countdown is the player's own: `expiresAt = start + durationMinutes`.

### Buying

`offer_buy(userOfferId, method, giftCode)` returns the `purchase_start` answer. It checks that the copy is the caller's and active, its template active, the copy's period is the current one or its entry timer has not ended (`OFFER_EXPIRED`; an unstarted timer starts), the offer audience (`OFFER_NOT_FOUND`) and the limit (`OFFER_SOLD_OUT`: success payments of the copy, so coin purchases count at once and gateway or store payments count when paid). The product is then sold at the frozen price through the normal flow: `in_app` needs a coin price, gateways a Toman price of 0 or ≥ 100, and stores only when the frozen Toman price equals the product's own (the product SKU is used; offer SKUs are not built). Product rules still apply; the offer's audience replaces the product audience and its shop switch. A delivered payment raises the copy's `bought` and records `offer_bought` (value = Toman, or coins for `in_app`).

### Client calls

- `my_offers()` → `{now, daily{enabled, period, periodStart, periodEnd, secondsLeft, items, reroll{enabled, used, limit, left, currencyKey, nextCost}}, entry{enabled, timerStart, items}, paid}`; an item is `{userOfferId, offerId, key, kind, name, description, badge, productId, productKey, iconUrl, coverUrl, originalToman, finalToman, coinCurrency, coinAmount, coinOriginal, discountPercent, paymentMethods, purchaseLimit, bought, remaining, soldOut, started, expiresAt, secondsLeft, shownAt, slot, durationMinutes}`. Times are micros on the items clock.
- `offers_reroll()` → the same answer with `paid` `{currencyKey, amount}`.
- `offer_seen(userOfferId)` → `{userOfferId, expiresAt, secondsLeft}`: marks the copy shown and starts an entry countdown in `seen` mode.
- `offer_buy(userOfferId, method, giftCode)`.

Admin: `admin_player_offers(accountId)` (last 200 copies and the current period), `admin_reset_daily_offers(accountId)` (closes this period's copies and draws again on the next call), `admin_reset_entry_offer(accountId, offerId)` (forgets the history so the trigger can open it again; payments stay), `admin_expire_offer(userOfferId)`.

## Seed

Item and offer settings rows, key type `item`, the ten item types, the six system event types and the 10-minute `items_tick` timer. Idempotent; also runs on `clientConnected`.

## Not ported

Friend gifts (after the social phase), offer SKUs for stores, the offer preview and report pages, the console pages and Star Catcher.

## Error codes

`NOT_FOUND`, `NOT_INITIALIZED`, `FORBIDDEN`, `USER_NOT_FOUND`, `INVALID_KEY`, `KEY_LOCKED`, `KEY_TAKEN`, `KIND_LOCKED`, `IN_USE`, `INVALID_SLOTS`, `SYSTEM_ITEM_TYPE`, `ITEM_TYPE_NOT_FOUND`, `INVALID_RARITY`, `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `SELF_REFERENCE`, `ITEM_NOT_FOUND`, `STARTER_HAS_LEVEL`, `LEVEL_TABLE_NOT_FOUND`, `INVALID_LEVEL`, `CURRENCY_NOT_FOUND`, `INVALID_PRICE`, `STACKABLE_NO_UPGRADES`, `TOO_MANY_UPGRADES`, `TOO_MANY_SERVICES`, `DUPLICATE_SERVICE`, `INVALID_UNITS`, `PRIZE_NOT_FOUND`, `NOT_CONSUMABLE`, `METADATA_TOO_LARGE`, `INVALID_METADATA`, `INVALID_URL`, `INVALID_VALUE`, `INVALID_QUANTITY`, `NOT_FOR_SALE`, `LEVEL_TOO_LOW`, `LEVEL_TOO_HIGH`, `REQUIRES_ITEM`, `ALREADY_OWNED`, `STACK_FULL`, `INSUFFICIENT_BALANCE`, `NOT_UNLOCKABLE`, `NOT_OWNED`, `NOT_ENOUGH_ITEMS`, `UPGRADE_CHANGED`, `UPGRADE_MAXED`, `NOT_EQUIPPABLE`, `SERVICE_NOT_FOUND`, `STARTER_ITEM`, `REQUEST_ID_REQUIRED`, `INVALID_REQUEST_ID`, `REQUEST_ID_REUSED`, `PRODUCT_NOT_FOUND`, `INVALID_LEVEL_RANGE`, `PRODUCT_ALREADY_BOUGHT`, `PRIZE_ALREADY_OWNED`, `INVALID_CLOCK_OFFSET`, `INVALID_RULE:requestTtlHours`, `INVALID_KIND`, `INVALID_PRICE_MODE`, `INVALID_DISCOUNT`, `PRICE_REQUIRED`, `INVALID_LIMIT`, `INVALID_WEIGHT`, `TOO_MANY_CONDITIONS`, `META_NOT_FOUND`, `INVALID_OPERATOR`, `INVALID_DAYS`, `INVALID_WINDOW`, `INVALID_TRIGGER`, `INVALID_DURATION`, `INVALID_REPEAT`, `INVALID_COOLDOWN`, `INVALID_MAX_TRIGGERS`, `INVALID_SETTING:<field>`, `INVALID_POLICY`, `DUPLICATE_TAG`, `OFFER_NOT_FOUND`, `OFFER_PRODUCT_MISMATCH`, `OFFER_EXPIRED`, `OFFER_SOLD_OUT`, `GIFT_NOT_ALLOWED`, `METHOD_NOT_ALLOWED`, `REROLL_DISABLED`, `REROLL_LIMIT`, `NOTHING_TO_REROLL`, `NO_OFFERS_LEFT`, `NOT_ACTIVE`.
