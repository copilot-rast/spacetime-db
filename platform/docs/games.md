# @stg/games contract

Phase 9: the games page. A catalog of games registered by game code, rooms with entry fees and prizes, entry requirements with tickets, matchmaking with skill bands and bots, match results reported by the server, and leaderboards with periods and rank rewards. Depends on `@stg/base` (sessions, roles, audit, taxonomy, `logActivity`), `@stg/players` (player tags, platforms, version compare), `@stg/economy` (wallets, metas, prizes, prize groups, products, use checks), `@stg/gamification` (levels, `recordEvent`) and `@stg/items` (inventory, `itemUseChecks`). Ported from nakama-farsi `docs/roadmap.md` rows 15 («Games») and 24 («Room entry requirements»), `docs/economy/spec.md` («Entry requirements», «Friend rooms and bot matches») and the leaderboard work in `docs/leaderboardx/spec.md`, adapted to tables, reducers, procedures and views.

Not ported: Nakama match handlers and labels (a game runs its own loop and talks to the server through the calls below), per-room `feeAt = start` (the fee is always taken at the seat), leaderboard tiers, claim-mode rewards, client score submits and the cup (knockout tournaments). The reference events `Game:Played` / `Game:Won` are `game_played` / `game_won`, because admin event keys follow `[a-z][a-z0-9_.]` here.

## Roles

| Area | `support` | `operator` | `admin` |
|---|---|---|---|
| Matches, one match, a player's game history | yes | yes | yes |
| Admin views (games, rooms, settings, boards), payouts, standings, periods, results | no | yes | yes |
| Games, rooms, settings, test clock, servers, cancel or finish a match, scores, board reset, `admin_games_run`, payout retry | no | no | yes |

Every admin change writes `base_audit` (`game.create|update|delete`, `game_room.create|update|delete`, `games_settings.save|clock`, `game_server.create|update|delete`, `game_match.start|finish|cancel`, `game_payout.retry`, `games.run`, `leaderboard.create|update|delete|reset|score`).

## Registering a game from code

A game repo calls, in `src/game/index.ts`:

```ts
import { registerGame, finishMatch, startMatch, submitScore, gameSettingsOf } from '@stg/games';
registerGame({ key: 'sample_duel', name: 'Sample Duel', realtime: true, minPlayers: 2, maxPlayers: 2, settingsSchema: { type: 'object', properties: { rounds: { type: 'integer', minimum: 1, maximum: 9, default: 3 } }, additionalProperties: false } });
```

The registry lives in module memory; the seed (init and every `clientConnected`) writes it to `games_game`: a new key gets a row with defaults and a room `main`; a known key gets its `registered`, `realtime`, `codeName` and `settingsSchema` refreshed (settings keep their values and gain new defaults); a row whose key is no longer registered gets `registered = false` and is hidden from players. An invalid key or schema throws at module load. The template registers `sample_duel` (2 players, reducer `sample_duel_play(matchId)` that picks the winner by HMAC and calls `finishMatch`) and `sample_party` (2 to 4 players, results through `games_report_result`).

### Settings schema

