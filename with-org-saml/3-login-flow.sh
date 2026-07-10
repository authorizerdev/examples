#!/usr/bin/env bash
# Headless (curl-only) walkthrough of the SP-initiated SAML login:
#
#   app ──► /oauth/saml/{org}/login ──► IdP SSO URL (AuthnRequest, HTTP-Redirect)
#       ──► Keycloak login form ──► credentials
#       ──► auto-submit form posts SAMLResponse to /oauth/saml/{org}/acs
#   Authorizer validates the signed assertion (pinned IdP cert, audience,
#   InResponseTo, single-use assertion ID), JIT-provisions the user, sets its
#   session cookie, and redirects back to the app redirect_uri with state.
#
# NOTE (real browsers): Authorizer's CSRF middleware currently blocks
# cross-origin form POSTs to the ACS (the IdP's origin is not allow-listed and
# form posts lack Content-Type: application/json / X-Requested-With). This
# script adds those headers to emulate an accepted POST — see README.
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
ORG_SLUG="${ORG_SLUG:-globex}"
APP_REDIRECT="${APP_REDIRECT:-http://localhost:8090/dashboard}"
KC_USER="${KC_USER:-pgibbons}"
KC_PASS="${KC_PASS:-Password123!}"

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
location() { grep -i '^location:' | tr -d '\r' | cut -d' ' -f2; }

echo '==> 1. App sends the user to the org SAML login endpoint'
IDP_URL=$(curl -s -D - -o /dev/null -c "$JAR" -G \
  "$AUTHORIZER_URL/oauth/saml/$ORG_SLUG/login" \
  --data-urlencode "redirect_uri=$APP_REDIRECT" \
  --data-urlencode "state=demo-app-state-456" | location)
echo "    302 -> IdP with SAMLRequest + RelayState:"
echo "    ${IDP_URL%%\?*}?..."

echo '==> 2. Browser loads the Keycloak login form'
LOGIN_PAGE=$(curl -s -L -c "$JAR" -b "$JAR" "$IDP_URL")
FORM_ACTION=$(printf '%s' "$LOGIN_PAGE" | python3 -c '
import html, re, sys
m = re.search(r"action=\"([^\"]+)\"", sys.stdin.read())
print(html.unescape(m.group(1)))')

echo '==> 3. User submits corporate credentials; IdP returns the auto-submit SAMLResponse form'
RESPONSE_PAGE=$(curl -s -L -c "$JAR" -b "$JAR" "$FORM_ACTION" \
  --data-urlencode "username=$KC_USER" \
  --data-urlencode "password=$KC_PASS")
eval "$(printf '%s' "$RESPONSE_PAGE" | python3 -c '
import html, re, sys, shlex
page = sys.stdin.read()
acs = re.search(r"action=\"([^\"]+)\"", page)
resp = re.search(r"name=\"SAMLResponse\" value=\"([^\"]+)\"", page)
relay = re.search(r"name=\"RelayState\" value=\"([^\"]+)\"", page)
if not (acs and resp):
    sys.exit("    IdP did not return a SAMLResponse form — login failed?")
print("ACS_URL=" + shlex.quote(html.unescape(acs.group(1))))
print("SAML_RESPONSE=" + shlex.quote(html.unescape(resp.group(1))))
print("RELAY_STATE=" + shlex.quote(html.unescape(relay.group(1)) if relay else ""))')"
echo "    form action (ACS): $ACS_URL"

echo '==> 4. Browser auto-posts the SAMLResponse to the ACS'
FINAL=$(curl -s -D - -o /dev/null -c "$JAR" -b "$JAR" "$ACS_URL" \
  -H "Origin: $AUTHORIZER_URL" \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data-urlencode "SAMLResponse=$SAML_RESPONSE" \
  --data-urlencode "RelayState=$RELAY_STATE")
APP_URL=$(printf '%s' "$FINAL" | location)
echo "    302 -> back to the app: $APP_URL"

echo '==> 5. The app now has a normal Authorizer session (user was JIT-provisioned)'
curl -s "$AUTHORIZER_URL/graphql" -b "$JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $AUTHORIZER_URL" \
  -d '{"query":"query { session { user { id email given_name family_name } } }"}' | python3 -m json.tool

echo
echo "Done — user $KC_USER was JIT-provisioned into org '$ORG_SLUG' via SAML and logged in."
