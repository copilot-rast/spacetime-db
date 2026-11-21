# @stg/support contract

Phase 8b: support tickets with departments, canned replies, SLA times and auto-close; live support chat; referral codes with economy rewards; remote config; the player activity timeline. Depends on `@stg/base` (sessions, roles, audit, languages, tags, `loginHooks`, `activityWriters`), `@stg/players` (country, player tags, version compare), `@stg/economy` (prizes, `paymentHooks`, `prizeUseChecks`), `@stg/gamification` (`eventHooks`, event counters, the claims table) and `@stg/publication` (`sendNotification`). Ported from nakama-farsi `docs/base/spec.md` («Support, remote config and player activity») and `docs/economy/spec.md` («Referral codes»), adapted to tables, reducers, procedures and views.

Not ported: file uploads. Attachments are `https://` URLs to files the game stores elsewhere (`{url, name, type, size}`); there is no object store yet, so the server cannot check the bytes, only the extension and the declared size. Signed private file links come with the object store. IP addresses are not visible to a module, so the reference flags `same_ip` and `ip_burst` became `same_device` (below).

## Roles

New role `support`, ranked below `operator` (`support` < `operator` < `admin` < `owner`). A support agent passes every `support` check and nothing else: no economy, player, settings or audit access. `operator` and up pass the support checks too. `admin_change_my_password` now needs only `support`. The owner gives the role with `admin_create_user(..., role: 'support')` or `admin_set_user_role`. The panel does not show support pages yet; a support user sees an empty menu until it does.

| Area | `support` | `operator` | `admin` |
|---|---|---|---|
| Tickets, chats, agents, canned replies (read), departments (read), support settings (read), activity (read) | yes | yes | yes |
| Referrals (read), remote config (read, history, preview) | no | yes | yes |
| Support settings, departments, canned replies, referral rules, referral decisions, remote config changes, test clock, `admin_support_run` | no | no | yes |

Every admin change writes `base_audit` (`support_settings.*`, `support_department.*`, `support_canned.*`, `support_ticket.create|status|assign|take`, `support_chat.take|transfer|close`, `referral_settings.save`, `referral.approve|reject`, `config.create|update|delete|rollback`). Replies, notes, heartbeats, typing and read marks are not audited; they live in the ticket and chat rows.

## Settings (`support_settings`, id 0)

`admin_save_support_settings(...)` (admin), view `admin_support_settings` (support).

| Setting | Default | Meaning |
|---|---|---|
| `maxOpenTickets` | 10 | tickets per player that are not resolved or closed (1–100) |
| `ticketsPerHour` | 6 | new tickets per player and hour (0 = no limit) |
| `messagesPerHour` | 40 | player ticket messages (new tickets included) per hour |
| `maxAttachments` | 5 | attachments per message (0–20) |
| `maxAttachmentKb` | 2048 | declared size per attachment |
| `autoCloseDays` | 7 | tickets waiting for the player or resolved this long are closed (0 = off) |
| `chatEnabled` | true | live chat on or off |
| `chatGreeting`, `chatOffline` | seeded | translated system lines: greeting on every new chat, offline text when no agent is online |
| `chatIdleMinutes` | 30 | waiting or active chats with no message this long are closed |
| `chatMessagesPerMinute` | 12 | player chat messages per minute |
| `chatsPerHour` | 6 | new chats per player and hour |
| `agentOnlineSeconds` | 75 | an agent counts as online this long after a heartbeat |
| `activityRetentionDays` | 180 | activity rows older than this are deleted (0 = keep) |
| `notifyCategoryKey` | `support` | publication category for ticket notices ('' = none) |

Errors: `INVALID_SETTING:<field>`, `CATEGORY_NOT_FOUND`, `TOO_MANY_TICKETS`, `TOO_MANY_MESSAGES`, `TOO_MANY_CHATS` (rate limits use the real clock).

### Test clock

`admin_set_support_clock_offset(seconds)` (admin, audited `support_settings.clock`, at most ±3650 days) moves the clock of this package only: ticket and chat times, SLA due times, auto-close, idle chats, activity times and retention, the referral new-account window and the referral day for `burst`. Rate limits, heartbeats, typing and seen times keep the real clock. Keep it at 0 in production; `admin_support_summary` shows it.

### Worker

