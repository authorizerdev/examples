#!/usr/bin/env bash
# Bootstraps Keycloak (the org's corporate IdP) via its admin REST API:
#   - realm `acme`
#   - an OIDC client for Authorizer's broker callback
#   - a test corporate user
# Safe to re-run: 409s on existing resources are tolerated.
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8082}"
AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASS="${KC_ADMIN_PASS:-admin}"
ORG_SLUG="${ORG_SLUG:-acme}"
# Obviously-fake demo secret — rotate for anything beyond a local demo.
CLIENT_SECRET="${CLIENT_SECRET:-acme-broker-secret-CHANGE-ME}"

echo "==> Waiting for Keycloak at $KEYCLOAK_URL"
for i in $(seq 1 60); do
  curl -sf "$KEYCLOAK_URL/realms/master/.well-known/openid-configuration" -o /dev/null && break
  sleep 2
done

echo '==> Getting admin token'
KC_TOKEN=$(curl -sf "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli \
  -d "username=$KC_ADMIN_USER" -d "password=$KC_ADMIN_PASS" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

kc() { # kc LABEL METHOD PATH JSON — POST to the admin API; 409 (exists) is OK
  local label="$1" method="$2" path="$3" json="$4" out code
  out=$(curl -s -w '\n%{http_code}' -X "$method" "$KEYCLOAK_URL/admin/realms$path" \
    -H "Authorization: Bearer $KC_TOKEN" -H 'Content-Type: application/json' -d "$json")
  code=${out##*$'\n'}
  case "$code" in
    2*)  echo "==> $label: created ($code)" ;;
    409) echo "==> $label: already exists (409)" ;;
    *)   echo "==> $label: FAILED ($code): ${out%$'\n'*}"; exit 1 ;;
  esac
}

kc "realm '$ORG_SLUG'" POST '' "{\"realm\":\"$ORG_SLUG\",\"enabled\":true}"

kc "OIDC client 'authorizer-broker'" POST "/$ORG_SLUG/clients" "{
  \"clientId\": \"authorizer-broker\",
  \"protocol\": \"openid-connect\",
  \"publicClient\": false,
  \"secret\": \"$CLIENT_SECRET\",
  \"standardFlowEnabled\": true,
  \"directAccessGrantsEnabled\": false,
  \"redirectUris\": [\"$AUTHORIZER_URL/oauth/sso/$ORG_SLUG/callback\"]
}"

kc "test user jdoe@$ORG_SLUG.test" POST "/$ORG_SLUG/users" '{
  "username": "jdoe",
  "email": "jdoe@'"$ORG_SLUG"'.test",
  "firstName": "Jane",
  "lastName": "Doe",
  "enabled": true,
  "emailVerified": true,
  "credentials": [{ "type": "password", "value": "Password123!", "temporary": false }]
}'

cat <<EOF

Keycloak ready:
  issuer        : $KEYCLOAK_URL/realms/$ORG_SLUG
  client_id     : authorizer-broker
  client_secret : $CLIENT_SECRET
  test login    : jdoe / Password123!
EOF