A small JSON Schema subset, checked in V8 without libraries: `type` (`object`, `array`, `string`, `number`, `integer`, `boolean`), `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `default`. Saved settings are merged over the defaults and validated; errors are `INVALID_SETTINGS:<path>:<rule>` (for example `INVALID_SETTINGS:rounds:maximum`, `INVALID_SETTINGS:foo:unknown`, `INVALID_SETTINGS:$:json`), more than 8000 characters is `SETTINGS_TOO_LARGE`. Game code reads them with `gameSettingsOf(ctx, key)`.

### Helpers for game code

- `finishMatch(ctx, matchId, results[{accountId, rank, score}], by?)` → `{matchId, winners, payouts}`. Only a `playing` match (`MATCH_NOT_STARTED`, `MATCH_FINISHED`, `MATCH_CANCELLED`, `MATCH_NOT_FOUND`); every account must be a player (`NOT_IN_MATCH`), once (`DUPLICATE_RESULT`); rank 1..1000 (`INVALID_RANK`), finite score (`INVALID_SCORE`), at most 100 rows. Rank 1 wins (several rank 1 = a draw where all win), others lose, players not listed get `none` (or `left`). Bots are not listed; a bot win is a result with no human at rank 1.
- `startMatch(ctx, matchId)`: waiting → playing (`MATCH_ALREADY_STARTED`, `MATCH_CLOSED`).
- `submitScore(ctx, boardKey, accountId, score)`: writes a server-source score with the board's mode (`LEADERBOARD_NOT_FOUND`, `LEADERBOARD_NOT_ACTIVE`).
- `entryCheck(ctx, accountId, game, room, path)`, `cancelMatch`, `periodKey`, `toJalali`, `gamesNow`, `cleanReq` are exported too.

## Settings (`games_settings`, id 0)

`admin_save_games_settings(...)` (admin), view `admin_games_settings` (operator). Errors `INVALID_RULE:<field>`.

| Setting | Default | Meaning |
|---|---|---|
| `ticketTtlSeconds` | 300 | a waiting ticket older than this expires and is refunded (0 = never, max 1 day) |
| `startTimeoutSeconds` | 60 | a formed match not started in time is cancelled with refunds (0 = never) |
| `playTimeoutSeconds` | 3600 | a started match with no result after this is cancelled, no refund (0 = never) |
| `maxTicketsPerPlayer` | 3 | waiting tickets per player over all games (0 = no cap) |
| `payoutMaxTries` | 8 | automatic payout attempts |
| `weekStart` | 6 | first day of a weekly period (0 Sunday … 6 Saturday) |
| `monthCalendar` | `jalali` | monthly periods follow the Jalali or the Gregorian month; changing it starts new monthly periods |
| `historyDays` | 90 | finished and cancelled matches and their tickets are deleted after this (0 = keep) |
| `clockOffsetSec` | 0 | test clock |

### Test clock

`admin_set_games_clock_offset(seconds)` (admin, audited, at most ±3650 days) moves the clock of this package only: ticket ages, band widening, bot and fill waits, timeouts and leaderboard periods. Keep it at 0 in production; tests set it back to 0.

## Time

All times are microseconds on the games clock (`u64`). Periods use Tehran time (UTC+3:30): daily `dYYYY-MM-DD`, weekly `w<first day>`, monthly `jYYYY-MM` (Jalali) or `mYYYY-MM`, all-time `all`. Views have no clock; every time decision happens in reducers, procedures and the tick.

## Games (`games_game`, private)

`key` (locked, from code), `registered`, `realtime`, `codeName`, `settingsSchema` (from code), translated `name`/`description`, `iconUrl`, `isActive`, `maintenance` + translated `maintenanceMessage`, `sort`, `categoryId` and `tagIds` (key type `game` or `general`, seeded key type `game`), `minPlayers`/`maxPlayers` (1..100), `turnSeconds`, `matchSeconds`, `botsAllowed` + `botAfterSeconds`, `friendAllowed`, `platforms` (empty = all, `players` platform list) and `minVersions` (`[{platform, version}]`), matchmaking (`skillMetaKey`, `bandSize`, `widenEverySeconds`, `widenStep`, `maxBand`, `fillAfterSeconds`), `settings` (JSON) and `requirements` (the game's set).

`admin_save_game(...)` (admin): `KEY_LOCKED`, `KEY_TAKEN`, `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `INVALID_PLAYERS`, `INVALID_TIME`, `INVALID_BAND`, `INVALID_PLATFORM`, `DUPLICATE_PLATFORM`, `INVALID_VERSION`, `META_NOT_FOUND`, settings and requirement errors. A key that code did not register can be saved (for example before the game ships) and stays `registered = false`. `admin_delete_game(id)`: `GAME_REGISTERED` for a registered game, `IN_USE` with rooms, matches or boards. View `admin_games` (operator).

Seeded defaults for a new registered game: active, no bots (`botAfterSeconds` 20), friend rooms on, `bandSize` 3, `widenEverySeconds` 10, `widenStep` 2, `maxBand` 0 (no cap), `fillAfterSeconds` 30.

## Rooms (`games_room`, private)

`gameId`, `key` (unique per game, locked), translated `name`, `entryCurrency` + `entryFee` (0 = free), `prizeId` or `prizeGroupId` (for each winner), `minLevel` (`LEVEL_TOO_LOW`, main level table), `isLocked` (listed, not joinable: `ROOM_LOCKED`), `isHidden` (not listed, joinable by key), `isActive`, `inheritGame` (the game's set also applies), `requirements` (the room's set), `sort`.

