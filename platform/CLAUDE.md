# Game platform on SpacetimeDB

Everything we build lives in `platform/`. The rest of this repository is upstream SpacetimeDB (remote `upstream`, push disabled). Never edit files outside `platform/`, so upstream merges stay clean.

## Layout

- `packages/<name>`: shared TypeScript packages (`@stg/base`, later economy, gamification, publication, social). Each exports its tables, env declarations and a `define<Name>(spacetimedb)` function. Game modules spread the tables into one `schema()` and re-export the functions by name.
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
OTP_SECRET=$(cat .local/otp_secret) ADMIN_PHONES=09120000001 spacetime publish stg-template -s stglocal -p games/template/spacetimedb --no-config --yes
cd e2e && npm run gen && npx tsx base.test.ts && npx tsx players.test.ts
```

- SpacetimeDB CLI stays on 2.12.0 (`spacetime version use 2.12.0`), matching the `spacetimedb` npm package.
- Dev server: 127.0.0.1:7500, data in `.local/stdb`, CLI nickname `stglocal` (`spacetime server add stglocal --url http://127.0.0.1:7500 --no-fingerprint`).
- Sandbox SMS codes: `spacetime sql <db> -s stglocal --no-config "SELECT * FROM base_sandbox_sms"` or the panel's sandbox inbox.
