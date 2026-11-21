# Game platform on SpacetimeDB

Everything we build lives in `platform/`. The rest of this repository is upstream SpacetimeDB (remote `upstream`, push disabled). Never edit files outside `platform/`, so upstream merges stay clean.

## Layout

- `packages/<name>`: shared TypeScript packages (`@stg/base`, `@stg/players`, `@stg/economy`, `@stg/gamification`, `@stg/items`, `@stg/promo`, `@stg/publication`, `@stg/support`, `@stg/social`, `@stg/games`). Each exports its tables, env declarations and a `define<Name>(spacetimedb)` function. Game modules spread the tables into one `schema()` and re-export the functions by name.
- `games/template/spacetimedb`: the one module every game publishes. `schema.ts`, `platform.ts`, `platform-tables.ts` and `index.ts` belong to this repo. Game repos change only `src/game/` (`tables.ts` for tables and env, `index.ts` for reducers and views, `init.ts` for seed data), so upstream merges never touch game code.
- `packages/platform.json` lists the packages in the module. After adding a package or a function, run `node scripts/gen-platform-exports.mjs`; it rewrites `platform.ts` and `platform-tables.ts` from the last `return { ... }` block of each listed file.
- `panel/`: admin panel (React + Vite), connects straight to a game database over WebSocket.
- `e2e/`: Node end-to-end tests (`npx tsx base.test.ts`) and generated bindings in `e2e/src/bindings`.
- `docs/`: roadmap and one contract file per package.

## Rules

- Generic work goes here first. Game repos are forks with `upstream` = this repo and merge from `dev`.
- No code comments. One-line commit messages, no body, no Co-Authored-By.
- Push only when the owner asks.
- Every policy is an admin setting with a sensible default.
- Error codes are UPPER_SNAKE strings thrown with `fail()`; the panel translates them.
- Random values for codes, wheels and boxes come from HMAC with `OTP_SECRET`, never from `ctx.random` alone (it is seeded by the timestamp).
- Procedures cannot reach private or loopback addresses; test external services with their own sandbox.
- Views have no clock (`ctx.timestamp` is missing) and a throwing view makes every related commit fail. Do time checks in reducers and procedures.
- A view's row type must not be named like the view's own PascalCase accessor (`my_status` cannot return a type named `MyStatus`).
- Seeds are idempotent and also run on `clientConnected`, so a database upgraded with a new package gets its defaults without a reset.

## Local run

```bash
export PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH
npm install
./scripts/dev-server.sh
OTP_SECRET=$(cat .local/otp_secret) ADMIN_USERNAME=admin ADMIN_PASSWORD=$(cat .local/admin_password) spacetime publish stg-template -s stglocal -p games/template/spacetimedb --no-config --yes
cd e2e && npm run gen && npx tsx base.test.ts && npx tsx players.test.ts && npx tsx economy.test.ts && npx tsx gamification.test.ts && npx tsx items.test.ts && npx tsx promo.test.ts && npx tsx publication.test.ts && npx tsx support.test.ts && npx tsx social.test.ts && npx tsx games.test.ts
```

- SpacetimeDB CLI stays on 2.12.0 (`spacetime version use 2.12.0`), matching the `spacetimedb` npm package.
- Dev server: 127.0.0.1:7500, data in `.local/stdb`, CLI nickname `stglocal` (`spacetime server add stglocal --url http://127.0.0.1:7500 --no-fingerprint`).
- Gamification tests move days with `admin_set_clock_offset`, items tests with `admin_set_items_clock_offset`, promo tests with `admin_set_promo_clock_offset`, publication tests with `admin_set_publication_clock_offset`, support tests with `admin_set_support_clock_offset`, social tests with `admin_set_social_clock_offset` and games tests with `admin_set_games_clock_offset` (each package's own clock only); all set it back to 0 at the end.
- Admins log in with ADMIN_USERNAME/ADMIN_PASSWORD (env owner) or panel users the owner creates; phones never carry a role. Test players may hit the daily SMS cap; `login()` in `e2e/src/lib.ts` clears today's `base_otp_daily` key when it does.
- Publication runs its worker every 3 s (`pub_tick`); tests call `admin_publication_run` to run a pass at once. Push tests use the `log` provider; a token starting with `sandbox-dead` counts as unregistered.
- Webhook and public routes live under `/v1/database/<db>/route/publication/...`; route paths are exact and cannot hold a dot, so keys go in the query string.
- Support runs `support_tick` every 30 s; tests call `admin_support_run` for a pass at once. `STG_DB` picks the database for every suite (default `stg-template`).
- Social runs `social_tick` every 30 s (invite and gift expiry, paying gift sync); tests call `admin_social_run` for a pass at once.
- Games runs `games_tick` every 2 s (matcher, timeouts, leaderboard periods, payouts); tests call `admin_games_run` for a pass at once. Game code registers games with `registerGame` in `src/game/` and reports results with `finishMatch`; the template registers `sample_duel` and `sample_party`.
- Sandbox SMS codes: `spacetime sql <db> -s stglocal --no-config "SELECT * FROM base_sandbox_sms"` or the panel's sandbox inbox.
