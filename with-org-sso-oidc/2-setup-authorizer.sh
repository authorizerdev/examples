#!/usr/bin/env bash
# Creates the organization and its per-org OIDC SSO connection via
# Authorizer's admin GraphQL API (`_create_organization`,
# `_create_org_oidc_connection`). Authorizer acts as the Relying Party
# (broker) toward the org's Keycloak.
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8082}"
ADMIN_SECRET="${ADMIN_SECRET:-admin}"
ORG_SLUG="${ORG_SLUG:-acme}"
CLIENT_SECRET="${CLIENT_SECRET:-acme-broker-secret-CHANGE-ME}"

gql() {
  curl -sf "$AUTHORIZER_URL/graphql" \
    -H 'Content-Type: application/json' \
    -H "Origin: $AUTHORIZER_URL" \
    -H "x-authorizer-admin-secret: $ADMIN_SECRET" \
    -d "{\"query\": $(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
}

echo "==> Creating organization '$ORG_SLUG'"
ORG_RESP=$(gql "mutation { _create_organization(params: { name: \"$ORG_SLUG\", display_name: \"ACME Corp\" }) { id name } }")
echo "$ORG_RESP"
ORG_ID=$(printf '%s' "$ORG_RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["data"]["_create_organization"]["id"]) if d.get("data") else exit(1)') || {
  ORG_ID=$(gql "query { _organizations { organizations { id name } } }" |
    python3 -c "import json,sys; print(next(o['id'] for o in json.load(sys.stdin)['data']['_organizations']['organizations'] if o['name']=='$ORG_SLUG'))")
}
echo "==> org_id: $ORG_ID"

echo "==> Creating the org's OIDC connection (issuer = Keycloak realm)"
gql "mutation {
  _create_org_oidc_connection(params: {
    org_id: \"$ORG_ID\"
    name: \"ACME Keycloak\"
    issuer_url: \"$KEYCLOAK_URL/realms/$ORG_SLUG\"
    client_id: \"authorizer-broker\"
    client_secret: \"$CLIENT_SECRET\"
    # scopes default to \"openid profile email\"
    # redirect_uri is derived from the request host when omitted:
    #   $AUTHORIZER_URL/oauth/sso/$ORG_SLUG/callback
  }) { id org_id name issuer_url sso_client_id scopes is_active }
}" | python3 -m json.tool

echo
echo "==> Verify with the _org_oidc_connection query (client_secret is never returned)"
gql "query { _org_oidc_connection(params: { org_id: \"$ORG_ID\" }) { id name issuer_url sso_client_id is_active } }" | python3 -m json.tool

cat <<EOF

Org SSO is configured. Start a login with:

  $AUTHORIZER_URL/oauth/sso/$ORG_SLUG/login?redirect_uri=<your-app>&state=<random>

or run ./3-login-flow.sh for a fully headless walkthrough.
EOF
