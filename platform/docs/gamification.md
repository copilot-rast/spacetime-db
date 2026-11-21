# @stg/gamification contract

Phase 4: player events, event prizes, level tables, streaks with milestones (safe days), meta relations, tasks and task groups, achievements. Depends on `@stg/base`, `@stg/players` (audiences are player tags) and `@stg/economy` (every reward is a prize). Ported from nakama-farsi `docs/economy/spec.md` (phases 4, 9, 14, 20 and tasks), adapted to tables, reducers, procedures and views.

## Roles

`operator` reads lists, logs, claims and a player's progress. `admin` changes settings and the catalog, records events for a player, resets streaks, completes or resets tasks, gives or revokes achievements and retries claims. Every admin change writes `base_audit`.

## Hooks into other packages

- `loginHooks`: every login records `login`.
- `paymentHooks`: every granted payment records `purchase_completed` (value = final Toman, or the coin amount for `in_app`).
- `metaHooks`: every meta change (purchases, prizes, gift codes, admin edits, relation targets, level metas) runs the meta relations, then the level tables of that meta.
- `prizeUseChecks`: a prize used by an event rule, level step, streak day or milestone, meta relation, task or achievement tier cannot be deleted (`IN_USE`).
- `metaUseChecks` (new in economy): a meta used by a level table (source or level meta) or a relation (source or target) cannot be deleted.
- `extraItemTypes` / `itemHandlers` / `itemValidators` (the last new in economy): prize item `{type: 'achievement', key, action: 'give', value: tier}` gives an achievement inside the grant; an unknown key is refused on save (`ACHIEVEMENT_NOT_FOUND`).

`playerLevel(ctx, accountId, tableId = 0)` (exported) reads a player's stored level on a table; 0 means the main table, the first active one by `sort`. Other packages use it for level rules.

Server code records events with `recordEvent(ctx, accountId, key, value = 1, metadata = '', source = 'server')` (exported). A server call with an unknown or inactive type returns `undefined` instead of failing, so a missing type never breaks a login or a purchase.

## Settings (`gam_settings`, id 0)

| Field | Default | Use |
|---|---|---|
| `weekStart` | 6 (Saturday) | first day of a week window, 0 = Sunday |
| `playerRateLimit` | 120 | client events per player per minute, all types (0 = no limit) |
| `retentionDays` | 30 | raw event log; day and week counters are kept `max(retention, 35)` days |
| `chainDepth` | 8 | how deep meta changes may trigger relations and level tables (0–25) |
| `clockOffsetSec` | 0 | test clock, see below |

`admin_save_gamification_settings(weekStart, playerRateLimit, retentionDays, chainDepth)`; `admin_gamification_settings` view (operator).

### Test clock

`admin_set_clock_offset(seconds)` (admin, audited, at most ±3650 days) moves the clock of this package only: day and week windows, streak periods, task repeats and cooldowns, group timers and `startsAt`/`endsAt` windows. Rate limits, the log retention, claim times and every other package keep the real clock. It exists so tests can move days without waiting. Keep it at 0 in production; the summary shows it.

## Time

Days are Tehran calendar days (UTC+3:30, like `dayKey` in base). Windows: `all`, `d<yyyy-mm-dd>`, `w<yyyy-mm-dd of the week start>`. Views have no clock, so views return stored state only; everything that depends on "now" (open windows, broken streaks, claimable tasks) comes from procedures.

## Events

`gam_event_type` (public): `key` (`^[a-z][a-z0-9_.]{1,47}$`, locked after creation), translated `name`/`description`, `clientAllowed`, `valueMin`/`valueMax` (checked for client events), `rateLimit` (per player per minute for this type, 0 = none), `isActive`, `isSystem`, `sort`. Seeded system types (server only, cannot be deleted or opened to clients): `login`, `purchase_completed`, `level_up` (value = new level), `task_completed`, `achievement_unlocked` (value = points), `meta_relation_completed` (value = fires).

