#!/usr/bin/env bash
# Headless (curl-only) walkthrough of the brokered login:
#
#   app ──► /oauth/sso/{org}/login ──► Keycloak login form ──► credentials
#       ◄── /oauth/sso/{org}/callback ◄── code
#   Authorizer verifies the ID token, JIT-provisions the user, sets its
#   session cookie, and redirects back to the app redirect_uri with state.
#
# In a real app you just send the browser to the /login URL — everything
# below is what the browser does for you.
set -euo pipefail

AUTHORIZER_URL="${AUTHORIZER_URL:-http://localhost:8080}"
ORG_SLUG="${ORG_SLUG:-acme}"
# Must pass Authorizer's --allowed-origins validation:
APP_REDIRECT="${APP_REDIRECT:-http://localhost:8090/dashboard}"
KC_USER="${KC_USER:-jdoe}"
KC_PASS="${KC_PASS:-Password123!}"

JAR=$(mktemp)  # one cookie jar for both Keycloak and Authorizer cookies
trap 'rm -f "$JAR"' EXIT

location() { grep -i '^location:' | tr -d '\r' | cut -d' ' -f2; }

echo '==> 1. App sends the user to the org SSO login endpoint'
AUTH_URL=$(curl -s -D - -o /dev/null -c "$JAR" -G \
  "$AUTHORIZER_URL/oauth/sso/$ORG_SLUG/login" \
  --data-urlencode "redirect_uri=$APP_REDIRECT" \
  --data-urlencode "state=demo-app-state-123" | location)
echo "    302 -> upstream IdP authorize (PKCE + state + nonce):"
echo "    ${AUTH_URL%%\?*}?..."

echo '==> 2. Browser loads the Keycloak login form'
LOGIN_PAGE=$(curl -s -c "$JAR" -b "$JAR" "$AUTH_URL")
FORM_ACTION=$(printf '%s' "$LOGIN_PAGE" | python3 -c '
import html, re, sys
m = re.search(r"action=\"([^\"]+)\"", sys.stdin.read())
print(html.unescape(m.group(1)))')

echo '==> 3. User submits corporate credentials at the IdP'
CALLBACK_URL=$(curl -s -D - -o /dev/null -c "$JAR" -b "$JAR" "$FORM_ACTION" \
  --data-urlencode "username=$KC_USER" \
  --data-urlencode "password=$KC_PASS" | location)
case "$CALLBACK_URL" in
  "$AUTHORIZER_URL"/oauth/sso/*) echo "    302 -> broker callback with code" ;;
  *) echo "    Login failed (no redirect back): $CALLBACK_URL"; exit 1 ;;
esac

echo '==> 4. Broker callback: code exchange + ID-token verification + JIT provision'
FINAL=$(curl -s -D - -o /dev/null -c "$JAR" -b "$JAR" "$CALLBACK_URL")
APP_URL=$(printf '%s' "$FINAL" | location)
echo "    302 -> back to the app: $APP_URL"
printf '%s' "$FINAL" | grep -ci '^set-cookie:' | xargs -I{} echo "    session cookies set: {}"

echo '==> 5. The app now has a normal Authorizer session (GraphQL `session` query)'
curl -s "$AUTHORIZER_URL/graphql" -b "$JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $AUTHORIZER_URL" \
  -d '{"query":"query { session { user { id email given_name family_name } } }"}' | python3 -m json.tool

echo
echo "Done — user $KC_USER was JIT-provisioned into org '$ORG_SLUG' and logged in."
