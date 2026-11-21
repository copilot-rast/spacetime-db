# Game platform on SpacetimeDB

Everything we build lives in `platform/`. The rest of this repository is upstream SpacetimeDB (remote `upstream`, push disabled). Never edit files outside `platform/`, so upstream merges stay clean.

## Layout

- `packages/<name>`: shared TypeScript packages (`@stg/base`, later economy, gamification, publication, social). Each exports its tables, env declarations and a `define<Name>(spacetimedb)` function. Game modules spread the tables into one `schema()` and re-export the functions by name.
- `games/template/spacetimedb`: the module every game starts from. Game repos add `games/<game>/spacetimedb` with their own tables and reducers.
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

## Local run

```bash
export PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH
npm install
./scripts/dev-server.sh
OTP_SECRET=$(cat .local/otp_secret) ADMIN_PHONES=09120000001 spacetime publish stg-template -s stglocal -p games/template/spacetimedb --no-config --yes
cd e2e && npm run gen && npx tsx base.test.ts
```

- SpacetimeDB CLI stays on 2.12.0 (`spacetime version use 2.12.0`), matching the `spacetimedb` npm package.
- Dev server: 127.0.0.1:7500, data in `.local/stdb`, CLI nickname `stglocal` (`spacetime server add stglocal --url http://127.0.0.1:7500 --no-fingerprint`).
- Sandbox SMS codes: `spacetime sql <db> -s stglocal --no-config "SELECT * FROM base_sandbox_sms"` or the panel's sandbox inbox.
