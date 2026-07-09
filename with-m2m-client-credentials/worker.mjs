#!/usr/bin/env node
// Machine worker: authenticates with client_id + client_secret using the
// OAuth2 client_credentials grant (RFC 6749 §4.4) and uses the access token.
//
// Usage:
//   CLIENT_ID=... CLIENT_SECRET=... node worker.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CLIENT_ID and CLIENT_SECRET (from setup.mjs) first.');
  process.exit(1);
}

// The token endpoint takes FORM-ENCODED bodies (RFC 6749 §4.4.2), not JSON.
// `scope` is optional: omitted = full allowed_scopes; requesting anything
// outside allowed_scopes fails with invalid_scope (no silent downgrade).
const res = await fetch(`${AUTHORIZER_URL}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'read:invoices',
  }),
});

const body = await res.json();
if (!res.ok) {
  console.error(`Token request failed: ${body.error}: ${body.error_description}`);
  process.exit(1);
}

console.log('Machine token issued.');
console.log('  token_type :', body.token_type);
console.log('  expires_in :', body.expires_in, 'seconds');
console.log('  scope      :', body.scope);
// No refresh_token and no id_token on client_credentials — re-authenticate on expiry.

// Decode the JWT payload (base64url) just to show what the token carries.
const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
console.log('  claims     :', JSON.stringify({ sub: claims.sub, scope: claims.scope, login_method: claims.login_method }, null, 2));

// Use it like any bearer token against your own APIs, or Authorizer itself:
const profile = await fetch(`${AUTHORIZER_URL}/graphql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${body.access_token}`,
    // CSRF guard: POST /graphql requires an Origin (or Referer) header.
    Origin: AUTHORIZER_URL,
  },
  body: JSON.stringify({ query: 'query { meta { version } }' }),
});
console.log('API call with bearer token:', (await profile.json()).data);