`record_event(key, value, metadata)` → `{eventId, claims[{claimId, kind, prizeId, grantMode, status, error, rewards}], streaks[{key, count, advanced, floor, fell}], tasks[{key, scope, value, target, status}], achievements[{key, from, to}]}`. Checks in order: type exists and is active (`EVENT_TYPE_NOT_FOUND`), `clientAllowed` (`EVENT_NOT_ALLOWED`), value range (`VALUE_OUT_OF_RANGE`), metadata is a JSON object up to 2 KB (`METADATA_TOO_LARGE`, `INVALID_METADATA`), then the per-type and per-player minute limits (`TOO_MANY_EVENTS`). A refused event leaves no trace and does not use the limit. Then, in one transaction: the raw row (`gam_player_event`), counters per type for `all`, the day and the week (`gam_event_counter`), event rules, tasks, achievements, streaks. Automatic rewards made by the event (also deep in a cascade) are granted before the call returns.

`admin_record_event(accountId, key, value, metadata)` records as `admin` with any active type.

## Claims and grants

Every reward is a row of `gam_claim`: `kind` (`event`, `level`, `streak`, `milestone`, `relation`, `task`, `achievement`), `ownerId` (rule, table, streak, relation, task or achievement), `refId`, `scope`, `prizeId`, `grantMode` (`auto` | `claim`), `status` (`ready`, `granted`, `failed`), `depth`, `attempts`, `error`, `rewards`. `uniq` = `kind|owner|ref|account|scope` is unique, and the grant goes through `grantPrize` with source type `gam_<kind>` and source id `uniq`, so a reward pays at most once per player and scope even if a claim row is retried or written twice.

`auto` claims are granted in their own transaction (a failing grant never rolls back the event): at once by `record_event`, and otherwise by `gam_grant_worker`, a one-shot schedule inserted with the claim. `gam_tick` (every 30 s) grants what is left, retries `failed` auto claims older than a minute up to 8 times, and sweeps old raw events, rate rows, counters and rule windows.