`support_tick` (scheduled reducer, every 30 s) and `admin_support_run()` (admin procedure, one pass now, returns `{ticketsClosed, chatsClosed, activityRemoved}`) auto-close tickets, close idle chats, delete activity past the retention (5000 rows a pass) and sweep old rate rows.

## Tickets

Tables: `support_department` (`key` locked after creation, translated `name`/`description`, `firstResponseHours` 1–720, `agentIds` (support users), `autoAssign`, `isActive`, `sort`), `support_canned` (`key`, translated `title`/`body`, `departmentId` 0 = every department), `support_ticket`, `support_message`. Seeded: departments `general` (24 h) and `payments` (12 h), canned replies `thanks`, `need_info`, `solved`, notification category `support`. Seeds run once, so a deleted seed stays deleted.

Ticket: `number` (`T-` + 6 HMAC letters/digits without look-alikes), `priority` (`low`, `normal`, `high`, `urgent`), `status` (`open`, `awaiting_staff`, `awaiting_player`, `resolved`, `closed`), `assigneeId`, `source` (`player`, `chat`, `staff`), `chatId`, counters and last message, `lastPlayerMessageAt`, `lastStaffMessageAt`, `playerSeenAt`, `dueAt`, `firstResponseAt`, `statusAt`, `resolvedAt`, `closedAt`, `rating` 1–5, `ratingComment`, `ratedAt` (all times are micros of the support clock). Message: `kind` (`message`, `note` = internal, `event`), `authorType` (`player`, `staff`, `system`), `body` (≤ 5000), `attachments`, `event` (`status_changed`, `assigned`, `department_changed`, `priority_changed`, `rated`, `created_from_chat`, `created_by_staff`, `auto_closed`) with `eventData`.

Rules:

- A new player ticket is `open`. With `autoAssign` it goes to the department agent with the fewest unfinished tickets (first in `agentIds` on a tie); otherwise it stays unassigned.
- A player reply keeps `open` or `awaiting_staff`, otherwise moves to `awaiting_staff` (this reopens a resolved ticket). A closed ticket refuses replies (`TICKET_CLOSED`). The player may resolve an unfinished ticket.
- A staff reply moves to `awaiting_player` by default, or to `resolved`/`closed` (`status`), assigns the replier when nobody owns the ticket and sets `firstResponseAt` once. A note (`internal`) changes nothing the player sees, also on a closed ticket.
- Staff moves (`admin_support_status`): `resolved`/`closed` from anything but closed; `awaiting_staff` (reopen) only from resolved or closed; `awaiting_player` only from open or awaiting staff; never to `open` (`INVALID_STATUS`, `INVALID_TRANSITION`).
- `dueAt` = the moment the ticket started waiting for staff + department hours; it is kept while more player messages arrive and cleared by a staff reply or a move away from waiting. A department change re-computes it from the last player message. Overdue = waiting for staff and past `dueAt`.
- Rating once, after resolved or closed (`TICKET_NOT_FINISHED`, `ALREADY_RATED`, `INVALID_RATING`, `COMMENT_TOO_LONG`).
- Auto-close: tickets `awaiting_player` or `resolved` whose `statusAt` is older than `autoCloseDays` become `closed` with an `auto_closed` event.
- A staff reply, resolve, close and a staff-made ticket send a publication inbox message (category `notifyCategoryKey`, action `screen` `support/ticket/<id>`), skipped when the category is missing or off.

Player calls: `support_info(lang)` → `{lang, chatEnabled, agentsOnline, greeting, offline, maxAttachments, maxAttachmentKb, attachmentTypes, unread, openTickets, chatId}`; `support_ticket_create(subject 3–150, departmentKey ('' = first active), body, attachments)` → `{ticketId, number, assigneeId, status}`; `support_ticket_reply(ticketId, body, attachments)`, `support_ticket_resolve(ticketId)`, `support_ticket_rate(ticketId, rating, comment)`, `support_ticket_seen(ticketId)`. Another player's ticket is `TICKET_NOT_FOUND`. Panel users get `PLAYERS_ONLY`.

Player views: `support_departments` (active departments, no agents), `my_tickets` (last 50, with `departmentKey`, `unread` = staff message after `playerSeenAt`, `canRate`, `agentName`), `my_ticket_messages` (messages and player-visible events of those tickets; never notes, assignment, department or priority events).

