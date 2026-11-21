# @stg/promo contract

Phase 6: banners and placements (schedule, player targeting, view and click counts), chance games (wheel, loot box, slot) with prize groups, and sponsors (sponsored banners and placements, report, CSV). Depends on `@stg/base`, `@stg/players` (tags, country), `@stg/economy` (prizes, prize groups, wallet, metas), `@stg/gamification` (levels, events) and `@stg/items` (ticket items). Ported from nakama-farsi `docs/economy/spec.md` («Chance game (phase 11)») and `docs/publication/spec.md` («Banners and placements (phase 10)», «Sponsors (phase 12)»), adapted to tables, reducers, procedures and views. Images are URLs (`http(s)://` or `/`); there are no uploads.

## Roles

`operator` reads banners, sponsors, settings, stats, previews, plays and sponsor reports. `admin` changes placements, banners, sponsors, chance games and settings, and moves the test clock. Every admin change writes `base_audit` (`promo_settings.*`, `placement.*`, `banner.*`, `sponsor.*`, `chance_game.*`).

## Hooks into other packages

New generic hooks (nothing about promo lives in those packages):

- `@stg/economy`: `currencyUseChecks: (tx, currencyKey) => boolean` in `admin_delete_currency` and `prizeGroupUseChecks: (tx, groupId) => boolean` in `admin_delete_prize_group`; true refuses with `IN_USE`.
- `@stg/items`: `itemUseChecks: (tx, itemKey) => boolean` in `admin_delete_item`; `takeItem` and `invRow` are now exported.

Promo uses them, plus the existing `prizeUseChecks` and `metaUseChecks`: a prize, prize group, currency, meta or item used by a chance game cannot be deleted (`IN_USE`); a prize group also stays while a play names it.

## Settings

`promo_settings` (id 0), `admin_save_promo_settings(...)`, view `admin_promo_settings` (operator).

| Setting | Default | Meaning |
|---|---|---|
| `listPerMinute` | 60 | `banners` and `sponsors` calls per player and minute (0 = off) |
| `countPerMinute` | 60 | `banner_view`, `banner_click`, `sponsor_view`, `sponsor_click` calls per player and minute (0 = off) |
| `playPerMinute` | 60 | chance plays per player and minute (0 = off) |
| `newPlayerDays` | 7 | an account younger than this is `new`, older is `returning` (1–3650) |
| `requestTtlHours` | 24 | how long play request ids are kept (1–720) |
| `keepDays` | 45 | per-player seen rows older than this are swept (7–3650); day totals stay |

Over a limit: `TOO_MANY_REQUESTS`. Rate windows use the real clock. Errors: `INVALID_SETTING:<field>`.

### Test clock

`admin_set_promo_clock_offset(seconds)` (admin, audited, at most ±3650 days) moves the clock of this package only: banner and sponsor windows, week days and hours, account age, report days, chance cooldowns, free periods and daily limits. Rate limits, request expiry and every other package keep the real clock. Keep it at 0 in production.

## Time

Days, week days and hours are Tehran time (UTC+3:30). `days` uses 0 = Sunday … 6 = Saturday. Views have no clock, so "live now", cooldowns, periods and counts are decided in procedures; views return stored rows only.

## Placements

`promo_placement` (public): `key` (`^[a-z][a-z0-9_]{1,63}$`, locked), translated `name`/`description`, `layout` (`carousel`, `single`, `grid`, `strip`), `maxItems` (1–20), `rotateSeconds` (0–60), `sponsorId` (0 = none), `isActive`, `sort`. `admin_save_placement`, `admin_delete_placement` (`IN_USE` while it has banners). Errors: `INVALID_KEY`, `KEY_LOCKED`, `KEY_TAKEN`, `INVALID_LAYOUT`, `INVALID_MAX_ITEMS`, `INVALID_ROTATE_SECONDS`, `SPONSOR_NOT_FOUND`.

## Banners

`promo_banner` (private; admin view `admin_banners`): `key` (locked), `placementId`, internal `name`, content `tagIds` (key type `banner` or `general`), translated `title` (required), `subtitle`, `description`, `imageUrl`, `bgColor` (`#rrggbb`), action `actionType` + `actionValue` + translated `actionLabel`, `priority` (−1000…1000), schedule, targeting, `sponsorId`, `isActive`. `admin_save_banner`, `admin_delete_banner`.

