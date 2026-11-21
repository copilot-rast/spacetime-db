# @stg/publication contract

Phase 7: the in-game inbox, push notifications (FCM HTTP v1 and a log sandbox), SMS notifications, campaigns, automatic notifications, notification categories with opt-out, news (workflow, tags, reactions, comments, read state, SEO, webhook ingest, public JSON, sitemap and RSS) and FAQ. Depends on `@stg/base` (sessions, roles, audit, languages, categories, tags, SMS providers, `loginHooks`), `@stg/players` (tags, country), `@stg/economy` (prizes, `grantPrize`, `paymentHooks`) and `@stg/gamification` (levels, events). Ported from nakama-farsi `docs/publication/spec.md` (data model, targeting, channels, «In-app notifications from other plugins», «Push, campaigns and automatic notifications», «News: workflow, webhooks, reactions and SEO»), adapted to tables, reducers, procedures, views and HTTP handlers. Images are URLs (`http(s)://` or `/`); there are no uploads and no email.

## Roles

`operator` reads every admin view and list (campaigns, deliveries, rules, fires, push log, outbox, devices, news, sources, ingest log, comments, FAQ) and moderates comments. `admin` changes settings, the push provider, categories, campaigns, rules, news, reaction types, news sources and FAQ, sends campaigns and test messages, runs the worker and moves the test clock. Every admin change writes `base_audit` (`publication_settings.*`, `push_config.*`, `notify_category.*`, `campaign.*`, `auto_rule.*`, `notification.test`, `news_settings.*`, `news.*`, `news_reaction.*`, `news_source.*`, `news_comment.*`, `faq.*`).

## Hooks into other packages

- New in `@stg/gamification`: `eventHooks: ((ctx, accountId, key, value, metadata, eventId, source) => void)[]`, called at the end of every `recordEvent` (client, server and built-in events). Publication uses it for event rules.
- Publication also uses `loginHooks` (first sign-in), `paymentHooks` (payment success) and `prizeUseChecks` (a prize named by a campaign, a rule or an unclaimed inbox message cannot be deleted: `IN_USE`).
- Exported helper for other packages: `sendNotification(ctx, accountId, {categoryKey, title, body, channels?, imageUrl?, actionType?, actionValue?, actionLabel?, prizeId?, vars?})` inside any reducer or transaction. It writes the inbox row at once, queues push and SMS in the outbox, honours the player's choices (`capped` is off, so transactional messages never hit the frequency cap) and returns `{status: 'sent'|'skipped', reason, channels, inboxId}`; an unknown category throws `CATEGORY_NOT_FOUND`. Kind `direct`.

## Settings

`pub_settings` (id 0), `admin_save_publication_settings(...)`, view `admin_publication_settings` (operator).

| Setting | Default | Meaning |
|---|---|---|
| `inboxKeepDays` | 90 | inbox rows older than this are swept (0 = keep; unclaimed prizes are kept) |
| `inboxMaxPerPlayer` | 200 | oldest messages without an unclaimed prize are removed past this (0 = no cap) |
| `maxDevices` | 10 | active push devices per player (1–50); the oldest are switched off |
| `devicePerMinute` | 20 | `push_register` / `push_unregister` calls per player and minute |
| `prefsPerMinute` | 30 | `notify_prefs_set` calls per player and minute |
| `inboxPerMinute` | 60 | `inbox_read`, `inbox_delete`, `inbox_claim` calls per player and minute |
| `batchSize` | 200 | players per campaign batch, fires and outbox rows per worker pass (1–2000) |
| `batchesPerTick` | 5 | campaign batches per worker pass, each in its own transaction (1–100) |
| `capPerDay` | 5 | campaign and automatic messages per player and Tehran day (0 = off) |
| `capPerWeek` | 20 | the same over the last 7 Tehran days (0 = off, not below `capPerDay`) |
| `pushRetries` | 3 | attempts for a push or SMS with transient failures (1–10), backoff 1 minute × attempt |
| `smsMaxChars` | 600 | SMS text length (70–1000) |
| `liveNoticeMinutes` | 60 | how long `pub_live_notice` rows stay (1–1440) |
| `inactiveScanMinutes` | 10 | how often the inactive rule scan runs (1–1440) |

Rate limits answer `TOO_MANY_REQUESTS` (comments `COMMENT_RATE_LIMITED`, reactions `REACTION_RATE_LIMITED`). Errors: `INVALID_SETTING:<field>`.

### Test clock

