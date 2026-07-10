#!/usr/bin/env bash
# Runs a local Authorizer dev server configured for every recipe in this folder:
# SMTP (Mailpit), magic link login, TOTP MFA, webhooks and email templates.
#
# Prereq: `docker compose up -d` in this folder (starts Mailpit on :1025/:8025).
#
# All secrets below are throwaway dev values (same ones `make dev` uses).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$DIR/../../authorizer"

# Override when :8080 is taken, e.g. PORT=8098 ./run-server.sh
# (recipe scripts then need AUTHORIZER_URL=http://localhost:8098)
PORT="${PORT:-8080}"

cd "$SERVER_DIR"
exec go run main.go \
  --http-port="$PORT" \
  --metrics-port="$((PORT + 1))" \
  --grpc-port="$((PORT + 1000))" \
  --database-type=sqlite \
  --database-url="$DIR/.recipes.db" \
  --admin-secret=admin \
  --client-id=kbyuFDidLLm280LIwVFiazOqjO3ty8KH \
  --client-secret=60Op4HFM0I8ajz0WdiStAbziZ-VFQttXuxixHHs2R7r7-CW8GR79l-mmLqMhc-Sa \
  --allowed-origins=localhost:"$PORT",localhost:3000,localhost:5173 \
  --jwt-type=HS256 \
  --jwt-secret=insecure-local-recipes-jwt-secret \
  --smtp-host=localhost \
  --smtp-port=1025 \
  --smtp-sender-email=noreply@authorizer.local \
  --smtp-sender-name="Authorizer Recipes" \
  --organization-name="Acme Local" \
  --enable-email-verification \
  --enable-magic-link-login \
  --enable-mfa \
  --enable-totp-login \
  --enforce-mfa=false
