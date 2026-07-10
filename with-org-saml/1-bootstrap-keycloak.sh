#!/usr/bin/env bash
# Bootstraps Keycloak as the org's SAML 2.0 IdP via its admin REST API:
#   - realm `globex`
#   - a SAML client matching Authorizer's SP entity ID + ACS URL
#   - attribute mappers matching Authorizer's default attribute_mapping
#     (email / firstName / lastName)
#   - a test corporate user
# Safe to re-run: 409s on existing resources are tolerated.
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8082}"
AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASS="${KC_ADMIN_PASS:-admin}"
ORG_SLUG="${ORG_SLUG:-globex}"

# Authorizer's host-derived SP identity for this org (see the SP metadata at
# $AUTHORIZER_URL/oauth/saml/$ORG_SLUG/metadata after 2-setup-authorizer.sh):
SP_ENTITY_ID="$AUTHORIZER_URL/oauth/saml/$ORG_SLUG/metadata"
ACS_URL="$AUTHORIZER_URL/oauth/saml/$ORG_SLUG/acs"

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

kc() { # kc LABEL METHOD PATH JSON — 409 (exists) is OK
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

# SAML client. Notes:
#  - saml.client.signature=false : Authorizer sends UNSIGNED AuthnRequests
#    (HTTP-Redirect binding); Keycloak must not require request signatures.
#  - saml.assertion.signature=true : Authorizer REJECTS unsigned assertions.
#  - NameID format username → Authorizer keys the federated identity by
#    (org, IdP entity ID, NameID), never by email.
kc "SAML client '$SP_ENTITY_ID'" POST "/$ORG_SLUG/clients" "{
  \"clientId\": \"$SP_ENTITY_ID\",
  \"protocol\": \"saml\",
  \"enabled\": true,
  \"redirectUris\": [\"$ACS_URL\"],
  \"frontchannelLogout\": false,
  \"attributes\": {
    \"saml.client.signature\": \"false\",
    \"saml.assertion.signature\": \"true\",
    \"saml.server.signature\": \"true\",
    \"saml.authnstatement\": \"true\",
    \"saml_assertion_consumer_url_post\": \"$ACS_URL\",
    \"saml_name_id_format\": \"username\"
  },
  \"protocolMappers\": [
    { \"name\": \"email\",     \"protocol\": \"saml\", \"protocolMapper\": \"saml-user-property-mapper\",
      \"config\": { \"user.attribute\": \"email\",     \"attribute.name\": \"email\",     \"attribute.nameformat\": \"Basic\" } },
    { \"name\": \"firstName\", \"protocol\": \"saml\", \"protocolMapper\": \"saml-user-property-mapper\",
      \"config\": { \"user.attribute\": \"firstName\", \"attribute.name\": \"firstName\", \"attribute.nameformat\": \"Basic\" } },
    { \"name\": \"lastName\",  \"protocol\": \"saml\", \"protocolMapper\": \"saml-user-property-mapper\",
      \"config\": { \"user.attribute\": \"lastName\",  \"attribute.name\": \"lastName\",  \"attribute.nameformat\": \"Basic\" } }
  ]
}"

kc "test user pgibbons@$ORG_SLUG.test" POST "/$ORG_SLUG/users" '{
  "username": "pgibbons",
  "email": "pgibbons@'"$ORG_SLUG"'.test",
  "firstName": "Peter",
  "lastName": "Gibbons",
  "enabled": true,
  "emailVerified": true,
  "credentials": [{ "type": "password", "value": "Password123!", "temporary": false }]
}'

cat <<EOF

Keycloak SAML IdP ready:
  IdP entity ID  : $KEYCLOAK_URL/realms/$ORG_SLUG
  IdP SSO URL    : $KEYCLOAK_URL/realms/$ORG_SLUG/protocol/saml
  IdP descriptor : $KEYCLOAK_URL/realms/$ORG_SLUG/protocol/saml/descriptor
  test login     : pgibbons / Password123!
EOF