`admin_set_publication_clock_offset(seconds)` (admin, audited, at most ±3650 days) moves the clock of this package only: schedules, quiet hours, caps, cooldowns, inactive days, news publish and end times. Rate limits, webhook timestamps, the FCM token cache and every other package keep the real clock. Keep it at 0 in production.

## Time

Days and quiet hours are Tehran time (UTC+3:30). Views have no clock, so "visible now", quiet hours, schedules, caps and cooldowns are decided in reducers, procedures and the worker; views return stored rows only.

## Worker

`pub_tick` runs every 3 seconds (scheduled procedure, `pub_tick_timer`). One pass: news notices (below), the 10-minute sweep, the inactive scan, up to `batchesPerTick` campaign batches (each its own transaction), up to `batchSize` due automatic fires, then up to `batchSize` outbox rows (push and SMS, HTTP outside the transaction). `admin_publication_run()` (admin) runs one pass now with a forced inactive scan and answers `{batches, fires, outbox}`. The sweep removes old rate rows, inbox rows past `inboxKeepDays`, fires after 90 days, finished outbox rows after 30 days, cap rows after 8 days, live notices after `liveNoticeMinutes`, ingest logs after `logRetentionDays` and expired replay rows.

## Categories and choices

`pub_category` (public): `key` (locked), translated `name`/`description`, `mandatory`, `defaultOn`, `isActive`, `sort`. Seeded: `system` «پیام‌های مهم» (mandatory), `offers`, `rewards`, `reminders`, `news`. `admin_save_notify_category`, `admin_delete_notify_category` (`system`, `news` and the news notice category are `CATEGORY_LOCKED`; `IN_USE` while a rule or an open campaign names it). A mandatory category must be on by default (`MANDATORY_MUST_BE_ON`).

Players choose per category and channel (`inbox`, `push`, `sms`):

- `notify_prefs()` → active categories `{key, name, description, mandatory, channels[{channel, enabled}]}` (no stored choice = `defaultOn`).
- `notify_prefs_set(prefs[{categoryKey, channel, enabled}])` (1–50): `CATEGORY_NOT_FOUND`, `INVALID_CHANNEL`, `CATEGORY_LOCKED` for a mandatory category.
- view `my_notify_prefs` (row type `NotifyPrefRow`): the stored choices.

A mandatory category always reaches every channel and ignores the frequency cap. Test sends ignore choices.

## Delivery

Every message goes through one path (`deliver`): the player must be an active non-panel account and the category active; channels the player turned off are dropped (all dropped → skipped `opted_out`); campaign and automatic messages over `capPerDay`/`capPerWeek` are skipped `cap`; `{player}` (display name) and the message values are filled into every translation; `inbox` writes a `pub_inbox` row; `push` queues one outbox row when the player has an active device; `sms` queues one when the account has a mobile number and an SMS provider is active. Nothing queued → skipped `no_device` or `no_address`.

Outbox (`pub_outbox`): each row is claimed in a transaction (`sending`, a 2-minute lease), sent outside it, and written back in another. Push sends go to every active device of the player that has no `sent` push log row for that outbox row, so a retry never pushes a device twice. Push and SMS texts are in the player's language (account language when active, else the default). Admin: `admin_outbox(accountId, campaignId, page, pageSize)`, `admin_push_log(accountId, page, pageSize)` (tokens masked).

### Inbox

View `my_inbox` (row type `InboxEntry`): `id, kind (campaign | auto | news | direct | test), categoryKey, title, body, imageUrl, actionType, actionValue, actionLabel, prizeId, claimed, read, newsId, at`. Text stays translated; the client picks the language.

- `inbox_read(ids, all)` (≤ 200 ids): marks read; the first read of a campaign message counts `opened` on the campaign.
- `inbox_delete(ids)`: own rows only (`NOT_FOUND`); a message with an unclaimed prize is `PRIZE_NOT_CLAIMED`.
- `inbox_claim(id)` → `{inboxId, already, rewards}`: `NO_PRIZE`, `NOT_FOUND`. The prize is granted with `grantPrize` (source `inbox`, id = the inbox id), so a second claim, or a claim racing the first, returns the same rewards with `already = true` and grants nothing.

Actions: `none`, `screen` (screen name), `url` (absolute http(s)), `product` (product key), `achievement` (achievement key), `news` (article id). Errors: `INVALID_ACTION`, `INVALID_ACTION_VALUE`, `INVALID_URL`, `PRODUCT_NOT_FOUND`, `ACHIEVEMENT_NOT_FOUND`, `NEWS_NOT_FOUND`.

## Push

### Devices