Staff calls (support): `admin_support_create_ticket(accountId, subject, body, departmentId, priority, attachments)` (a `staff` ticket `awaiting_player`, owned by the caller), `admin_support_reply(ticketId, body, internal, status, attachments)`, `admin_support_status(ticketId, status)`, `admin_support_assign(ticketId, assigneeId (0 = nobody), departmentId (0 = keep), priority ('' = keep))`, `admin_support_take(ticketId)`, `admin_tickets(query, status ('' | waiting | active | a status), priority, departmentId, assignee ('' | me | none | id), accountId, overdue, sort ('' newest | due | priority), page, pageSize)` → `{total, rows[{ticket, playerName, assigneeName, departmentKey, overdue}]}`, `admin_ticket(ticketId)` → ticket, every message (notes and events), player name and ticket counts, assignee, department, overdue. `admin_support_summary()` → `{awaitingStaff, waitingChats, activeChats, overdue, unassigned, mine, myChats, agentsOnline, avgFirstResponseMinutes (30 days, player tickets), avgRating, rated, clockOffsetSec}`.

Agents: `admin_support_heartbeat(away)` keeps `support_agent.lastSeenAt`; `admin_support_focus(ticketId, chatId)` selects the ticket and chat the agent has open. Views: `admin_support_agents` (every active support-capable panel user with role, `lastSeenAt`, `away`, open tickets, active chats; compare `lastSeenAt` with the clock), `admin_ticket_thread` (every message, notes included, of the focused ticket, live), `admin_support_departments`, `admin_support_canned`. Admin: `admin_save_support_department`, `admin_delete_support_department` (`IN_USE` while a ticket or chat of it is not closed; its canned replies become global), `admin_save_support_canned`, `admin_delete_support_canned`.

Errors: `INVALID_SUBJECT`, `BODY_REQUIRED`, `BODY_TOO_LONG`, `DEPARTMENT_NOT_FOUND`, `TOO_MANY_OPEN_TICKETS`, `TICKET_NOT_FOUND`, `TICKET_CLOSED`, `INVALID_STATUS`, `INVALID_TRANSITION`, `INVALID_PRIORITY`, `AGENT_NOT_FOUND`, `TOO_MANY_AGENTS`, `USER_NOT_FOUND`, `INVALID_URL`, `ATTACHMENT_TYPE` (png, jpg, jpeg, webp, pdf by extension; a declared type must match), `ATTACHMENT_TOO_LARGE`, `TOO_MANY_ATTACHMENTS`, `INVALID_RESPONSE_HOURS`, `KEY_TAKEN`, `KEY_LOCKED`, `INVALID_KEY`, `IN_USE`, `NOT_FOUND`, `PLAYERS_ONLY`.

## Live support chat

`support_chat` (one open chat per player: `waiting` → `active` → `closed`; `agentId`, `lastSeq`, `playerReadSeq`, `agentReadSeq`, `playerTypingAt`, `agentTypingAt`, `playerSeenAt` (real clock micros), `lastMessageAt`, `ticketId`, `rating`, `closedBy` `player|agent|idle`) and `support_chat_message` (`seq` per chat; `player`, `agent` or `system` with an event `greeting`, `offline`, `accepted`, `transferred`, `closed`). Reducers run one at a time, so a take, a transfer or a close cannot both win.

