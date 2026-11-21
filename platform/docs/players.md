# @stg/players contract

Phase 2 of the roadmap: account rules, app versions, countries, player tags, suspensions, mutes, warnings and player reports. Depends on `@stg/base` and hooks into it:

- `accountGuards`: an active suspension refuses `request_otp`, `verify_otp` (error `ACCOUNT_SUSPENDED`, `detail` = JSON `{kind, until, reason}` in the player's language) and every reducer that calls `requireAccount`.
- `profileValidators`: `update_profile` checks the account rules.

## Roles

`operator` moderates: player tags, restrictions, reports, lists. `admin` changes settings: account rules, app versions, countries, report titles, report rules, tag visibility. Only an `owner` may restrict another admin; nobody restricts an owner or themselves.

## Public tables

| Table | Use |
|---|---|
| `players_account_rules` (id 0) | `displayNameMin` (0), `displayNameMax` (40, max 64), `displayNameCharset` `any` / `latin` / `persian`, `displayNameUnique` (false; compares after ی/ک, ZWNJ and space normalisation) |
| `players_app_version` | one row per platform (`android`, `ios`, `web`, `windows`, `macos`, `linux`): latest, optional minimum, up to 8 store links (`google_play`, `app_store`, `bazaar`, `myket`, `microsoft_store`, `steam`, `web`, `direct`; `http(s)`, `market`, `bazaar`, `myket`, `itms-apps` links), translated update and force messages |
| `players_country` | 243 countries seeded with fa, en, ar names and dialling codes; Iran sort 1 |
| `players_tag_meta` | `isPublic` per player tag (key type `user`) |
| `players_report_title` | report reasons; seeded abuse, harassment, spam, cheating, personal-info, other |

## Views

| View | Rows |
|---|---|
| `my_profile` | the caller's `countryCode` |
| `my_status` | `{suspension, mute, warnings}`: the latest active suspension and mute (with `until`; compare with the clock, the server flips ended rows to `expired` within 30 s) and the last 5 warnings |
| `my_tags` | the caller's public, active player tags |
| `admin_report_rules` | report rules, operator and up |

Views have no clock, so time checks happen in reducers and procedures.

## Client calls

- `check_app_version(platform, version, store, lang)` → `{status: ok | update_available | update_required, latest, minimum, message, storeUrl, stores[{store, name, url}]}`. Versions are 1–4 numbers with optional `-pre` (older than the release) or `+build` (ignored). No active row → `ok`.
- `set_my_country(code)`; `COUNTRY_NOT_AVAILABLE` for an unknown or inactive country.
- `report_player(targetId, titleKey, note, matchId, contentId, gameKey)` → `{reportId, duplicate}`. One active report per reporter, player and reason inside `duplicateHours`; a duplicate returns the first id and does not use the hourly limit.
- `my_reports(page, pageSize)` → reports with status only (`open`, `resolved`, `dismissed`; never the action or notes) and the limits `{perHour, remaining, trusted, noteRequired, minAccountHours, duplicateHours}`.

## Admin calls

- Rules and catalog: `admin_save_account_rules`, `admin_save_app_version`, `admin_delete_app_version`, `admin_save_country`, `admin_set_country_active`, `admin_delete_country`, `admin_save_report_title`, `admin_delete_report_title` (`IN_USE` once reports use it), `admin_save_report_rules`.
- Tags: `admin_set_tag_visibility(tagId, isPublic)`, `admin_set_player_tags(accountId, tagIds)` (full replace, max 50), `admin_bulk_player_tags(accountIds ≤ 1000, tagIds, op add|remove)`.
- Restrictions: `admin_restrict(accountId, kind suspend|mute|warn, minutes | endsAt micros, reason, note)`; a new suspension or mute replaces the active one; a suspension removes every session of the player at once. `admin_lift_restriction(id, note)`.
- Lists: `admin_players(query, tagId, status '' | suspended | muted | tagged | blocked, page, pageSize)`, `admin_player(accountId)` (tags, active restrictions, last 50 restrictions, report counts), `admin_restrictions(query, kind, status active | expired | lifted, accountId, page, pageSize)` with `activeTotal`.
- Reports: `admin_reports(query, status '' | active | open | reviewing | resolved | dismissed, titleId, targetId, reporterId, gameKey, page, pageSize)` with `activeTotal`, `admin_report(id)` (others against the same player, target view, warn/mute/suspend counts), `admin_report_status(id, reviewing | open)`, `admin_report_note(id, text)` (max 50 notes), `admin_resolve_report(id, action dismiss|warn|mute|suspend, minutes, endsAt, reason, note, closeOthers)`.
- `admin_moderation_summary()` → `{suspended, muted, reportsOpen, reportsReviewing, tagged}`.

## Report rules (defaults)

`perHour` 10 (0 = no limit), `duplicateHours` 24 (0 = off), `minAccountHours` 0, `noteRequired` false, `trustedTagIds` [] with `trustedPerHour` 30.

## Error codes

`DISPLAY_NAME_TOO_SHORT`, `DISPLAY_NAME_TOO_LONG`, `DISPLAY_NAME_INVALID_CHARACTERS`, `DISPLAY_NAME_TAKEN`, `INVALID_RULE:<field>`, `INVALID_PLATFORM`, `INVALID_VERSION`, `VERSION_REQUIRED`, `MIN_ABOVE_LATEST`, `INVALID_STORE`, `DUPLICATE_STORE`, `TOO_MANY_LINKS`, `INVALID_URL`, `INVALID_COUNTRY_CODE`, `INVALID_DIAL_CODE`, `COUNTRY_NOT_FOUND`, `COUNTRY_NOT_AVAILABLE`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `TAGS_REQUIRED`, `USERS_REQUIRED`, `USERS_NOT_FOUND`, `INVALID_OP`, `USER_NOT_FOUND`, `INVALID_RESTRICTION_KIND`, `END_REQUIRED`, `END_IN_PAST`, `END_TOO_FAR`, `CANNOT_RESTRICT_OWNER`, `NOT_ACTIVE`, `ACCOUNT_SUSPENDED`, `CANNOT_REPORT_SELF`, `REPORT_TITLE_NOT_FOUND`, `NOTE_REQUIRED`, `NOTE_TOO_LONG`, `ACCOUNT_TOO_NEW`, `TOO_MANY_REPORTS`, `INVALID_CONTEXT`, `REPORT_CLOSED`, `INVALID_REPORT_STATUS`, `INVALID_MOD_ACTION`, `TEXT_REQUIRED`, `TOO_MANY_NOTES`, `IN_USE`, `KEY_TAKEN`.