`pub_device` (private): one row per token (unique; a token registered by another player moves to that player), `platform` (`android`, `ios`, `web`), `appVersion` (≤ 40), `deviceKey` (optional; a newer token for the same key switches the older one off), `isActive`, `failCount`, `lastError`, `lastSeenAt`.

- `push_register(token, platform, appVersion, deviceKey)` → `{deviceId, platform, active, deactivated}`. Token 16–4096 characters without spaces (`INVALID_TOKEN`), `INVALID_PLATFORM`, `INVALID_APP_VERSION`, `INVALID_DEVICE_KEY`. Past `maxDevices` active devices the least recently seen are switched off (`lastError = LIMIT`).
- `push_unregister(token)`: only the caller's own token (`DEVICE_NOT_FOUND`); the row is deleted.
- View `my_push_devices` (row type `PushDeviceEntry`) with masked tokens; admin `admin_push_devices(accountId)`.

A dead token (FCM 404, `UNREGISTERED`, `SENDER_ID_MISMATCH`, an `INVALID_ARGUMENT` about the token; in the log sandbox a token that starts with `sandbox-dead`) is deleted at once. A transient failure (`sandbox-fail…` in the sandbox) counts `failCount`; five in a row switch the device off.

### Providers

`pub_push_config` (id 0, private), `admin_save_push_config(provider, serviceAccount)`, view `admin_push_config` (operator: `{provider, projectId, clientEmail, configured, keyHint}`; the key is never returned).

- `log` (default): never sends; logs `PUSH_SANDBOX token=<masked> status=<…>` and writes the push log. Tests use it.
- `fcm`: `serviceAccount` is the Firebase service account JSON. It must have `type = service_account`, `project_id`, `client_email` and an RSA `private_key` that parses (`INVALID_SERVICE_ACCOUNT`); an empty value keeps the saved key. `token_uri` in the JSON is ignored. The worker signs an RS256 JWT (`iss` = client email, `scope` = `https://www.googleapis.com/auth/firebase.messaging`, `aud` = `https://oauth2.googleapis.com/token`, one hour, `kid` = `private_key_id`), exchanges it at `https://oauth2.googleapis.com/token` and caches the access token in `pub_push_token` (private) until one minute before it expires; a new service account clears the cache, a 401 refreshes once. Each device gets `POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send` with `notification` (title, body, https image), `data` (`inboxId`, `category`, `actionType`, `actionValue`, `lang`), `android.priority: HIGH`, APNs mutable content and image, and `webpush.fcm_options.link` for URL actions. Auth failures are `PUSH_AUTH_FAILED`; no key is `PUSH_NOT_CONFIGURED`.

RS256 in the module: SpacetimeDB's V8 has no `crypto` and no WebCrypto, and `@noble/*` has no RSA, so `src/rsa.ts` is a small pure-JS signer: PEM and DER parsing (PKCS#8 and PKCS#1), EMSA-PKCS1-v1_5 with the SHA-256 DigestInfo (`@noble/hashes`), and the private-key operation with `BigInt` and CRT (about 4 ms for 2048 bits); every signature is checked with the public exponent before it is used. RSA PKCS#1 v1.5 is deterministic, so the e2e test saves a key made by Node, takes the JWT from `admin_push_jwt_preview()` (admin, audited) and checks that Node's own signature of the same input is byte for byte the module's, and that Node verifies it. Procedures cannot reach loopback addresses and there are no real credentials, so the FCM HTTP calls themselves are not exercised by the tests.

## SMS

The `sms` channel uses the first active `base_sms_provider` with `sendSms` (plain text: title, a line break, the body, cut to `smsMaxChars`). The sandbox provider writes `base_sandbox_sms`. Only accounts with a mobile number (`09…`) get SMS.

## Campaigns

`pub_campaign` (private; view `admin_campaigns`, operator). `admin_save_campaign` (only drafts: `NOT_EDITABLE`), `admin_send_campaign(id)` (`NOT_DRAFT`), `admin_cancel_campaign(id)` (scheduled or sending; pending outbox rows become `skipped`/`CANCELLED`; `NOT_CANCELLABLE`), `admin_delete_campaign(id)` (`CAMPAIGN_RUNNING` while scheduled or sending).

Fields: internal `name`, `categoryKey`, `channels` (`inbox`, `push`, `sms`; at least one), translated `title` (≤ 200) and `body` (≤ 2000, plain text), `imageUrl`, action, `prizeId` (a claimable prize in the inbox), targeting, schedule and quiet hours.

