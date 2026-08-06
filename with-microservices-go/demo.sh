#!/usr/bin/env bash
# End-to-end demo. Requires: setup.sh already run, the three services running
# (see README), curl, python3.
#
# Happy path : user signup -> gateway order -> orders -> billing charge
# Negative 1 : gateway's machine token presented at billing -> 403 insufficient_scope
# Negative 2 : orders client requests a scope above its ceiling -> invalid_scope
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] || { echo "error: .env missing — run ./setup.sh first" >&2; exit 1; }
set -a; source .env; set +a

GATEWAY_URL="http://localhost:${GATEWAY_PORT}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1" >&2; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

for svc in "$GATEWAY_URL" "$ORDERS_URL" "$BILLING_URL"; do
  curl -sf -m 3 "$svc/healthz" >/dev/null || { echo "error: service at $svc is not up" >&2; exit 1; }
done

echo "== 1. User signup (Authorizer GraphQL) =="
EMAIL="demo-$(date +%s)-$RANDOM@example.com"
SIGNUP_HEADERS=$(mktemp)
trap 'rm -f "$SIGNUP_HEADERS"' EXIT
USER_TOKEN=$(curl -sf -D "$SIGNUP_HEADERS" -X POST "$AUTHORIZER_URL/graphql" \
  -H 'Content-Type: application/json' \
  -H "Origin: $AUTHORIZER_URL" \
  -d "{\"query\":\"mutation{ signup(params:{email:\\\"$EMAIL\\\", password:\\\"Demo@12345\\\", confirm_password:\\\"Demo@12345\\\"}){ access_token } }\"}" \
  | json "['data']['signup']['access_token'] or ''")
# Since 2.4.0 MFA is on by default, so signup enrols nothing but OFFERS an MFA
# setup: no access token, and the message "Proceed to mfa setup", until the user
# either enrols a factor or explicitly declines. This demo is about
# service-to-service auth, not enrollment, so it declines — that is what
# skip_mfa_setup is for. It is identified by the MFA session cookie the signup
# response set (marked Secure, so no client replays it over plain http — it has
# to be sent by hand) plus the email. Under --enforce-mfa declining is refused.
if [ -z "$USER_TOKEN" ]; then
  MFA_COOKIE=$(grep -io 'mfa_session=[^;]*' "$SIGNUP_HEADERS" | head -1)
  [ -n "$MFA_COOKIE" ] || { bad "signup: no access token and no mfa session"; exit 1; }
  USER_TOKEN=$(curl -sf -X POST "$AUTHORIZER_URL/graphql" \
    -H 'Content-Type: application/json' \
    -H "Origin: $AUTHORIZER_URL" \
    -H "Cookie: $MFA_COOKIE" \
    -d "{\"query\":\"mutation{ skip_mfa_setup(params:{email:\\\"$EMAIL\\\"}){ access_token } }\"}" \
    | json "['data']['skip_mfa_setup']['access_token'] or ''")
fi
[ -n "$USER_TOKEN" ] && ok "signed up $EMAIL, got user access token" || { bad "signup"; exit 1; }

echo "== 2. Who am I (gateway, user JWT) =="
ME=$(curl -sf "$GATEWAY_URL/api/me" -H "Authorization: Bearer $USER_TOKEN")
echo "  $ME"
ok "gateway verified user JWT via JWKS"

echo "== 3. Place order (gateway -> orders -> billing) =="
ORDER=$(curl -sf -X POST "$GATEWAY_URL/api/orders" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"item":"mechanical keyboard","amount_cents":12900}')
echo "  $ORDER"
CHARGE_ID=$(echo "$ORDER" | json "['charge_id']")
[ -n "$CHARGE_ID" ] && ok "order created with cross-service charge $CHARGE_ID" || bad "order/charge"

echo "== 4. Negative: gateway machine token at billing =="
# Mint the gateway's machine token directly (what its TokenSource does).
GW_TOKEN=$(curl -sf -X POST "$AUTHORIZER_URL/oauth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H "Origin: $AUTHORIZER_URL" \
  -d "grant_type=client_credentials&client_id=$GATEWAY_CLIENT_ID&client_secret=$GATEWAY_CLIENT_SECRET&scope=orders:read" \
  | json "['access_token']")
STATUS=$(curl -s -o /tmp/billing_neg.json -w '%{http_code}' -X POST "$BILLING_URL/charge" \
  -H "Authorization: Bearer $GW_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount_cents":100}')
echo "  billing said: HTTP $STATUS $(cat /tmp/billing_neg.json)"
if [ "$STATUS" = "403" ] && grep -q insufficient_scope /tmp/billing_neg.json; then
  ok "billing rejected gateway token: 403 insufficient_scope"
else
  bad "expected 403 insufficient_scope, got HTTP $STATUS"
fi

echo "== 5. Negative: orders client requests scope above its ceiling =="
RES=$(curl -s -X POST "$AUTHORIZER_URL/oauth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H "Origin: $AUTHORIZER_URL" \
  -d "grant_type=client_credentials&client_id=$ORDERS_CLIENT_ID&client_secret=$ORDERS_CLIENT_SECRET&scope=orders:write")
echo "  token endpoint said: $RES"
if echo "$RES" | grep -q '"invalid_scope"'; then
  ok "auth server refused above-ceiling scope: invalid_scope"
else
  bad "expected invalid_scope error"
fi

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
