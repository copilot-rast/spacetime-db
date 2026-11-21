# @stg/economy contract

Phase 3: currencies, metas, prizes, prize groups, shop, gift codes and payments (ZarinPal, Zibal, Cafe Bazaar, Myket, in-game coins). Depends on `@stg/base` and `@stg/players` (product audiences use player tags). Google Play, Apple and Stripe are not built yet.

## Roles

`operator` reads lists, payments and a player's economy. `admin` changes the catalog, payment methods and settings, grants prizes and adjusts balances.

## Public tables

`economy_currency` (key, translated name, `soft` | `hard`, `defaultValue`, icon, category and tags of key type `currency`), `economy_meta` (key, name, `defaultValue`, `serverOnly`), `economy_prize`, `economy_prize_group`.

Prize items: `{type, key, action, value}`.

- `currency` + `add`: a whole number. A negative value fails with `INSUFFICIENT_BALANCE` if the balance is too low.
- `meta` + `add` or `set`.
- `prize_group` + `give`: one prize from the group, picked by weight with HMAC(`OTP_SECRET`, account, source, prize). The same source always gets the same pick.

Later packages hook into buying (see `docs/items.md`): `purchaseChecks` refuse or reprice a purchase at start, `purchaseCreatedHooks` see the new payment, `settleChecks` refuse delivery (the payment becomes `refused`, coins of an `in_app` payment are refunded), `shopFilters` hide products in `shop`. `startPurchase(ctx, args, context)` is the exported start flow; `@stg/items` sells offers through it.

Later packages register more item types (`extraItemTypes`, `itemHandlers`, `itemValidators` to check an item on save) and block deletes (`prizeUseChecks`, `metaUseChecks`). `@stg/gamification` adds the `achievement` item type, `@stg/items` the `item` type.

A grant is idempotent per `(sourceType, sourceId, prize, account)`: repeating it returns the first rewards. A prize with `isRepeatable = false` is granted once per player (`PRIZE_ALREADY_GRANTED`).

## Views

| View | Rows |
|---|---|
| `my_wallet` | every currency with the caller's balance (default included) |
| `my_metas` | every non-server-only meta with the caller's value |
| `shop` | active products the caller may see (audience tags), methods filtered to active payment methods, `finalToman` after the product discount, `exclusive` for audience products |
| `admin_payment_methods` | admin: every method with `isActive`, `configured`, `fields` and the config as JSON with secrets as `********` |
| `admin_economy_settings` | admin: `publicBaseUrl`, `redirectUrl`, `pendingTtlMinutes` |

Default balances are granted once per player and currency at login (`loginHooks`) and on `sync_economy`.

## Buying

`purchase_start(productId, method, giftCode)` → `{paymentId, status, redirectUrl, sku, developerPayload, rewards}`:

- `in_app`: takes `coinAmount` of `coinCurrency` and grants at once (`status: success`). If the balance is too low, nothing changes.
- Gateways (`zarinpal`, `zibal`): a price of 0 settles at once. Otherwise it creates a `pending` payment, calls the gateway with a callback to `{publicBaseUrl}/v1/database/{databaseIdentity}/route/economy/callback?t={ticket}` and returns `status: redirect` with the pay page URL. A discount gift code works here only; it is reserved while the payment is pending.
- Stores (`bazaar`, `myket`): returns `status: store`, the `sku` and `developerPayload` = payment id. Then call `purchase_submit(paymentId, token)`. Sandbox tokens are `sandbox-<paymentId>-<anything>`. A token is used once (`TOKEN_ALREADY_USED`).
- `purchase_status(paymentId)` returns `{status, rewardGranted, error, rewards}` and retries a missing grant. `my_payments(page, pageSize)` hides the authority and store token.

Callback (HTTP handler, GET or POST): the ticket is `paymentId.expires.HMAC`, valid for 48 h. The payment id comes only from the ticket. The authority in the query must match the stored one; `Status=NOK` (ZarinPal) or `success=0` (Zibal) fails the payment with `CANCELLED`. Otherwise the server verifies with the gateway, sets `success`, marks the gift code used and grants the product prize. It then answers 302 to `redirectUrl` with `{success}` and `{paymentId}` replaced.

A grant that fails leaves the payment `success` with `rewardError`. The reconciler (every 60 s) retries those grants, asks the gateway about pending gateway payments older than 3 minutes, and expires pending payments after `pendingTtlMinutes` (45), releasing their gift codes. Every gateway and store call is written to `economy_payment_log` with the merchant masked.

Amounts are Toman; gateways get Rial (× 10). ZarinPal sandbox uses `sandbox.zarinpal.com` (any merchant id works); Zibal sandbox uses merchant `zibal`.