`admin_save_game_room(...)` (admin): `GAME_NOT_FOUND`, `KEY_LOCKED`, `KEY_TAKEN`, `INVALID_FEE`, `CURRENCY_NOT_FOUND`, `PRIZE_AND_GROUP`, `PRIZE_NOT_FOUND`, `PRIZE_GROUP_NOT_FOUND`, `INVALID_LEVEL`. `admin_delete_game_room(id)`: `IN_USE` with waiting tickets or open matches. View `admin_game_rooms` (operator). Names avoid the chat rooms of `@stg/social` (`admin_save_room`).

## Entry requirements

`GameRequirements`: `itemKeys` + `itemsMode` (`any` default, `all`) + `consumeItems`, `tagIds` (player tags) + `tagsMode`, `excludeTagIds`, `minLevel` (main level table), `metas` (`[{metaKey, operator gt|gte|eq|lte|lt, value, consume}]`; `consume > 0` makes the meta a counted ticket: the player needs at least that much and it is taken on entry), `productIds` (offered on a refusal; empty = active products whose prize gives a missing item or adds a missing meta), `paths` (`matchmaking`, `bot`, `friend`; the set only applies to these paths; all three are stored as none), `refund` (`return` default: tickets come back when the entry is cancelled, expires, or the match is cancelled before the start; `keep`), `lock` (`show` default: listed as not eligible with what is missing; `hide`: left out of `games_list` for players who do not qualify), `message` (refusal text per language).

