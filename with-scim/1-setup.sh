#!/usr/bin/env bash
# Creates an organization and its SCIM 2.0 endpoint via Authorizer's admin
# GraphQL API. Prints the SCIM bearer token — it is shown EXACTLY ONCE.
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
ADMIN_SECRET="${ADMIN_SECRET:-admin}"          # obviously-fake dev secret
ORG_SLUG="${ORG_SLUG:-initech}"

gql() { # gql '<query>' — admin GraphQL call (Origin must be allow-listed)
  curl -sf "$AUTHORIZER_URL/graphql" \
    -H 'Content-Type: application/json' \
    -H "Origin: $AUTHORIZER_URL" \
    -H "x-authorizer-admin-secret: $ADMIN_SECRET" \
    -d "{\"query\": $(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
}

echo "==> Creating organization '$ORG_SLUG'"
ORG_RESP=$(gql "mutation { _create_organization(params: { name: \"$ORG_SLUG\", display_name: \"Initech Inc\" }) { id name } }")
echo "$ORG_RESP"
ORG_ID=$(printf '%s' "$ORG_RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["data"]["_create_organization"]["id"]) if d.get("data") else exit(1)') || {
  # Org may already exist — look it up.
  ORG_ID=$(gql "query { _organizations { organizations { id name } } }" |
    python3 -c "import json,sys; print(next(o['id'] for o in json.load(sys.stdin)['data']['_organizations']['organizations'] if o['name']=='$ORG_SLUG'))")
}
echo "==> org_id: $ORG_ID"

echo "==> Creating SCIM endpoint (token is returned ONCE — store it now)"
SCIM_RESP=$(gql "mutation { _create_scim_endpoint(params: { org_id: \"$ORG_ID\" }) { scim_endpoint { id org_id enabled } token } }")
echo "$SCIM_RESP" | python3 -m json.tool
TOKEN=$(printf '%s' "$SCIM_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["_create_scim_endpoint"]["token"])')

cat <<EOF

  SCIM base URL : $AUTHORIZER_URL/scim/v2
  Bearer token  : $TOKEN

  export SCIM_TOKEN=$TOKEN
EOF