- Actions: `none`; `screen` (a screen name, `[A-Za-z0-9_./:-]{1,100}`); `product` (a product key, `PRODUCT_NOT_FOUND`); `achievement` (`ACHIEVEMENT_NOT_FOUND`); `url` (absolute http(s), `INVALID_URL`); `sponsor` (opens the banner sponsor's website: `SPONSOR_REQUIRED`, `SPONSOR_NO_WEBSITE`).
- Schedule: `startsAt`/`endsAt` (micros on the promo clock, 0 = open), `days` (empty = every day), `dayStart`/`dayEnd` (minutes 0–1440 in Tehran time; 0/0 = all day; an end before the start wraps over midnight, 22:00–02:00).
- Targeting: `audienceTagIds` (player tags, any one), `excludeTagIds` (never these; a tag cannot be in both: `DUPLICATE_TAG`), `levelTableId` (0 = main table) + `minLevel`/`maxLevel` (0 = none), `playerAge` `all` | `new` | `returning` (against `newPlayerDays`), `countries` (ISO codes, the player's saved country).
- A banner whose sponsor is not live, or whose product action points at an inactive product or one hidden by its audience, is not shown.
- Order: `priority` high first, then the oldest; a placement shows at most `maxItems`.

Errors: `NOT_FOUND`, `KEY_LOCKED`, `KEY_TAKEN`, `PLACEMENT_NOT_FOUND`, `INVALID_NAME`, `INVALID_PRIORITY`, `INVALID_WINDOW`, `INVALID_DAYS`, `INVALID_HOURS`, `INVALID_PLAYER_AGE`, `INVALID_LEVEL_RANGE`, `LEVEL_TABLE_NOT_FOUND`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `DUPLICATE_TAG`, `TOO_MANY_COUNTRIES`, `COUNTRY_NOT_FOUND`, `SPONSOR_NOT_FOUND`, `INVALID_ACTION`, `INVALID_ACTION_VALUE`, `INVALID_URL`, `INVALID_COLOR`, `TITLE_REQUIRED`.

### Client calls

| Call | Input | Answer |
|---|---|---|
| `banners` | `placement` (key) | `{placement{key, name, layout, maxItems, rotateSeconds, sponsor}, items[{id, key, title, subtitle, description, imageUrl, bgColor, priority, endsAt, action{type, value, url, label, sponsorId}, sponsor}], now}`; `BANNER_LIST_NOT_FOUND` for an unknown or inactive placement |
| `banner_view` | `bannerIds` (1–20) | `{counted, already, skipped, sponsorsCounted, day}` |
| `banner_click` | `bannerId` | `{counted, bannerId, action, sponsorCounted}`; `BANNER_NOT_AVAILABLE` when the caller would not get it from `banners` now |

`sponsor` is `{id, key, name, logoUrl, color, websiteUrl}` while the sponsor is live. View and click re-check eligibility (the same set `banners` returns, `maxItems` included); `skipped` banners are not eligible now. A player counts at most once per banner and Tehran day for a view (`promo_banner_seen`) and once for a click; `already` lists banners viewed today. Day totals per banner are in `promo_banner_day`. A view also counts the banner's and the placement's live sponsors, a click the banner's sponsor. Counting never grants anything; the action comes from the server.

### Admin calls

- `admin_banner_stats(bannerId, days)` → `{bannerId, views, clicks, days[{day, views, clicks}]}` (all-time totals, last `days` Tehran days, 1–366, default 14).
- `admin_banner_preview(placementKey, accountId)` → `[{bannerId, key, shown, reason}]` in display order. Reasons: `off`, `scheduled`, `ended`, `day`, `hour`, `excluded`, `audience`, `level_low`, `level_high`, `not_new`, `not_returning`, `country`, `sponsor_off`, `product_off`, `product_audience`, `max_items`.

## Sponsors

`promo_sponsor` (private; admin view `admin_sponsors`): `key` (locked), translated `name` (required) and `description`, `logoUrl`, `color`, `websiteUrl` (absolute http(s)), `tagIds` (key type `sponsor` or `general`), private contact (`contactName`, `contactEmail` lower-cased, `contactPhone` normalised like SMS numbers, `notes`; never sent to players), contract window `startsAt`/`endsAt`, `budgetToman`, `targetViews`, `targetClicks`, `stopAtTarget`, `isActive`, `sort`. `admin_save_sponsor`, `admin_delete_sponsor` (`IN_USE` while a banner or placement names it). Errors: `INVALID_WINDOW`, `INVALID_BUDGET`, `INVALID_EMAIL`, `INVALID_PHONE`, `INVALID_CONTACT`, `INVALID_URL`, `INVALID_COLOR`.

A sponsor is live when it is active, inside its window and, with `stopAtTarget`, its all-time views and clicks are below the targets (0 = no target). A sponsor that is not live hides its banners and is never counted.

Counters: `promo_sponsor_seen` (once per player, sponsor and day for a view and for a click), `promo_sponsor_day` (views, clicks and players per day), `promo_sponsor_total` (all-time views and clicks), `promo_sponsor_player` (every player ever counted).

### Client calls

- `sponsors(tagKey)` → live sponsors in `sort` order: `{id, key, name, description, logoUrl, color, websiteUrl, endsAt}`.
- `sponsor_view(sponsorIds)` (1–20) → `{counted, already, skipped, day}`.
- `sponsor_click(sponsorId)` → `{counted, sponsorId, url}`; `SPONSOR_NOT_AVAILABLE`.

### Report

`admin_sponsor_report(sponsorId, from, to)` (operator; `YYYY-MM-DD` Tehran days, empty `to` = today, empty `from` = 29 days before `to`, at most 366 days) → `{sponsorId, key, from, to, live, days[{day, views, clicks, players, ctrPercent}], totals{views, clicks, players (distinct in the range), ctrPercent}, allTimeViews, allTimeClicks, allTimePlayers, targetViews, targetClicks, budgetToman, banners[{bannerId, key, name, placementKey, views, clicks, ctrPercent}], placements}`. Errors: `INVALID_DATE`, `INVALID_DATE_RANGE`. Distinct players in a range come from seen rows, so ranges older than `keepDays` count 0 players; day totals stay.

`admin_sponsor_report_csv(sponsorId, from, to)` → `{filename, contentType, header, rows, csv}`. `csv` is `day,views,clicks,players,ctr_percent` lines, a `total` line, an empty line, then `banner,name,placement,views,clicks,ctr_percent` lines, CRLF line ends. Cells that start with `= + - @`, tab or CR get a leading `'`; cells with `"`, `,` or a line break are quoted. The panel adds a UTF-8 BOM when it saves the file (the client's text decoder drops a BOM sent on the wire).

## Chance games

`promo_chance_game` (public): `key` (locked: `KEY_IMMUTABLE`), `kind` (`wheel`, `loot_box`, `slot`), translated `name`/`description`, `metadata` (JSON object, ≤ 4000), `prizeType` (`prize` | `prizeGroup`), `prize` (1–50 rows `{chance, prizeId, prizeGroupId}`; a row without a prize or group wins nothing), `intervalTime` (minutes between free plays, 1–525 600; 0 = no free turn), `freePlays` + `freePeriod` (`day` | `week`, week start from the gamification setting; 0 = no cap), `price` (the ticket: `{type currency|meta|item, key, amount}` or none), `dailyLimit` and `totalLimit` (plays per player per Tehran day and in all, both modes; 0 = none), `isActive`, `sort`. `admin_save_chance_game`, `admin_delete_chance_game` (`IN_USE` once it has plays; switch it off instead).

Chances have at most four decimals and must add up to exactly 100 (`TOTAL_CHANCE_MUST_BE_100:<total>`). Save errors: `INVALID_KIND`, `INVALID_PRIZE_TYPE`, `PRIZE_LIST_REQUIRED`, `TOO_MANY_PRIZES`, `INVALID_PRIZE_CHANCE:<row>`, `PRIZE_TYPE_MISMATCH:<row>`, `PRIZE_NOT_FOUND:<row>`, `PRIZE_GROUP_NOT_FOUND:<row>`, `PRIZE_GROUP_EMPTY:<row>`, `INVALID_INTERVAL_TIME`, `INVALID_PRICE_PAYLOAD`, `INVALID_PRICE_AMOUNT` (a unique item ticket costs 1), `CURRENCY_NOT_FOUND`, `META_NOT_FOUND`, `ITEM_NOT_FOUND`, `INTERVAL_OR_PRICE_REQUIRED`, `INTERVAL_TIME_IS_NULL` (free plays without an interval), `INVALID_FREE_PLAYS`, `INVALID_FREE_PERIOD`, `INVALID_LIMITS`, `INVALID_METADATA`, `METADATA_TOO_LARGE`, `KEY_TAKEN`.

### Playing

`chance_play(key, requestId)` (free turn) and `chance_play_with_ticket(key, requestId)` run in one transaction:

1. A replayed `requestId` (`[A-Za-z0-9_.:-]{1,64}`, optional) returns the stored answer with `replayed = true`; the same id for another game or mode is `REQUEST_ID_REUSED`.
2. Checks: `CHANCE_GAME_NOT_FOUND` (unknown or off), `INTERVAL_TIME_IS_NULL` (free play without a free turn), `TICKET_PLAY_IS_NOT_SUPPORT` (no price), `TOTAL_LIMIT_REACHED`, `DAILY_LIMIT_REACHED:<seconds to the next day>`, and for free plays `WAITING_FOR_TURN:<seconds>` (counted from the last free play; ticket plays do not move it) and `FREE_PLAYS_USED:<seconds to the next period>`. The state row (`promo_chance_state`) is read and written in the same transaction, so parallel plays play once per turn.
3. The ticket is spent: `CURRENCY_IS_NOT_ENOUGH:<amount>:<balance>`, `META_IS_NOT_ENOUGH:<amount>:<value>`, `ITEM_IS_NOT_ENOUGH:<amount>:<quantity>`.
4. The roll is `HMAC(OTP_SECRET, "chance|account|game|play counter|requestId") mod 1 000 000`; the rows are walked in order and the first whose running total (in 1/10000 %) is above the roll wins (30/40/30: 25 → row 1, 50 → row 2, 85 → row 3). A prize group row draws one member by weight with `pickFromGroup` (HMAC, seeded by the play id).
5. The prize is granted with `grantPrize` (source `chance`, id = play id). A prize that is not repeatable and that the player already has counts as nothing won (`alreadyOwned`, the slot is still reported).
6. The play is written to `promo_chance_play` (`status: done`) and `chance_played` (value 1, server only, metadata `{entityId, mode, playId}`) is recorded for tasks, achievements and streaks.

If anything after the checks throws (a grant that fails, for example a prize that takes more currency than the player has), the whole transaction is undone: nothing is spent, the turn and counters stay, and a second transaction logs the play with `status: failed` and the `error`. Every play, won, lost or failed, is in `promo_chance_play`.

Answer `{code: 'SUCCESS', status: 200, playId, gameId, gameKey, mode, slot, roll (0–100, four decimals), won, prizeId, prizeGroupId, alreadyOwned, rewards, spent, nextPlayTime (seconds), nextPlayAt (micros, promo clock), replayed}`.

Status codes of the spec, for clients that map them (`CHANCE_STATUS` in the package): 200 `SUCCESS`; 400 `INTERVAL_TIME_IS_NULL`, `TICKET_PLAY_IS_NOT_SUPPORT`, `TOTAL_CHANCE_MUST_BE_100`; 403 `WAITING_FOR_TURN`, `FREE_PLAYS_USED`, `DAILY_LIMIT_REACHED`, `TOTAL_LIMIT_REACHED`; 404 `CHANCE_GAME_NOT_FOUND`; 409 `CURRENCY_IS_NOT_ENOUGH`, `META_IS_NOT_ENOUGH`, `ITEM_IS_NOT_ENOUGH`. The spec's `meta` is the `:`-separated tail of the error code.

### Client calls

- `chance_games()` → active games in `sort` order: `{game, plays, todayPlays, hasFreeTurn, canPlay, nextPlayTime, nextPlayAt, freeLeft (−1 = no cap), lastPlayAt}`.
- `chance_can_play(key)` / `chance_next_play_time(key)` → `{code, status, canPlay, nextPlayTime, nextPlayAt}`; `INTERVAL_TIME_IS_NULL` for a game without a free turn.
- `chance_play(key, requestId)`, `chance_play_with_ticket(key, requestId)`.
- `my_chance_plays` view (row type `ChancePlayEntry`): the caller's plays.

Admin: `admin_chance_plays(gameId, accountId, status, page, pageSize)` (operator), newest first.

## Seed

`promo_settings`, key types `banner` and `sponsor`, the system event type `chance_played` and the 10-minute `promo_tick` timer (sweeps expired request ids, old rate rows and seen rows older than `keepDays`). Idempotent; also runs on `clientConnected`.

## Not ported

Uploads and per-language images (one `imageUrl`), platform and app-version targeting of banners, per-language URLs, the sponsor link list, the console pages and Star Catcher.

## Error codes

`NOT_FOUND`, `NOT_INITIALIZED`, `FORBIDDEN`, `USER_NOT_FOUND`, `INVALID_KEY`, `KEY_LOCKED`, `KEY_IMMUTABLE`, `KEY_TAKEN`, `IN_USE`, `INVALID_SETTING:<field>`, `INVALID_CLOCK_OFFSET`, `TOO_MANY_REQUESTS`, `INVALID_LAYOUT`, `INVALID_MAX_ITEMS`, `INVALID_ROTATE_SECONDS`, `PLACEMENT_NOT_FOUND`, `BANNER_LIST_NOT_FOUND`, `BANNER_NOT_AVAILABLE`, `INVALID_BANNER_IDS`, `INVALID_NAME`, `INVALID_PRIORITY`, `INVALID_WINDOW`, `INVALID_DAYS`, `INVALID_HOURS`, `INVALID_PLAYER_AGE`, `INVALID_LEVEL_RANGE`, `LEVEL_TABLE_NOT_FOUND`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `DUPLICATE_TAG`, `TOO_MANY_COUNTRIES`, `COUNTRY_NOT_FOUND`, `INVALID_ACTION`, `INVALID_ACTION_VALUE`, `PRODUCT_NOT_FOUND`, `ACHIEVEMENT_NOT_FOUND`, `INVALID_URL`, `INVALID_COLOR`, `SPONSOR_NOT_FOUND`, `SPONSOR_REQUIRED`, `SPONSOR_NO_WEBSITE`, `SPONSOR_NOT_AVAILABLE`, `INVALID_SPONSOR_IDS`, `INVALID_BUDGET`, `INVALID_EMAIL`, `INVALID_PHONE`, `INVALID_CONTACT`, `INVALID_DATE`, `INVALID_DATE_RANGE`, `INVALID_KIND`, `INVALID_PRIZE_TYPE`, `PRIZE_LIST_REQUIRED`, `TOO_MANY_PRIZES`, `INVALID_PRIZE_CHANCE`, `TOTAL_CHANCE_MUST_BE_100`, `PRIZE_TYPE_MISMATCH`, `PRIZE_NOT_FOUND`, `PRIZE_GROUP_NOT_FOUND`, `PRIZE_GROUP_EMPTY`, `INVALID_INTERVAL_TIME`, `INVALID_PRICE_PAYLOAD`, `INVALID_PRICE_AMOUNT`, `CURRENCY_NOT_FOUND`, `META_NOT_FOUND`, `ITEM_NOT_FOUND`, `INTERVAL_OR_PRICE_REQUIRED`, `INVALID_FREE_PLAYS`, `INVALID_FREE_PERIOD`, `INVALID_LIMITS`, `INVALID_METADATA`, `METADATA_TOO_LARGE`, `CHANCE_GAME_NOT_FOUND`, `INTERVAL_TIME_IS_NULL`, `TICKET_PLAY_IS_NOT_SUPPORT`, `WAITING_FOR_TURN:<s>`, `FREE_PLAYS_USED:<s>`, `DAILY_LIMIT_REACHED:<s>`, `TOTAL_LIMIT_REACHED`, `CURRENCY_IS_NOT_ENOUGH:<amount>:<balance>`, `META_IS_NOT_ENOUGH:<amount>:<value>`, `ITEM_IS_NOT_ENOUGH:<amount>:<quantity>`, `INVALID_REQUEST_ID`, `REQUEST_ID_REUSED`, plus grant errors from economy (`INSUFFICIENT_BALANCE`, `PRIZE_TOO_DEEP`, …).
