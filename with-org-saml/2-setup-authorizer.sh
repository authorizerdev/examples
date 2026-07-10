#!/usr/bin/env bash
# Creates the organization and its per-org SAML connection
# (`_create_org_saml_connection`). The IdP entity ID, SSO URL, and signing
# certificate are extracted from Keycloak's SAML IdP descriptor XML.
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8082}"
ADMIN_SECRET="${ADMIN_SECRET:-admin}"
ORG_SLUG="${ORG_SLUG:-globex}"

gql() {
  curl -sf "$AUTHORIZER_URL/graphql" \
    -H 'Content-Type: application/json' \
    -H "Origin: $AUTHORIZER_URL" \
    -H "x-authorizer-admin-secret: $ADMIN_SECRET" \
    -d "{\"query\": $(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
}

echo "==> Fetching the IdP metadata descriptor from Keycloak"
DESCRIPTOR=$(curl -sf "$KEYCLOAK_URL/realms/$ORG_SLUG/protocol/saml/descriptor")

# Extract entityID, the HTTP-Redirect SSO URL, and the signing certificate,
# and re-wrap the cert as PEM (Authorizer expects idp_certificate as PEM).
eval "$(printf '%s' "$DESCRIPTOR" | python3 -c '
import re, shlex, sys, textwrap
xml = sys.stdin.read()
entity = re.search(r"entityID=\"([^\"]+)\"", xml).group(1)
sso = re.search(r"SingleSignOnService[^>]*HTTP-Redirect[^>]*Location=\"([^\"]+)\"", xml)
if not sso:  # attribute order can vary
    sso = re.search(r"SingleSignOnService[^>]*Location=\"([^\"]+)\"[^>]*HTTP-Redirect", xml)
cert = "".join(re.search(r"<ds:X509Certificate>([^<]+)</ds:X509Certificate>", xml).group(1).split())
pem = "-----BEGIN CERTIFICATE-----\n" + "\n".join(textwrap.wrap(cert, 64)) + "\n-----END CERTIFICATE-----\n"
print("IDP_ENTITY_ID=" + shlex.quote(entity))
print("IDP_SSO_URL=" + shlex.quote(sso.group(1)))
print("IDP_CERT_PEM=" + shlex.quote(pem))
')"
echo "    entityID : $IDP_ENTITY_ID"
echo "    SSO URL  : $IDP_SSO_URL"

echo "==> Creating organization '$ORG_SLUG'"
ORG_RESP=$(gql "mutation { _create_organization(params: { name: \"$ORG_SLUG\", display_name: \"Globex Corp\" }) { id name } }")
echo "$ORG_RESP"
ORG_ID=$(printf '%s' "$ORG_RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["data"]["_create_organization"]["id"]) if d.get("data") else exit(1)') || {
  ORG_ID=$(gql "query { _organizations { organizations { id name } } }" |
    python3 -c "import json,sys; print(next(o['id'] for o in json.load(sys.stdin)['data']['_organizations']['organizations'] if o['name']=='$ORG_SLUG'))")
}
echo "==> org_id: $ORG_ID"

echo "==> Creating the org's SAML connection"
# The PEM certificate is passed as a GraphQL variable (it contains newlines).
# sp_entity_id / acs_url are omitted -> derived from the request host:
#   $AUTHORIZER_URL/oauth/saml/$ORG_SLUG/metadata  and  .../acs
# allow_idp_initiated omitted -> false (SP-initiated only; recommended).
BODY=$(ORG_ID="$ORG_ID" IDP_ENTITY_ID="$IDP_ENTITY_ID" IDP_SSO_URL="$IDP_SSO_URL" IDP_CERT_PEM="$IDP_CERT_PEM" python3 -c '
import json, os
query = """mutation($org_id: String!, $entity: String!, $sso: String!, $cert: String!) {
  _create_org_saml_connection(params: {
    org_id: $org_id
    name: "Globex Keycloak SAML"
    idp_entity_id: $entity
    idp_sso_url: $sso
    idp_certificate: $cert
  }) { id org_id name idp_entity_id idp_sso_url sp_entity_id acs_url allow_idp_initiated is_active }
}"""
print(json.dumps({"query": query, "variables": {
    "org_id": os.environ["ORG_ID"],
    "entity": os.environ["IDP_ENTITY_ID"],
    "sso": os.environ["IDP_SSO_URL"],
    "cert": os.environ["IDP_CERT_PEM"],
}}))')
curl -sf "$AUTHORIZER_URL/graphql" \
  -H 'Content-Type: application/json' \
  -H "Origin: $AUTHORIZER_URL" \
  -H "x-authorizer-admin-secret: $ADMIN_SECRET" \
  -d "$BODY" | python3 -m json.tool

echo
echo "==> SP metadata Authorizer advertises for this org (register at the IdP):"
curl -sf "$AUTHORIZER_URL/oauth/saml/$ORG_SLUG/metadata" | head -c 400; echo; echo '...'

cat <<EOF

SAML SP is configured. Start a login with:

  $AUTHORIZER_URL/oauth/saml/$ORG_SLUG/login?redirect_uri=<your-app>&state=<random>

or run ./3-login-flow.sh for a fully headless walkthrough.
EOF