Limits: 20 items, 20 tags each, 10 metas, 10 products. Save errors carry the field (`<CODE>:requirements` for the game, `<CODE>:room.requirements` for a room): `ITEM_NOT_FOUND`, `STARTER_TICKET`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH` (only `user` tags), `TAG_BOTH_WAYS`, `META_NOT_FOUND`, `INVALID_OPERATOR`, `INVALID_VALUE`, `INVALID_CONSUME`, `INVALID_PATH`, `PRODUCT_NOT_FOUND`, `INVALID_REQUIREMENT`, `INVALID_LEVEL`, `TOO_MANY_REQUIREMENTS`. Items, metas (also a game's `skillMetaKey`), currencies (room fee), prizes and prize groups (rooms and board rewards) in use cannot be deleted (`IN_USE` through the economy and items use checks).

A refusal is `REQUIREMENTS_NOT_MET:{json}` with `{game, room, path, message, missing, products}`. `missing` rows: `{type: 'level', minLevel, level}`, `{type: 'item', mode, keys}` (in `all` mode only the lacking keys), `{type: 'tag', mode, keys}`, `{type: 'excluded_tag', keys}` (only public tag keys are named), `{type: 'meta', key, operator, value, have, consume}`. `products`: `[{productId, key, satisfies: ['item:<key>', 'meta:<key>']}]`. Empty fields are left out of the JSON. Tickets are taken in the join transaction after the fee: in `any` mode the first owned listed item, in `all` mode one of each; refunds put items back with source `game`.

## Joining

- `games_join(gameKey, roomKey, path, code, platform, appVersion)` (procedure) → `{ticketId, matchId, status, existing, code, feeCurrency, fee, consumedItems, consumedMetas}`. Order of checks: `INVALID_PATH`, `GAME_NOT_FOUND` (missing, inactive or unregistered), friend code (`INVALID_CODE`), `ROOM_NOT_FOUND` (empty `roomKey` = the first open room), an existing waiting ticket of the same game (same room and path: answered again with `existing = true` and nothing charged; else `ALREADY_QUEUED`), `ALREADY_IN_MATCH`, `TOO_MANY_TICKETS`, `OWN_ROOM`, `ROOM_FULL`, `GAME_MAINTENANCE`, `PLATFORM_NOT_SUPPORTED`, `APP_VERSION_TOO_OLD:<min>`, `ROOM_LOCKED`, `BOTS_DISABLED`, `FRIEND_ROOMS_DISABLED`, `LEVEL_TOO_LOW`, `REQUIREMENTS_NOT_MET`, then the fee (`INSUFFICIENT_BALANCE`, ledger source `game_entry` / `ticket:<id>`) and tickets. The matcher runs for the room in the same transaction, so a full room forms its match at once. Joins are transactions, so parallel or repeated joins make one ticket and charge once.
- `games_check(gameKey, roomKey, path, platform, appVersion)` (procedure) → `{eligible, error, missing, products, message}` without joining.
- `games_cancel(ticketId)`: a waiting ticket only (`TICKET_NOT_FOUND`, `TICKET_NOT_WAITING`); fee and tickets back once.
- `games_ready(matchId)`: when every player who has not left is ready the match starts (`playing`). `NOT_IN_MATCH`, `MATCH_ALREADY_STARTED`, `MATCH_CLOSED`, `LEFT_MATCH`.
- `games_leave(matchId)`: before the start the leaver is refunded and the match is cancelled (`player_left`) with refunds for everyone; after the start the player is marked `left` with no refund, and the match is cancelled (`abandoned`, no refund) when every player has left.
- Paths: `matchmaking` (queue), `bot` (needs `botsAllowed`; a match with `max(minPlayers - 1, 1)` bots is formed at once), `friend` (needs `friendAllowed`; without a code the host gets a six-digit HMAC code, with a code the player joins the host's room; the room forms when `maxPlayers` are in, or earlier with `games_friend_start(code)` by the host once `minPlayers` are in: `NOT_HOST`, `NOT_ENOUGH_PLAYERS`).

## Matchmaking

`games_ticket` (private): account, game, room, path, code/host, `status` (`waiting`, `matched`, `cancelled`, `expired`, `left`, `done`), `skill` (the game's `skillMetaKey` value, else the main level), `matchId`, fee and refund flags, consumed tickets (JSON), ready flag, result (`rank`, `score`, `outcome`), times.

For each room with waiting matchmaking tickets, oldest first: the oldest unmatched ticket is the anchor; its band is `bandSize + floor(waited / widenEverySeconds) * widenStep`, capped by `maxBand` (0 = no cap); other tickets within the band join it, oldest first, up to `maxPlayers`. The group forms a match when it is full, or when it has `minPlayers` and the anchor waited `fillAfterSeconds`, or (with `botsAllowed`) when it has fewer than `minPlayers` and the anchor waited `botAfterSeconds`: bots fill it to `minPlayers`. Otherwise the anchor keeps waiting and the next oldest ticket tries.

`games_match` (private): game, room, keys, `path`, `state` (`waiting`, `playing`, `finished`, `cancelled`), `players` (account ids), `bots`, skill range, `reason` (who finished it, or why it was cancelled: `player_left`, `abandoned`, `start_timeout`, `play_timeout`, admin text), times.

`games_tick` (every 2 s) and `admin_games_run` (admin, answers `{matches, expired, cancelled, boards, paid}`) expire old tickets, run the matcher, cancel late matches, roll leaderboard periods, prune history and pay waiting payouts; failed payouts are retried after 30 s up to `payoutMaxTries`.

## Results and prizes

`games_report_result(matchId, results)` and `games_start_match(matchId)` are reducers for the game side only: the module itself (scheduled or internal calls), a registered game server, or an admin (audited). Everyone else, players included, gets `FORBIDDEN`, so a player can never report its own win. Game code inside the module calls `finishMatch` / `startMatch` directly. `admin_save_game_server(identity, note, isActive)` / `admin_delete_game_server(identity)` (admin) manage server identities; view `admin_game_servers` (admin).

A finished match records `game_played` (value 1) for every player and `game_won` for each winner through `recordEvent` (server only, metadata `{gameKey, roomKey, matchId, rank}`), writes activity, feeds the game's boards and creates one `games_payout` per winner (`match|<matchId>|<accountId>`, unique). Payouts are granted in their own transaction by `games_payout_worker` (scheduled right away) with `grantPrize` (source `game`; a prize group is drawn by HMAC on the payout key); a failure marks the row `failed` with the error and never touches the match. `admin_retry_game_payout(payoutId)` (admin), `admin_game_payouts(kind, status, accountId, page, pageSize)` (operator).

Activity (`kind = 'game'`): `joined`, `matched`, `cancelled`, `left`, `refunded`, `played`, `prize`.

## Leaderboards

`games_leaderboard` (private): `key` (locked), `gameId` (0 = standalone), translated `name`/`description`, `iconUrl`, `period` (`all`, `daily`, `weekly`, `monthly`), `scoreMode` (`best`, `sum`, `last`), `order` (`desc`, `asc`; `best` with `asc` keeps the lowest), `source` (`score` = match scores, `wins` = 1 per win, `server` = only `submitScore` and admins; the first two need a game), `topN` (1..200, default 50), `rewards` (`[{fromRank, toRank (0 = no end), prizeId | prizeGroupId}]`, at most 20, the first matching row pays), `isActive`, `sort`, `currentPeriod`, `periodStartedAt`, `resets`.

Scores live in `games_lb_score` per board, period and player with a precomputed `rank` (order, then the earlier write first), recomputed on every write, so views only read. When the clock leaves the period (on the tick or on a write) the period is archived in `games_lb_period` (`reason` `reset`) and `games_lb_result`, rank rewards become payouts (`lb|<periodId>|<accountId>`, source `leaderboard`, paid once like match prizes) and live rows are deleted. An empty period is not archived.

Admin: `admin_save_leaderboard(...)` (`INVALID_PERIOD`, `INVALID_SCORE_MODE`, `INVALID_ORDER`, `INVALID_SOURCE`, `SOURCE_NEEDS_GAME`, `INVALID_TOP_N`, `TOO_MANY_REWARDS`, `INVALID_RANK_RANGE`, `PRIZE_OR_GROUP`, `PRIZE_NOT_FOUND`, `PRIZE_GROUP_NOT_FOUND`, `GAME_NOT_FOUND`, `KEY_LOCKED`, `KEY_TAKEN`; changing the period archives the running one without rewards, reason `restart`, and starts `<period>#<n>`; changing the order re-ranks), `admin_delete_leaderboard(id)` (`IN_USE` while a payout of it is not granted), `admin_reset_leaderboard(id, pay)` (archives now, reason `manual`, with or without rewards, next period `<period>#<n>`), `admin_set_leaderboard_score(boardId, accountId, score, mode set|add|remove)`, `admin_leaderboard_standings(boardId, page, pageSize)`, `admin_leaderboard_periods(boardId, page, pageSize)`, `admin_leaderboard_results(periodId)` (with payout state), `admin_leaderboard_pay(periodId)`, view `admin_leaderboards`.

