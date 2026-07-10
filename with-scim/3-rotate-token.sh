#!/usr/bin/env bash
# Rotates the org's SCIM bearer token. The old token is invalidated
# immediately; the new one is shown ONCE. Update your IdP's secret right after.
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
ADMIN_SECRET="${ADMIN_SECRET:-admin}"
ORG_SLUG="${ORG_SLUG:-initech}"

gql() {
  curl -sf "$AUTHORIZER_URL/graphql" \
    -H 'Content-Type: application/json' \
    -H "Origin: $AUTHORIZER_URL" \
    -H "x-authorizer-admin-secret: $ADMIN_SECRET" \
    -d "{\"query\": $(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
}

ORG_ID=$(gql "query { _organizations { organizations { id name } } }" |
  python3 -c "import json,sys; print(next(o['id'] for o in json.load(sys.stdin)['data']['_organizations']['organizations'] if o['name']=='$ORG_SLUG'))")

echo "==> Rotating SCIM token for org '$ORG_SLUG' ($ORG_ID)"
RESP=$(gql "mutation { _rotate_scim_token(params: { org_id: \"$ORG_ID\" }) { scim_endpoint { id enabled } token } }")
echo "$RESP" | python3 -m json.tool
NEW_TOKEN=$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["_rotate_scim_token"]["token"])')

if [ -n "${SCIM_TOKEN:-}" ]; then
  echo
  echo '==> Proving the OLD token is dead (expect HTTP 401):'
  curl -s -o /dev/null -w 'old token -> HTTP %{http_code}\n' \
    "$AUTHORIZER_URL/scim/v2/ServiceProviderConfig" -H "Authorization: Bearer $SCIM_TOKEN"
fi

curl -s -o /dev/null -w 'new token -> HTTP %{http_code}\n' \
  "$AUTHORIZER_URL/scim/v2/ServiceProviderConfig" -H "Authorization: Bearer $NEW_TOKEN"

cat <<EOF

  New SCIM token (shown once): $NEW_TOKEN

  export SCIM_TOKEN=$NEW_TOKEN

Now update the secret at your IdP (Okta "API token" / Entra "Secret Token").
EOF