`claim_reward(claimId)` collects a claim of the caller (`CLAIM_NOT_FOUND` for someone else's, `ALREADY_CLAIMED`); a failed grant changes nothing and returns its error. `my_rewards` view: the caller's last 200 claims. Admin: `admin_claims(accountId, kind, status, page, pageSize)`, `admin_retry_claim(claimId)`.

## Event rules (`gam_event_rule`)

`eventKey`, `measure` (`count`, `sum`, `max`), `period` (`total`, `day`, `week`), `threshold > 0`, `repeat`: `once` (one reward ever), `period` (one per day or week, needs a period: `REPEAT_NEEDS_PERIOD`), `every` (one per multiple of the threshold in the window, needs count or sum: `EVERY_NEEDS_TOTAL`); `maxClaims` (0 = no cap), `prizeId` (required), `grantMode`, `audienceTagIds` (player tags, empty = everyone), `startsAt`/`endsAt` (micros, 0 = open), `isActive`, `sort`. Progress per rule, player and window in `gam_rule_progress`. Scopes: `once`, `<window>`, `<window>#<n>`.

`my_event_rules()` → active rules for the caller with `current`, `claims`, `periodEndsAt` and `claimable` claim ids. Admin: `admin_event_rules` view, `admin_save_event_rule`, `admin_delete_event_rule` (`IN_USE` with claims).

## Level tables (`gam_level_table`)

`metaKey` (source), optional `levelMetaKey` (written with the reached level; not the same meta: `SAME_META`), `steps[{level ≥ 1, threshold, title, prizeId (0 = none), grantMode}]` with thresholds non-decreasing by level. After every change of the source meta the reached level is the highest step whose threshold is not above the value. The level never goes down. Each new step pays its prize once (scope `L<level>`), the level meta is set and `level_up` is recorded. `my_levels` view: active tables whose source meta is not server-only, with the caller's level. Admin: `admin_level_tables`, `admin_save_level_table`, `admin_delete_level_table` (`IN_USE` once players have a level or a task targets it).

## Meta relations (`gam_meta_relation`)

Condition `metaKey operator value` (`gt`, `gte`, `lt`, `lte`, `eq`, compared at 4 decimals), `targets[{metaKey, action add|set, amount}]` (≤ 20, each meta once per action, adding 0 refused), optional `prizeId` (a relation needs a target or a prize: `RELATION_NEEDS_RESULT`), `repeat`: `once` (default), `rearm` (fires while armed, re-arms when the condition is checked and no longer holds: «100 XP → level + 1, XP − 100»), `every` (every change while it holds); `maxFires` caps both; audience, window, `clientVisible`, `sort`. A fire applies the targets, makes a `relation` claim (scope `F<n>`) and records `meta_relation_completed`. Per player state in `gam_user_relation`.

Chain depth: a change made directly (purchase, prize, admin) is depth 0. Relation targets and level metas are written one step deeper. Relations and level tables run only while the depth is not above `chainDepth`, so with 0 a relation's targets never trigger another relation, and with N up to N + 1 relations fire in a row. Prizes from claims continue at the claim's depth + 1, so loops through prizes stop too.

`my_meta_relations` view: visible relations the caller completed plus active ones their tags allow. Admin: `admin_meta_relations`, `admin_save_meta_relation`, `admin_delete_meta_relation` (`IN_USE` once a player fired it), `admin_forget_relation(accountId, relationId)` (lets it fire again; paid prizes stay, unpaid claims go).

## Streaks (`gam_streak`)

`eventKey`, `periodDays` (1–30), `gracePeriods` (missed periods forgiven per run), `missAction` (`reset` | `step_back`), `cycleLength` (0 = no repeat; day rewards repeat every N days), `repayAfterFall` (default false), `rewards[{day, prizeId, grantMode}]`, `milestones[{day, prizeId (0 = none), grantMode}]` (≤ 50). Per player (`gam_user_streak`): `count`, `best`, `peak` (highest count in the run), `run`, `falls`, `graceUsed`, `lastPeriod`.

- One step per period on the server clock: a second event in the same period changes nothing, so a streak cannot be pumped.
- Safe day (floor) = the highest milestone day not above `peak`. On a miss beyond the grace the count never falls below it: `reset` goes to the floor (25 → miss → 20, the next counted day is 21), `step_back` loses one day per missed period beyond the grace but stops at the floor. Below the first milestone `reset` starts a new run from day 1. Each lowering adds one to `falls`.
- Day reward scope `r<run>:<count>`. With `repayAfterFall` on and `falls > 0` it is `r<run>f<falls>:<count>`, so re-reached days pay again; with it off they pay nothing.
- Milestone prize: once per player and streak, ever (scope `m<day>`), paid on the first counted day at or past it.
- `admin_reset_streak(accountId, streakId)`: new run, count 0, peak 0, falls 0, so the floor is gone; milestone prizes won stay won.

`my_streaks()` → per active streak: `count` (a broken streak shows where the next event will start from: the floor, or 0), `storedCount`, `best`, `peak`, `run`, `falls`, `floor`, `nextMilestone` (0 = none), `countedThisPeriod`, `broken`, `floored`, `graceLeft`, `nextPeriodAt`, `rewards`, `milestones[{day, reached, safe, prizeId, grantMode, status locked|reached|pending|claimable|claimed, claimId}]`, `claimable`. Admin: `admin_streaks`, `admin_save_streak`, `admin_delete_streak` (`IN_USE` once players have it).

## Tasks (`gam_task`) and task groups (`gam_taskgroup`)

Task: `condition` `event` (an event type moves it: `eventKey`, `metric` count|sum|max, `target > 0`, optional `valueMin`/`valueMax`; events outside do not count) or `children` (done when every active sub-task is done); `repeat` `once`, `daily`, `weekly`, `interval` (`repeatMinutes` after the last completion), `maxCompletions`; `parentId` (one level of sub-tasks; a sub-task follows its parent's instance, window and targeting), `dependsOn` (≤ 10, no cycles; locked until each was completed once), `groupId`; optional prize and mode; targeting by player tags and `levelTableId` with `minLevel`/`maxLevel`; window, `isActive`, `sort`, category and tags of key type `task`.

Instances (`gam_user_task`): scope `once`, `d<date>`, `w<week>`, `i<n>` or `g<round>`; `status` `active` → `completed` (prize to collect, or auto prize waiting) → `claimed`. An event first decides which tasks are open, then counts, so the event that finishes a task does not count for the task it unlocks. Finishing a sub-task checks the parent; finishing a task records `task_completed`, unlocks achievements linked to it and refills its group.

Group: `activeCount` (1–20 handed out at once), `orderMode` `ordered` | `random` (HMAC with `OTP_SECRET`), `handout` `auto` | `request` | `timer` (`handoutMinutes` after a place frees; the first hand-out is immediate), `isRepeatable` (new round when every task is done), `taskIds` (sets members and order; member tasks become `once`), targeting and window. Per player (`gam_user_taskgroup`): `cycle`, `handed`, `nextAt`.

Client: `my_tasks()` → `{tasks[{taskId, key, …, value, progress, state locked|active|completed|claimed|cooldown|done, scope, claimable, claimId, pending, completions, periodEndsAt, nextAt, …}], groups[{groupId, key, cycle, total, done, handed (keys), nextAt, canRequest, finished, …}]}` (hands out due tasks of `auto` and `timer` groups first); `claim_task(taskId)` collects the oldest finished instance (`TASK_NOT_COMPLETED`, `ALREADY_CLAIMED`, `TASK_NOT_FOUND`); `task_group_next(groupKey)` → `{groupKey, handed}` (`HANDOUT_AUTOMATIC`, `CURRENT_TASK_MUST_BE_DONE`, `DURATION_NOT_ELAPSED`, `NO_TASK_AVAILABLE`, `TASK_GROUP_FINISHED`, `TASK_GROUP_NOT_FOUND`).

Admin: `admin_tasks`, `admin_save_task`, `admin_delete_task` (`IN_USE` with player rows or a linked achievement, `HAS_SUBTASKS`; removes it from dependencies and its group), `admin_task_groups`, `admin_save_task_group`, `admin_delete_task_group` (`IN_USE` with players or a linked achievement; detaches its tasks), `admin_complete_task(accountId, taskId)` (`TASK_NOT_AVAILABLE`, `TASK_ALREADY_COMPLETED`), `admin_reset_task(accountId, taskId)` (removes the latest unclaimed instance, its unpaid claim and its sub-task rows; `TASK_NOT_STARTED`, `TASK_ALREADY_CLAIMED`).

## Achievements (`gam_achievement`)

`source`: `event` (event type, metric, optional value range, all time; 1–10 tiers), `task` (`taskId` or `taskGroupId`, not both; unlocked when the task is first finished or every task of a group round is done) or `manual` (only by prize item or admin). Every achievement can also be given by the `achievement` prize item and by an admin. Tiers `[{tier 1…n, threshold strictly rising, name, iconUrl, prizeId, grantMode}]`; non-event achievements get one tier. `rarity` `common`…`legendary`, `points` (0–100000), `isHidden`, `hint`, `iconUrl`, `lockedIconUrl`, category and tags of key type `achievement`.

Per player (`gam_user_achievement`): counters, `tier`, `unlockedAt`, `tierAt`, `source` (`progress`, `task`, `prize`, `admin`), `sourceRef`. The tier never goes down by events. Each tier prize is a claim with scope `t<tier>`, so it pays once per player even after a revoke and a second unlock. The first tier records `achievement_unlocked`.

`my_achievements` view: active achievements with `state` `hidden` (a locked hidden one shows only hint, rarity, points and the locked icon), `locked`, `unlocked`, `completed`, plus `tier`, `maxTier`, `value`, `tiers`, `claimable`. `claim_achievement(achievementId, tier)` (tier 0 = every collectable tier; `ACHIEVEMENT_NOT_FOUND`, `ACHIEVEMENT_LOCKED`, `TIER_NOT_FOUND`, `TIER_NOT_REACHED`, `TIER_HAS_NO_PRIZE`, `ALREADY_CLAIMED`, `NOTHING_TO_CLAIM`). Admin: `admin_achievements`, `admin_save_achievement`, `admin_delete_achievement` (`IN_USE` when unlocked, with claims or in a prize), `admin_give_achievement(accountId, achievementId, tier)` (`ALREADY_UNLOCKED`, `TIER_NOT_FOUND`), `admin_revoke_achievement(accountId, achievementId)` (`NOT_UNLOCKED`; removes progress and unpaid claims, paid prizes stay).

## Other admin procedures

`admin_event_log(accountId, typeKey, source, page, pageSize)`, `admin_player_progress(accountId)` (levels, streaks, relations, tasks, groups, achievements, all-time totals, last 50 claims), `admin_gamification_summary()` (catalog counts, events today, ready and failed claims, clock offset).

## Seed

Settings row, key types `task` and `achievement`, the six system event types, and the 30 s `gam_tick` timer. Idempotent; also runs on `clientConnected`.

## Not ported

Event → meta rules (use an event rule with a meta prize), in-app notifications on task or achievement, public achievement profiles, per-time-zone settings (Tehran only), the Nakama console pages and Star Catcher.

## Error codes

`EVENT_TYPE_NOT_FOUND`, `EVENT_NOT_ALLOWED`, `VALUE_OUT_OF_RANGE`, `METADATA_TOO_LARGE`, `INVALID_METADATA`, `TOO_MANY_EVENTS`, `INVALID_EVENT_KEY`, `SYSTEM_EVENT`, `SYSTEM_EVENT_SERVER_ONLY`, `INVALID_RANGE`, `INVALID_RATE_LIMIT`, `INVALID_WEEK_START`, `INVALID_RETENTION`, `INVALID_CHAIN_DEPTH`, `INVALID_CLOCK_OFFSET`, `INVALID_KEY`, `KEY_LOCKED`, `KEY_TAKEN`, `NOT_FOUND`, `IN_USE`, `USER_NOT_FOUND`, `INVALID_MEASURE`, `INVALID_PERIOD`, `INVALID_REPEAT`, `REPEAT_NEEDS_PERIOD`, `EVERY_NEEDS_TOTAL`, `INVALID_THRESHOLD`, `INVALID_GRANT_MODE`, `INVALID_WINDOW`, `PRIZE_REQUIRED`, `PRIZE_NOT_FOUND`, `META_NOT_FOUND`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`, `INVALID_URL`, `SAME_META`, `STEPS_REQUIRED`, `TOO_MANY_STEPS`, `INVALID_LEVEL`, `DUPLICATE_LEVEL`, `THRESHOLDS_NOT_ORDERED`, `INVALID_PERIOD_DAYS`, `INVALID_GRACE`, `INVALID_MISS_ACTION`, `INVALID_CYCLE`, `TOO_MANY_REWARDS`, `INVALID_DAY`, `DAY_OUTSIDE_CYCLE`, `DUPLICATE_DAY`, `TOO_MANY_MILESTONES`, `INVALID_MILESTONE_DAY`, `DUPLICATE_MILESTONE`, `NOT_STARTED`, `INVALID_OPERATOR`, `INVALID_VALUE`, `INVALID_ACTION`, `TOO_MANY_TARGETS`, `ZERO_AMOUNT`, `DUPLICATE_TARGET`, `RELATION_NEEDS_RESULT`, `INVALID_MAX_FIRES`, `CLAIM_NOT_FOUND`, `ALREADY_CLAIMED`, `INVALID_CONDITION`, `INVALID_METRIC`, `INVALID_TARGET`, `HAS_SUBTASKS`, `INVALID_REPEAT_MINUTES`, `SELF_PARENT`, `PARENT_NOT_FOUND`, `PARENT_NOT_GROUPING`, `NESTED_SUBTASK`, `SUBTASK_NEEDS_EVENT`, `SUBTASK_IN_GROUP`, `TOO_MANY_DEPENDENCIES`, `SELF_DEPENDENCY`, `DEPENDENCY_CYCLE`, `TASK_NOT_FOUND`, `TASK_GROUP_NOT_FOUND`, `GROUP_TASK_REPEAT`, `LEVEL_TABLE_REQUIRED`, `INVALID_LEVEL_RANGE`, `INVALID_ACTIVE_COUNT`, `INVALID_ORDER_MODE`, `INVALID_HANDOUT`, `INVALID_HANDOUT_MINUTES`, `TOO_MANY_TASKS`, `TASK_NOT_COMPLETED`, `TASK_NOT_AVAILABLE`, `TASK_ALREADY_COMPLETED`, `TASK_NOT_STARTED`, `TASK_ALREADY_CLAIMED`, `HANDOUT_AUTOMATIC`, `CURRENT_TASK_MUST_BE_DONE`, `DURATION_NOT_ELAPSED`, `NO_TASK_AVAILABLE`, `TASK_GROUP_FINISHED`, `INVALID_RARITY`, `INVALID_POINTS`, `INVALID_SOURCE`, `TASK_AND_GROUP`, `TASK_REQUIRED`, `TIERS_NEED_EVENT`, `TIERS_REQUIRED`, `TOO_MANY_TIERS`, `TIERS_NOT_CONSECUTIVE`, `TIER_IN_USE`, `ACHIEVEMENT_NOT_FOUND`, `ACHIEVEMENT_LOCKED`, `TIER_NOT_FOUND`, `TIER_NOT_REACHED`, `TIER_HAS_NO_PRIZE`, `NOTHING_TO_CLAIM`, `ALREADY_UNLOCKED`, `NOT_UNLOCKED`, `NOT_INITIALIZED`.
