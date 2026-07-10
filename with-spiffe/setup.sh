#!/usr/bin/env bash
# End-to-end bring-up: SPIRE server + OIDC discovery provider + Authorizer,
# agent node-attestation via one-time join token, workload registration entry,
# Authorizer service-account client + spiffe_jwt trusted issuer, workload start.
#
# REQUIRED env:
#   JWKS_URL  publicly-routable URL of the SPIRE OIDC provider's JWKS, e.g. a
#             tunnel in front of http://localhost:9988/keys. Authorizer's JWKS
#             fetcher is SSRF-hardened and rejects private/loopback addresses,
#             so the compose-internal http://spire-oidc:8443/keys will NOT work
#             (see README.md).
set -euo pipefail
cd "$(dirname "$0")"

: "${JWKS_URL:?set JWKS_URL to a publicly-routable URL serving the SPIRE JWKS (e.g. ngrok in front of localhost:9988, path /keys)}"

AUTHORIZER=http://localhost:8080
ADMIN_SECRET=admin
TRUST_DOMAIN=demo.example
WORKLOAD_ID="spiffe://${TRUST_DOMAIN}/workload"
# Must equal conf/server/server.conf jwt_issuer:
ISSUER_URL="https://oidc-discovery.demo.example"
# Must equal the workload's AUDIENCE env (docker-compose.yaml):
EXPECTED_AUD="http://authorizer:8080"

gql() { # gql '<query escaped for JSON>'
  curl -sf "$AUTHORIZER/graphql" \
    -H 'Content-Type: application/json' \
    -H "Origin: $AUTHORIZER" \
    -H "x-authorizer-admin-secret: $ADMIN_SECRET" \
    -d "{\"query\":\"$1\"}"
}

echo "==> vendoring the workload module (go.mod has a local replace; see workload/Dockerfile)"
(cd workload && go mod vendor)

echo "==> starting spire-server, spire-oidc, authorizer"
docker compose up -d spire-server spire-oidc authorizer

echo "==> waiting for spire-server"
for i in $(seq 1 30); do
  docker compose exec spire-server /opt/spire/bin/spire-server healthcheck >/dev/null 2>&1 && break
  sleep 2
done
docker compose exec spire-server /opt/spire/bin/spire-server healthcheck >/dev/null \
  || { echo "spire-server never became healthy — check: docker compose logs spire-server"; exit 1; }

echo "==> generating one-time agent join token"
TOKEN=$(docker compose exec spire-server /opt/spire/bin/spire-server token generate \
  -spiffeID "spiffe://${TRUST_DOMAIN}/agent" | awk '/Token:/ {print $2}')
sed "s/__JOIN_TOKEN__/${TOKEN}/" conf/agent/agent.conf.template > conf/agent/agent.conf

echo "==> creating workload registration entry (unix:uid:0 selector)"
docker compose exec spire-server /opt/spire/bin/spire-server entry create \
  -parentID "spiffe://${TRUST_DOMAIN}/agent" \
  -spiffeID "$WORKLOAD_ID" \
  -selector unix:uid:0

echo "==> starting spire-agent"
docker compose --profile phase2 up -d spire-agent

echo "==> waiting for authorizer"
for i in $(seq 1 30); do
  curl -sf "$AUTHORIZER/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -sf "$AUTHORIZER/health" >/dev/null \
  || { echo "authorizer never became healthy — check: docker compose logs authorizer"; exit 1; }

echo "==> creating service-account client"
CLIENT_ID_INTERNAL=$(gql 'mutation { _create_client(params: { name: \"spiffe-workload\", allowed_scopes: [\"read:demo\"] }) { client { id } } }' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
echo "    client id: $CLIENT_ID_INTERNAL"

echo "==> registering spiffe_jwt trusted issuer (jwks: $JWKS_URL)"
gql "mutation { _add_trusted_issuer(params: { service_account_id: \\\"$CLIENT_ID_INTERNAL\\\", name: \\\"spire demo\\\", issuer_url: \\\"$ISSUER_URL\\\", key_source_type: \\\"static_jwks_url\\\", jwks_url: \\\"$JWKS_URL\\\", expected_aud: \\\"$EXPECTED_AUD\\\", allowed_subjects: \\\"$WORKLOAD_ID\\\", issuer_type: \\\"spiffe_jwt\\\" }) { id issuer_url is_active } }"
echo

echo "==> starting workload"
docker compose --profile phase2 up -d --build workload
echo "==> done — follow it with: docker compose logs -f workload"