- `support_chat_open(topic, body, departmentKey)` → `{chatId, status, existing, agentsOnline}`. An open chat is returned as it is (`existing`, the body is added). A new chat gets the greeting and, when no agent is online, the offline line. `CHAT_DISABLED`, `TOO_MANY_CHATS`.
- Player: `support_chat_send(chatId, body ≤ 2000)`, `support_chat_typing(chatId)`, `support_chat_seen(chatId)`, `support_chat_close(chatId)`, `support_chat_rate(chatId, rating, comment)` (once, after close, only if an agent took it: `CANNOT_RATE`). Another player's chat is `CHAT_NOT_FOUND`; a closed chat is `CHAT_CLOSED`.
- Agent (support): `admin_chat_take(chatId)` (`ALREADY_TAKEN` unless waiting), `admin_chat_send`, `admin_chat_typing`, `admin_chat_read(chatId, seq)` (only the owner of an active chat: `NOT_YOUR_CHAT`), `admin_chat_transfer(chatId, toAgentId)` (another agent, or 0 = back to the queue; `SAME_AGENT`, `AGENT_NOT_FOUND`), `admin_chat_close(chatId, toTicket)` → `{chatId, ticketId, ticketNumber}` (the owner of an active chat or any agent for a waiting one; `toTicket` makes an `open` `chat` ticket owned by the agent whose first message is the transcript), `admin_chats(view queue|mine|active|closed|'', accountId, page, pageSize)`.
- Live state: views `my_chats` (last 20 chats with agent name, `agentTypingAt`, `agentLastSeenAt`, read marks, ticket number, `canRate`), `my_chat_messages` (open chats and the latest chat), `admin_chat_queue` (every waiting and active chat with player typing and seen times), `admin_chat_messages` (waiting chats, the agent's active chats and the focused chat). Clients compare the typing and seen times with their clock: typing for 5 s, a player online for 30 s, an agent for `agentOnlineSeconds`.

## Referral codes

Tables: `referral_settings` (id 0), `referral_code` (one 8-character code per player, HMAC-derived from the account with a retry on collision, made at sign-in or on `referral_me`), `referral` (`referrerId`, `refereeId` unique, `code`, `status` `pending` | `held` | `completed` | `rejected`, `flags`, a copy of the prizes and the goal at entry time, `device`, claim ids, decision fields), `referral_mark` (HMAC of every device and phone that entered a code; kept forever).

Settings (`admin_save_referral_settings`, admin; view `admin_referral_settings`, operator):

| Setting | Default | Meaning |
|---|---|---|
| `isEnabled` | true | entering codes on or off |
| `newAccountDays` | 7 | a code can be entered this many days after sign-up (0 = always) |
| `referrerPrizeId`, `refereePrizeId` | 0 | economy prizes for each side (0 = none); the inviter prize must be repeatable (`PRIZE_NOT_REPEATABLE`) |
| `goalEventKey`, `goalMeasure`, `goalValue` | '', count, 0 | the invited player's all-time event total that completes the referral ('' = complete at once) |
| `maxPerReferrer` | 100 | non-rejected referrals per inviter (0 = no limit) |
| `dailyPerReferrer` | 10 | above this in one Tehran day the referral is flagged `burst` |
| `onePerDevice`, `onePerPhone` | true | refuse a device or phone that already entered a code; when off, flag it |
| `holdFlagged` | true | a flagged referral waits for an admin (`held`) |
| `triesPerHour` | 10 | `referral_enter` calls per player and hour, failures included |

`referral_enter(code)` → `{referralId, status, claims}`. The code is upper-cased with Persian/Arabic digits, spaces, dashes, underscores and ZWNJ removed. Checks in order: `REFERRAL_DISABLED`, `TOO_MANY_TRIES` (counted in its own transaction, so failures count), `INVALID_CODE`, `CODE_NOT_FOUND` (also for a blocked or panel inviter), `SELF_REFERRAL`, `ALREADY_REFERRED`, `ACCOUNT_TOO_OLD`, `REFERRAL_CYCLE` (the caller is anywhere up the inviter's chain), `REFERRER_LIMIT`, `DEVICE_ALREADY_USED`, `PHONE_ALREADY_USED`. Flags: `shared_device`, `shared_phone`, `burst`, `same_device` (the inviter has activity from this device in the last 30 days). A player never sees `held`; it shows as `pending`.

Completion (at entry without a goal, on approve, or from `eventHooks` when the invited player's counter reaches the goal) makes one auto claim per side in `gam_claim` (kind `referral`, owner = referral id, scope `referrer` / `referee`). Claims are granted in their own transaction (at once by `referral_enter`, `admin_approve_referral` and `record_event`, otherwise by the gamification grant worker, retried on failure), through `grantPrize` with source `gam_referral`, so each side is paid once. They show in `my_rewards`.

Player: views `my_referral` (code, `enabled`, `enterUntil` (real clock micros, 0 = no limit), inviter name and status, invite counts), `my_referrals` (invited players: name, status, times); `referral_me(lang)` → code, `canEnter`, window, counts, last ten invites, prizes and the goal with its translated event name. Admin: `admin_referrals(query, status, flag, flagged, referrerId, refereeId, page, pageSize)` with goal `progress`, `admin_referral_summary()` (counts and top ten inviters), `admin_referral_tree(accountId)` (up to five inviters up, every invited player), `admin_approve_referral(id, note)` (held → completed, or pending when the goal is not reached; `NOT_HELD`), `admin_reject_referral(id, note)` (`REFERRAL_DECIDED` once completed or rejected). A prize named by the settings or by an undecided referral cannot be deleted (`IN_USE`).

Errors: `PRIZE_NOT_FOUND`, `PRIZE_NOT_REPEATABLE`, `EVENT_TYPE_NOT_FOUND`, `INVALID_MEASURE`, `INVALID_GOAL`, `INVALID_SETTING:<field>`, and the entry errors above.

## Remote config

`config_key` (`key` `^[a-z][a-z0-9_.]{1,63}$`, primary key), `type` (`string`, `number`, `bool` = `true`/`false`, `json`, `text` = translated in `text`), `description`, default `value`, ordered `rules[{name, value, text, platforms, minVersion, maxVersion, tagIds (player tags), countries, percent 0–100}]` (≤ 20, unique names, `default` is reserved), `isActive`, `version`. `config_history` keeps a snapshot of every create, update, delete and rollback. `config_client` holds the caller's platform and app version.

Resolution: the first rule whose every condition fits gives its value (variant = rule name), otherwise the default (variant `default`). Platform and version come from `set_my_client(platform, appVersion)` or the `remote_config` call; country from `players_profile`; tags from the player tags. Percent uses a stable bucket `HMAC(OTP_SECRET, key, account) mod 10000 < percent × 100`, so a player stays in one bucket, a higher percent only adds players and keys bucket independently.

- Player: view `my_remote_config` (`{key, type, value, variant}` for every active key, live when a rule, a tag, the country or the client info changes); `set_my_client(platform, appVersion)`; `remote_config(platform, version, keys, lang)` → `{lang, values, hash, changed}`. A full fetch (`keys` empty) compares with the previous full fetch and writes a `config`/`changed` activity row listing the changed `key:variant` pairs (the first fetch is not a change).
- Admin: `admin_save_config_key(key, version (0 = create, else the current version), type, description, value, text, rules, isActive)` (`KEY_TAKEN`, `NOT_FOUND`, `VERSION_CONFLICT`, `TYPE_LOCKED`), `admin_delete_config_key(key)`, `admin_rollback_config(key, version)` (restores that version as a new version; a deleted key comes back), view `admin_config_keys` (operator), `admin_config_history(key, page, pageSize)`, `admin_config_preview(accountId, platform, version, country, tagIds, lang)` → values, variants and the bucket per key (given facts win over the player's).

Errors: `INVALID_KEY`, `INVALID_TYPE`, `INVALID_VALUE`, `VALUE_REQUIRED`, `VALUE_TOO_LONG`, `TOO_MANY_RULES`, `INVALID_RULE_NAME`, `DUPLICATE_RULE`, `INVALID_PLATFORM`, `INVALID_VERSION`, `INVALID_VERSION_RANGE`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `COUNTRY_NOT_FOUND`, `INVALID_PERCENT`, `VERSION_NOT_FOUND`.

## Player activity

`player_activity`: one row per thing a player did or that happened to them: `kind`, `action`, `refId`, `data` (JSON, ≤ 1000), `actor` (`player`, `system`, `admin`, or `admin:<accountId>`), `device` (HMAC of the connection identity), `platform` (from `config_client`), `country`, `at` (support clock).

Writers: any package calls `logActivity(ctx, accountId, {kind, action, refId?, data?, actor?})` from `@stg/base` (support registers the writer in `activityWriters`; without support it does nothing), and packages that depend on support may call `recordActivity` from `@stg/support`. Written today: sign-ins (`login` / `signup`), completed purchases, `level_up`, `achievement_unlocked` and `task_completed` events, restrictions and lifts (players), gift codes (economy), tickets, chats, referrals and config changes.

Player: view `my_activity` (own last 200, admin ids hidden), `activity_mine(kind, before, limit)` (older pages). Support and up: `admin_activity(accountId, kinds, action, country, platform, from, to, q, page, pageSize)` (`INVALID_RANGE`), `admin_activity_summary()` (totals, last 24 h, players, per kind, retention).

## Exports

`supportTables`, `supportEnv`, `defineSupport`, `seedSupport`, `recordActivity`, `supportNow`, `resolveKey`, `factsOf`, `CONFIG_TYPES`. New elsewhere: `logActivity`, `activityWriters`, `ActivityEntry` in base; `createClaim`, `grantReady` exported from gamification.
