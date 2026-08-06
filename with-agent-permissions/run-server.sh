#!/usr/bin/env bash
# Runs a local Authorizer configured for this example.
#
# It exists for the MCP path (mcp-agent.mjs): `authorizer mcp` is a SEPARATE
# process that must be given the same database and JWT settings as the server
# that minted the token, and reproducing `make dev`'s multi-line RSA keys on a
# command line is miserable. HS256 with a short secret keeps that command
# copy-pasteable.
#
# demo.mjs works against this or against plain `make dev` — it only needs
# AUTHORIZER_URL.
#
# All secrets below are throwaway dev values.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$DIR/../../authorizer"

# Override when :8080 is taken, e.g. PORT=8098 ./run-server.sh
# (then run the demos with AUTHORIZER_URL=http://localhost:8098)
PORT="${PORT:-8080}"

cd "$SERVER_DIR"
exec go run main.go \
  --http-port="$PORT" \
  --metrics-port="$((PORT + 1))" \
  --grpc-port="$((PORT + 1000))" \
  --database-type=sqlite \
  --database-url="$DIR/.agent-demo.db" \
  --admin-secret=admin \
  --client-id=kbyuFDidLLm280LIwVFiazOqjO3ty8KH \
  --client-secret=60Op4HFM0I8ajz0WdiStAbziZ-VFQttXuxixHHs2R7r7-CW8GR79l-mmLqMhc-Sa \
  --allowed-origins=localhost:"$PORT" \
  --jwt-type=HS256 \
  --jwt-secret=insecure-local-agent-demo-secret \
  --encryption-key=insecure-local-agent-demo-encryption-key \
  --url="http://localhost:$PORT"