## Player views and calls

- `games_list` view (`GameListEntry`): active registered games with name, texts, players, times, bots and friend flags, platforms and versions, `settings` (with defaults), the game set, `eligible`, `paths[{path, available, eligible, missing, products}]` and `rooms[{roomId, key, name, entryCurrency, entryFee, prizeId, prizeGroupId, minLevel, levelLocked, isLocked, inheritsGame, requirements, consumes, eligible, paths, message, sort}]`. Hidden and inactive rooms are left out, so are `hide` sets the player does not meet and games whose rooms are all left out. Without a session every path reads not eligible.
- `my_game_tickets` view: waiting tickets and tickets of open matches.
- `my_matches` view: the last 50 matches of the caller with players as `{name, me, ready, left, rank, score, outcome}` (no account ids), `myRank`, `myOutcome`, `state`, `bots`, `reason`, times.
- `leaderboards` view: active boards with `players`, `myRank`, `myScore` (0 without a row or session), rewards and `currentPeriod`.
- `leaderboard_top` view: the top `topN` rows of each active board plus the caller's own row: `{boardKey, rank, name, score, me}`.
- `leaderboard_history(boardKey, limit)` → the caller's archived results with payout state; `leaderboard_winners(boardKey, periodId, limit)` → the last (or given) period's top rows without account ids (`LEADERBOARD_NOT_FOUND`, `LEADERBOARD_PERIOD_NOT_FOUND`).

Every view catches its own errors and answers an empty list; admin views answer empty to anyone below their role.

## Admin match calls

`admin_matches(gameId, state, accountId, page, pageSize)`, `admin_match(matchId)` (match, tickets, payouts) and `admin_player_games(accountId)` (support); `admin_cancel_match(matchId, refund, reason)` (admin, any open match, refunds once when asked: `MATCH_CLOSED`).
