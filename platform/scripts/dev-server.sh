#!/bin/sh
set -e
cd "$(dirname "$0")/.."
PORT="${STG_PORT:-7500}"
mkdir -p .local/stdb
exec spacetime start --listen-addr "127.0.0.1:$PORT" --data-dir "$PWD/.local/stdb" --non-interactive