## Payment method fields

| method | fields |
|---|---|
| zarinpal | `merchantId` (secret), `sandbox` |
| zibal | `merchant` (secret), `sandbox` |
| bazaar | `packageName`, `apiSecret` (secret), `rsaPublicKey`, `sandbox` |
| myket | `packageName`, `accessToken` (secret), `rsaPublicKey`, `sandbox` |
| in_app | none |

Sending `********` back keeps a stored secret. Gateways in sandbox need no merchant. Activating an unconfigured method fails with `PAYMENT_METHOD_NOT_CONFIGURED`. Secrets live in a private table (only the database owner and module code can read it); they are not sealed yet.

## Gift codes

`type` `reward` (grants `prizeId` through `redeem_gift(code)`) or `discount` (1–100 % off a gateway purchase). Codes are 3–32 of `A-Z 0-9 _ -`, stored upper-case. Limits: `perUserLimit`, `maxTotalUses` (0 = no limit), `validFrom`, `expireAt` (micros, 0 = none). Errors: `GIFT_NOT_FOUND`, `GIFT_NOT_STARTED`, `GIFT_EXPIRED`, `GIFT_USED_UP`, `GIFT_ALREADY_USED`, `GIFT_NOT_ALLOWED`.

## Admin calls

`admin_save_currency` / `admin_delete_currency`, `admin_save_meta` / `admin_delete_meta`, `admin_save_prize` / `admin_delete_prize`, `admin_save_prize_group` / `admin_delete_prize_group`, `admin_save_product` / `admin_delete_product`, `admin_products(query, categoryId, isActive, page, pageSize)`, `admin_save_gift` / `admin_delete_gift`, `admin_gifts(query, type, page, pageSize)`, `admin_save_payment_method(method, isActive, config JSON)`, `admin_save_economy_settings`, `admin_payments(query, status, method, accountId, page, pageSize)`, `admin_payment(id)` (with logs), `admin_inquire_payment(id)`, `admin_retry_grant(id)`, `admin_user_economy(accountId)` (wallet, metas, last 50 prizes and ledger lines), `admin_grant_prize(accountId, prizeId, note)`, `admin_adjust(accountId, kind currency|meta, key, action add|set, value, note)`, `admin_economy_summary()` (counts, pending, grant errors, 30-day live revenue and a daily series in Tehran days).

Keys of currencies and metas cannot change after creation (`KEY_LOCKED`). Anything still referenced cannot be deleted (`IN_USE`). Seeded key types: `currency`, `prize`, `product`, `gift`.

## Error codes

`CURRENCY_NOT_FOUND`, `META_NOT_FOUND`, `PRIZE_NOT_FOUND`, `PRIZE_GROUP_NOT_FOUND`, `PRIZE_GROUP_EMPTY`, `PRIZE_ALREADY_GRANTED`, `PRIZE_TOO_DEEP`, `INSUFFICIENT_BALANCE`, `INVALID_VALUE`, `INVALID_ACTION`, `INVALID_ITEM_TYPE`, `ITEMS_REQUIRED`, `TOO_MANY_ITEMS`, `INVALID_WEIGHT`, `ENTRIES_REQUIRED`, `INVALID_TYPE`, `KEY_LOCKED`, `KEY_TAKEN`, `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `INVALID_DISCOUNT`, `PAYMENT_METHODS_REQUIRED`, `INVALID_PAYMENT_METHOD`, `PRICE_TOO_LOW`, `INVALID_PRICE`, `COIN_PRICE_REQUIRED`, `SKU_REQUIRED`, `INVALID_CODE`, `CODE_TAKEN`, `INVALID_DATES`, `PRODUCT_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `METHOD_NOT_ACTIVE`, `PAYMENT_METHOD_NOT_CONFIGURED`, `INVALID_CONFIG`, `PUBLIC_BASE_URL_MISSING`, `GATEWAY_REQUEST_FAILED`, `PAYMENT_NOT_FOUND`, `INVALID_TOKEN`, `TOKEN_ALREADY_USED`, `NOTHING_TO_RETRY`, `INVALID_KIND`. Payment `error` values: `CANCELLED`, `PAYMENT_EXPIRED`, `PURCHASE_INVALID`, `DEVELOPER_PAYLOAD_MISMATCH`, `STORE_MODE_CHANGED`, `STORE_CONFIGURATION_REJECTED`, `STORE_UNAVAILABLE`, `GATEWAY_UNAVAILABLE`, `AMOUNT_MISMATCH`, `ZARINPAL_<code>`, `ZIBAL_<code>`.