- Target: `all`, `players` (`accountIds`, 1–1000, `TARGET_PLAYERS_REQUIRED`, `TOO_MANY_PLAYERS`, `USER_NOT_FOUND`) or `tags` (player tags, any one; `TARGET_TAGS_REQUIRED`; `tagIds` with another target is `TAGS_NEED_TAG_TARGET`).
- Filters: `excludeTagIds` (never these; `DUPLICATE_TAG`), `levelTableId` + `minLevel`/`maxLevel`, `countries` (the player's saved country), `inactiveDays` (no sign-in for at least that many days). Filtered players are not recipients.
- Schedule: `now`, `at` (`scheduledAt` in micros on the publication clock, in the future and at most 366 days ahead: `SCHEDULE_IN_PAST`, `SCHEDULE_TOO_FAR`) or `recurring` (`repeatMinutes` 60–525 600, optional first `scheduledAt` and `repeatUntil`; `INVALID_REPEAT`).
- Quiet hours: `quietStart`/`quietEnd` in Tehran minutes (0/0 = none; an end before the start wraps over midnight; `INVALID_QUIET_HOURS`). Inside the window the campaign waits until the end.

Sending: the worker picks due campaigns (`scheduled` or `sending` with `nextAt` ≤ now) and handles `batchSize` candidate players per transaction in id order, keeping a cursor, so a large audience never runs in one transaction. Each recipient gets a `pub_delivery` row (key campaign|run|player, so a player gets one message per run): `status` `sent` or `skipped`, `reason` (`opted_out`, `cap`, `no_device`, `no_address`, `category_off`), the channels used and the inbox id. When a batch comes back short the run ends: `done`, or for a recurring campaign `scheduled` again with `run + 1` and the next time. Counts on the campaign: `batches`, `recipients`, `sent`, `skipped`, `inboxCount`, `pushSent`, `pushFailed` (devices), `smsSent`, `opened`.

Admin: `admin_campaign_deliveries(campaignId, status, page, pageSize)`, `admin_campaign_preview(id)` → `{targeted, optedOut, withPush, withPhone}`, `admin_test_notification(accountId, categoryKey, channels, title, body, imageUrl, actionType, actionValue, actionLabel, prizeId)` → `sent:<channels>` or `skipped:<reason>` (kind `test`, ignores choices and caps, sends the outbox at once).

## Automatic notifications

`pub_auto_rule` (private; view `admin_auto_rules`): `key` (locked), `name`, `trigger`, message fields like a campaign (with values such as `{player}`, `{value}`, `{days}`), `cooldownMinutes` per player (0–525 600), quiet hours, `isActive`. `admin_save_auto_rule`, `admin_delete_auto_rule`, `admin_auto_fires(ruleId, status, page, pageSize)`.

| Trigger | Fires | Occurrence | Values |
|---|---|---|---|
| `event` | every `recordEvent` of `eventKey` (`EVENT_TYPE_NOT_FOUND`), optionally only when `metadata[matchField] = matchValue` | `ev:<event id>` | `{value}` and the text/number metadata |
| `first_login` | the first sign-in of a new account | `first` | — |
| `inactive` | the last sign-in is `inactiveDays` (1–365) to `inactiveDays + 2` days ago, scanned every `inactiveScanMinutes` | `inactive:<days>:<last sign-in>` | `{days}` |
| `payment_success` | a payment settles | `pay:<payment id>` | `{amount}`, `{paymentId}` |

Each hit inserts `pub_auto_fire` (key rule|player|occurrence, so a rescan never adds a second one) as `pending`. The worker takes due fires: in quiet hours they wait until the end; within the cooldown since the rule's last message to that player they are `skipped`/`cooldown`; otherwise they are delivered (kind `auto`, capped) and marked `sent` or `skipped` with the reason.

## News

### Settings

`pub_news_settings` (id 0), `admin_save_news_settings(...)`, view `admin_news_settings` (operator).

| Setting | Default | Meaning |
|---|---|---|
| `commentsPerMinute` | 5 | comments per player and minute |
| `reactionsPerMinute` | 30 | reactions per player and minute |
| `listPerMinute` | 120 | `news_list` calls per player and minute |
| `unreadScope` | `signup` | `signup`: unread counts articles published after the account was made; `all` |
| `showExpired` | off | ended articles can be listed (`expired = include | only`) and opened |
| `fillDefaultLang` | on | a webhook item in another language also fills the default language |
| `realtimeOnPublish` | on | a `pub_live_notice` row when an article becomes visible |
| `notifyCategoryKey` | `news` | category of publish notices |
| `logRetentionDays` | 30 | ingest log kept (1–365) |
| `logPayloadBytes` | 16384 | body kept per ingest log row (0–65536) |
| `ingestMaxKb` | 256 | webhook body limit (1–256) |
| `slugStyle` | `native` | `native` (Persian letters kept, ي/ك normalised, Persian digits to Latin), `latin` (transliterated), `id` (`news-<id>`) |
| `publicEnabled` | off | public JSON, sitemap and RSS (needs `publicBaseUrl`: `PUBLIC_BASE_URL_REQUIRED`) |
| `publicBaseUrl` | — | site address |
| `publicPath` | `/news/{slug}` | article path |
| `rssEnabled` | off | RSS feed |
| `publicCacheSeconds` | 300 | `Cache-Control: public, max-age` of public answers |
| `siteTitle` | — | translated RSS title (else the brand name) |

### Articles

`pub_news` (private; view `admin_news`, operator). `admin_save_news(...)`, `admin_review_news(ids, status, reason)`, `admin_delete_news(id)`.

Fields: `slug` (unique; empty = made from the default-language title in `slugStyle`, made unique with `-2`, `-3`; a manual slug is letters and digits joined by `-`, ≤ 120: `INVALID_SLUG`, `SLUG_EXISTS`), `status`, `categoryId` (base category of key type `news` or `general`: `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`), `tagIds` (key type `news` or `general`), translated `title` (required), `summary`, `body` (HTML, cleaned, ≤ 100 000 per language: `BODY_TOO_LONG`), `coverUrl`, `isPinned`, `publishedAt` (0 = when published), `expiresAt` (0 = never; after the start: `INVALID_WINDOW`), `allowComment`, `freeComment` (comments are accepted at once), `allowReaction`, `notifyMode` (`none`, `inbox`, `push`, `both`) with `notifyTagIds` (player tags, empty = everyone), and SEO: translated `metaTitle`, `metaDescription`, `keywords` (≤ 30, ≤ 60 each), `canonicalUrl`, `ogImage`, `noindex`. Webhook articles also carry `source` (`webhook:<key>`), `externalKey`, `sourceUrl`, `contentHash` and `lang`.

Workflow: `draft` → `pending_review` | `published` | `archived`; `pending_review` → `published` | `rejected` | `draft`; `published` → `archived` | `draft`; `rejected` → `draft` | `pending_review`; `archived` → `draft` | `published` (`INVALID_TRANSITION`). A new article starts as `draft`, `pending_review` or `published`. Rejecting goes through `admin_review_news` with a reason (`REASON_REQUIRED`; saving as `rejected` is `USE_REVIEW`). Publishing records `approvedBy`/`approvedAt`.

Visible to players: `published`, `publishedAt` ≤ now, and not ended (`expiresAt` passed) unless `showExpired`.

### Publish notice

When an article first becomes visible (on save or review, or by the worker when its time comes), in one transaction: `notifiedAt` is set, a `pub_live_notice` row (public table: `event = news_published`, `newsId`, `title`) is written when `realtimeOnPublish` is on, and with `notifyMode` ≠ `none` a campaign of kind `news` is created (target all or `notifyTagIds`, category `notifyCategoryKey`, title, summary or body text, action `news`/`<id>`, cover as picture). Archiving and publishing again never sends a second notice.

### HTML cleaning

There is no DOM in the module, so `src/html.ts` has its own tokenizer that keeps exactly the rich editor's allowlist: `p`, `h1`–`h6` (only `style="text-align: left|right|center|justify"`), `strong`/`b`, `em`/`i`, `u`, `s`/`del`/`strike`, `code`, `pre`, `blockquote`, `hr`, `br`, `ol` (`start`), `ul` (`data-type="taskList"`), `li` (`data-type="taskItem"`, `data-checked`), a disabled checkbox `input` inside a list item, `label`, `div`, `table`, `thead`, `tbody`, `tr`, `th`/`td` (`colspan`, `rowspan`, `colwidth`) and `a` (`href` only `http`, `https`, `mailto`, `tel` or a `/` path, after decoding entities and removing control and invisible characters; always `target="_blank" rel="noopener noreferrer nofollow"`). `script`, `style`, frames, `object`, `embed`, `svg`, `math`, forms, media and templates are removed with their content; every other tag is removed and keeps its text; every other attribute (all `on*`) is dropped; comments and doctypes are removed; text is escaped; open tags are closed. Markdown (webhooks, FAQ answers) is rendered (headings, paragraphs, lists, bold, italic, code, links) and then cleaned.

### Client calls

| Call | Input | Answer |
|---|---|---|
| `news_list` | `page`, `pageSize`, `categoryKey`, `tagKeys` (≤ 20) + `tagMode` (`any`/`all`), `expired` (`exclude`/`include`/`only`, the last two only with `showExpired`), `unreadOnly`, `includeSeo` | `{total, unread, items}`; pinned first, then newest |
| `news_get(id)` / `news_by_slug(slug)` | | the article with `body` and `seo`; `NEWS_NOT_FOUND` |
| `news_unread(categoryKey)` | | unread count |
| `news_seen(ids, all)` | ≤ 200 ids | unread count (idempotent) |
| `news_react(newsId, reaction)` | a reaction key; empty removes | `{reactions[{key, count}], reactionCount, myReaction}`; `REACTION_NOT_FOUND`, `REACTION_NOT_ALLOWED`, `NEWS_EXPIRED`, `REACTION_RATE_LIMITED` |
| `news_comments(newsId, page, pageSize)` | | accepted comments plus the caller's own pending ones `{id, parentId, accountId, displayName, message, status, mine, createdAt}` |
| `news_comment(newsId, message, parentId)` | 1–1000 characters | the comment (`pending`, or `accepted` with `freeComment`); a reply to a reply attaches to the root; `COMMENTS_CLOSED`, `INVALID_MESSAGE`, `PARENT_NOT_FOUND`, `COMMENT_RATE_LIMITED` |
| `news_comment_delete(id)` | | deletes an own comment; its replies move to the top |

Items: `id, slug, categoryKey, title, summary, body (get only), coverUrl, isPinned, publishedAt, expiresAt, expired, seen, tags[{key, title}], commentCount, reactions, reactionCount, myReaction, allowComment, allowReaction, sourceUrl, seo`. `seo` = `{slug, metaTitle (else the title), metaDescription (else the summary, else the first 160 characters of the body), keywords, canonicalUrl, ogImage (else the cover), noindex}`.

Reaction types: `pub_reaction_type` (public), seeded `like` 👍, `love` ❤️, `haha` 😂, `wow` 😮, `sad` 😢; `admin_save_reaction_type(key, emoji, name, isActive, sort)`, `admin_delete_reaction_type(key)` (`IN_USE` once a player used it; switch it off instead).

Comments (operator): `admin_news_comments(newsId, status, page, pageSize)`, `admin_moderate_comment(id, accept)`, `admin_delete_comment(id)` (with its replies).

### Webhook ingest

`POST /v1/database/<db>/route/publication/news/ingest?source=<key>` (SpacetimeDB routes are exact paths, so the source key is in the query string; no session). Order: active source (else 404 `SOURCE_NOT_FOUND`) → body ≤ `ingestMaxKb` (413 `PAYLOAD_TOO_LARGE`) → per-source rate limit (429 `RATE_LIMITED` with `Retry-After`, not logged) → auth (401, logged without the body) → JSON (400 `INVALID_JSON`) → items (`itemsPath`, else the body itself or its array; 400 `ITEMS_NOT_FOUND`, `NO_ITEMS`, `TOO_MANY_ITEMS` over 50) → each item in its own transaction.

- `token`: the secret in the token header (`authorization` strips `Bearer `), constant-time compare: `INVALID_TOKEN`.
- `hmac`: `hex(HMAC-SHA256(secret, timestamp + "." + body))` in the signature header (optional `sha256=`), unix seconds or ms in the timestamp header within ±`skewSeconds` of the real clock (`INVALID_TIMESTAMP`, `TIMESTAMP_OUT_OF_WINDOW`), each signature accepted once (409 `REPLAYED`; kept for twice the skew), `INVALID_SIGNATURE`.

Sources: `pub_news_source` (private; view `admin_news_sources` shows `secretHint` = `****` + last 4, never the secret). `admin_save_news_source(...)`, `admin_delete_news_source(id)`. Fields: `key` (locked), `name`, `isActive`, `authMode` (`token`/`hmac`), header names [`x-news-token`, `x-news-signature`, `x-news-timestamp`], `skewSeconds` [300, 30–3600], `secret` (16–200, no spaces; required on create, empty keeps it, a new value rotates it: `SECRET_REQUIRED`, `SECRET_TOO_SHORT`), `itemsPath`, `mapping` (JSON object field → path; fields `title`, `summary`, `body`, `cover`, `category`, `tags`, `lang`, `publishedAt`, `expiresAt`, `externalId` [default path `id`], `url`, `slug`, `metaTitle`, `metaDescription`, `keywords`, `canonicalUrl`, `ogImage`, `noindex`; unknown fields or bad paths: `INVALID_MAPPING:<field>`; paths look like `a.b[0].c`), `bodyFormat` [`auto`: HTML when it looks like HTML, else markdown; `html`, `markdown`, `text`], default category, language and tags, `publishMode` [`review` → `pending_review`; `publish` → `published`], `updateMode` [`update`; `ignore`], `rateLimitPerMinute` [60, 0 = off], `notifyMode`, `allowComment`, `allowReaction`.

Mapping: the title is required (`ITEM_TITLE_REQUIRED`, that item fails alone); bodies are cleaned; an empty body uses the summary or title (`BODY_EMPTY_USED_SUMMARY`); the language maps to an active language (`fa-IR` → `fa`) or the source default; unknown category or tag keys are noted (`CATEGORY_UNKNOWN`, `TAGS_UNKNOWN`), never created; cover and `ogImage` take a string, an object with `url`, `src`, `href`, `@url`, `link` or `uri` (also nested under `image`, `original`, `large`, `full`) or a list; unsafe addresses are noted (`COVER_URL_IGNORED`, `SOURCE_URL_IGNORED`, `OG_IMAGE_IGNORED`, `CANONICAL_URL_IGNORED`); bad times `PUBLISHED_AT_IGNORED`, `EXPIRES_AT_IGNORED`; a bad slug `SLUG_IGNORED`, a taken one `SLUG_TAKEN`.

Dedupe: `(source, externalId)`; without an id the SHA-256 of the mapped item is the id. Same hash → `unchanged`; new content → `updated` (status kept) or `ignored` by `updateMode`; new → `created`.

Answer: `{results[{index, externalId, status, newsId, code, notes}], created, updated, unchanged, ignored, failed}`. Every accepted or rejected call (except rate-limited ones) is in `pub_ingest_log` (`status`: `created`, `updated`, `unchanged`, `ignored`, `error`, `rejected`; HTTP status, code, counts, results, the body up to `logPayloadBytes`; rejected auth keeps no body); `admin_ingest_log(sourceId, status, page, pageSize)` (operator).

### Public pages (off by default)

With `publicEnabled` and `publicBaseUrl` set (else 404):

- `GET …/route/publication/public/news?lang&limit&cursor&category&tag` → `{lang, items[{id, slug, title, summary, coverUrl, publishedAt, url}], cursor}`.
- `GET …/route/publication/public/article?slug=&lang=` → the article with `bodyHtml`, `tags`, `url` and resolved `seo`.
- `GET …/route/publication/public/sitemap` → sitemap XML (`<loc>` = canonical URL, else base + `publicPath`; `<lastmod>`).
- `GET …/route/publication/public/rss` (also needs `rssEnabled`) → RSS 2.0, the latest 50.

Route paths cannot hold a dot, so the sitemap and feed are `sitemap` and `rss` (served as `application/xml` and `application/rss+xml`). Only visible, not ended and indexable (`noindex` off) articles; `Cache-Control: public, max-age=<publicCacheSeconds>`.

## FAQ

`pub_faq` (private): `categoryId` (base category of key type `faq` or `general`, 0 = none: `CATEGORY_NOT_FOUND`, `CATEGORY_KIND_MISMATCH`), translated `question` (≤ 500, `QUESTION_REQUIRED`) and `answer` (markdown, ≤ 5000, `ANSWER_REQUIRED`), `answerHtml` (rendered and cleaned on save), `isActive`, `sort`. `admin_save_faq`, `admin_delete_faq`, view `admin_faqs` (operator).

- View `faq_entries` (public, row type `FaqEntry`): active entries of active categories.
- `faq_list(categoryKey, q, lang)` → `{lang, categories[{id, key, title}], items[{id, categoryKey, question, answer, answerHtml}]}` in `sort` order, text in the asked language (else the account language, else the default); `q` searches every translation.

## Seed

`pub_settings`, `pub_push_config` (`log`), `pub_state`, `pub_news_settings`, key types `news` and `faq`, the five notification categories, the five reaction types and the 3-second `pub_tick_timer`. Idempotent; also runs on `clientConnected`.

## Not ported

Console pages, uploads and image copying (images are URLs), email and SMTP, the cluster leases (SpacetimeDB transactions serialise), per-device platform and app-version campaign filters, language and new/returning campaign filters, `streak_at_risk` and `chance_ready` rule triggers, the `push_in_app` share-key naming (a campaign with `inbox` and `push` does the same), the console test ingest with preview, secret reveal, and SMS login code patterns (already in base).

## Error codes

`NOT_FOUND`, `NOT_INITIALIZED`, `FORBIDDEN`, `USER_NOT_FOUND`, `INVALID_KEY`, `KEY_LOCKED`, `KEY_TAKEN`, `IN_USE`, `INVALID_SETTING:<field>`, `INVALID_CLOCK_OFFSET`, `TOO_MANY_REQUESTS`, `UNKNOWN_LANGUAGE`, `TEXT_TOO_LONG`, `TITLE_REQUIRED`, `BODY_REQUIRED`, `INVALID_URL`, `INVALID_ACTION`, `INVALID_ACTION_VALUE`, `PRODUCT_NOT_FOUND`, `ACHIEVEMENT_NOT_FOUND`, `NEWS_NOT_FOUND`, `PRIZE_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `CATEGORY_LOCKED`, `CATEGORY_KIND_MISMATCH`, `MANDATORY_MUST_BE_ON`, `INVALID_PREFS`, `INVALID_CHANNEL`, `CHANNEL_REQUIRED`, `INVALID_IDS`, `PRIZE_NOT_CLAIMED`, `NO_PRIZE`, `INVALID_TOKEN`, `INVALID_PLATFORM`, `INVALID_APP_VERSION`, `INVALID_DEVICE_KEY`, `DEVICE_NOT_FOUND`, `INVALID_PROVIDER`, `INVALID_SERVICE_ACCOUNT`, `PUSH_NOT_CONFIGURED`, `PUSH_AUTH_FAILED`, `INVALID_NAME`, `INVALID_TARGET`, `TARGET_PLAYERS_REQUIRED`, `TOO_MANY_PLAYERS`, `TARGET_TAGS_REQUIRED`, `TAGS_NEED_TAG_TARGET`, `TAG_NOT_FOUND`, `TAG_KIND_MISMATCH`, `TOO_MANY_TAGS`, `DUPLICATE_TAG`, `INVALID_LEVEL_RANGE`, `LEVEL_TABLE_NOT_FOUND`, `TOO_MANY_COUNTRIES`, `COUNTRY_NOT_FOUND`, `INVALID_INACTIVE_DAYS`, `INVALID_SCHEDULE`, `SCHEDULE_IN_PAST`, `SCHEDULE_TOO_FAR`, `INVALID_REPEAT`, `INVALID_QUIET_HOURS`, `NOT_EDITABLE`, `NOT_DRAFT`, `NOT_CANCELLABLE`, `CAMPAIGN_RUNNING`, `INVALID_TRIGGER`, `EVENT_TYPE_NOT_FOUND`, `INVALID_MATCH`, `INVALID_COOLDOWN`, `PUBLIC_BASE_URL_REQUIRED`, `INVALID_STATUS`, `INVALID_TRANSITION`, `USE_REVIEW`, `REASON_REQUIRED`, `INVALID_REASON`, `INVALID_NOTIFY_MODE`, `INVALID_WINDOW`, `INVALID_SLUG`, `SLUG_EXISTS`, `INVALID_KEYWORDS`, `BODY_TOO_LONG`, `INVALID_EMOJI`, `NEWS_EXPIRED`, `REACTION_NOT_FOUND`, `REACTION_NOT_ALLOWED`, `REACTION_RATE_LIMITED`, `COMMENTS_CLOSED`, `INVALID_MESSAGE`, `PARENT_NOT_FOUND`, `COMMENT_RATE_LIMITED`, `INVALID_AUTH_MODE`, `INVALID_HEADER`, `INVALID_SKEW`, `SECRET_REQUIRED`, `SECRET_TOO_SHORT`, `INVALID_ITEMS_PATH`, `INVALID_MAPPING`, `INVALID_BODY_FORMAT`, `INVALID_PUBLISH_MODE`, `INVALID_UPDATE_MODE`, `INVALID_RATE_LIMIT`, `QUESTION_REQUIRED`, `ANSWER_REQUIRED`; HTTP: `SOURCE_NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INVALID_TOKEN`, `INVALID_TIMESTAMP`, `TIMESTAMP_OUT_OF_WINDOW`, `INVALID_SIGNATURE`, `REPLAYED`, `INVALID_JSON`, `ITEMS_NOT_FOUND`, `NO_ITEMS`, `TOO_MANY_ITEMS`, `METHOD_NOT_ALLOWED`; item codes `ITEM_NOT_OBJECT`, `ITEM_TITLE_REQUIRED`, `ITEM_BODY_TOO_LONG`; plus grant errors from economy and SMS errors from base.
