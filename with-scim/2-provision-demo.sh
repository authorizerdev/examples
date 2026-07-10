#!/usr/bin/env bash
# Simulates what an enterprise IdP (Okta / Microsoft Entra ID) sends to the
# per-org SCIM 2.0 endpoint: dedup probe, create, get, update, deactivate
# (which synchronously revokes the user's sessions), and reactivate.
#
# Requires: SCIM_TOKEN from 1-setup.sh
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
SCIM="$AUTHORIZER_URL/scim/v2"
: "${SCIM_TOKEN:?run 1-setup.sh first and export SCIM_TOKEN}"

scim() { # scim METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$SCIM$path" \
      -H "Authorization: Bearer $SCIM_TOKEN" \
      -H 'Content-Type: application/scim+json' \
      -d "$body"
  else
    curl -s -X "$method" "$SCIM$path" -H "Authorization: Bearer $SCIM_TOKEN"
  fi
}

echo '==> Discovery: ServiceProviderConfig'
scim GET /ServiceProviderConfig | python3 -m json.tool

echo
echo '==> Dedup probe (what Okta/Entra send before creating a user)'
curl -s -G "$SCIM/Users" -H "Authorization: Bearer $SCIM_TOKEN" \
  --data-urlencode 'filter=userName eq "milton@initech.test"' | python3 -m json.tool

echo
echo '==> Create (JIT-provision) a user'
CREATE=$(scim POST /Users '{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "milton@initech.test",
  "externalId": "00u1milton",
  "name": { "givenName": "Milton", "familyName": "Waddams" },
  "emails": [{ "value": "milton@initech.test", "primary": true }],
  "active": true
}')
echo "$CREATE" | python3 -m json.tool
USER_ID=$(printf '%s' "$CREATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id",""))')
if [ -z "$USER_ID" ]; then
  echo '==> User already exists (rerun) — resolving id via the dedup filter'
  USER_ID=$(curl -s -G "$SCIM/Users" -H "Authorization: Bearer $SCIM_TOKEN" \
    --data-urlencode 'filter=userName eq "milton@initech.test"' |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["Resources"][0]["id"])')
fi
echo "==> SCIM user id: $USER_ID"

echo
echo '==> Get the user'
scim GET "/Users/$USER_ID" | python3 -m json.tool

echo
echo '==> List with filter (returns the user; an UNFILTERED list is an empty set by design)'
curl -s -G "$SCIM/Users" -H "Authorization: Bearer $SCIM_TOKEN" \
  --data-urlencode 'filter=userName eq "milton@initech.test"' | python3 -m json.tool
scim GET /Users | python3 -m json.tool

echo
echo '==> Update profile via PUT (PATCH honours only the `active` attribute — the Okta/Entra deprovision path; use PUT for profile edits)'
scim PUT "/Users/$USER_ID" '{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "milton@initech.test",
  "name": { "givenName": "Milt", "familyName": "Waddams" },
  "emails": [{ "value": "milton@initech.test", "primary": true }],
  "active": true
}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("givenName =", d["name"]["givenName"]); assert d["name"]["givenName"] == "Milt"'

echo
echo '==> Deactivate (enterprise offboarding — synchronously revokes sessions + refresh tokens)'
scim PATCH "/Users/$USER_ID" '{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [ { "op": "replace", "path": "active", "value": false } ]
}' | python3 -m json.tool

echo
echo '==> Verify: active is now false'
scim GET "/Users/$USER_ID" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("active =", d["active"]); assert d["active"] is False'

echo
echo '==> Reactivate'
scim PUT "/Users/$USER_ID" '{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "milton@initech.test",
  "name": { "givenName": "Milt", "familyName": "Waddams" },
  "emails": [{ "value": "milton@initech.test", "primary": true }],
  "active": true
}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("active =", d["active"]); assert d["active"] is True'

echo
echo '==> DELETE is treated as deactivation (not a hard delete)'
scim DELETE "/Users/$USER_ID"
scim GET "/Users/$USER_ID" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("after DELETE: active =", d["active"])'

echo
echo 'Done.'
