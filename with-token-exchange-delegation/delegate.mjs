#!/usr/bin/env node
// RFC 8693 token exchange, delegation profile:
//   1. A user logs in (their token = the authority being exercised).
//   2. The agent gets its own machine token (client_credentials).
//   3. The agent exchanges user token + its own token for a short-lived,
//      down-scoped, resource-bound token whose `act` claim records WHO acted.
//
// Usage:
//   AGENT_CLIENT_ID=... AGENT_CLIENT_SECRET=... node delegate.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
const AGENT_CLIENT_ID = process.env.AGENT_CLIENT_ID;
const AGENT_CLIENT_SECRET = process.env.AGENT_CLIENT_SECRET;
const RESOURCE = 'https://calendar.example';

if (!AGENT_CLIENT_ID || !AGENT_CLIENT_SECRET) {
  console.error('Set AGENT_CLIENT_ID and AGENT_CLIENT_SECRET (from setup.mjs) first.');
  process.exit(1);
}

// A token-withheld MFA offer is identified by a session cookie, and Node's
// fetch has no cookie jar — so carry the cookie across requests by hand.
let cookie = '';

const gql = async (query, variables) => {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: AUTHORIZER_URL,
      ...(cookie && { Cookie: cookie }),
    },
    body: JSON.stringify({ query, variables }),
  });
  const mfa = res.headers.getSetCookie().find((c) => c.startsWith('mfa_session='));
  if (mfa) cookie = mfa.split(';')[0];
  return res.json();
};

const oauthToken = async (params) => {
  // /oauth/token takes FORM-ENCODED bodies.
  const res = await fetch(`${AUTHORIZER_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${body.error}: ${body.error_description}`);
  return body;
};

const decode = (jwt) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

// --- 1. User signs up (fresh email each run, so the demo is re-runnable) ---
const email = `delegation-demo+${Date.now()}@example.com`;
const password = 'Delegation-demo-1!';
const scope = ['openid', 'email', 'profile', 'calendar:read', 'calendar:write'];

const auth = await gql(
  `mutation ($params: SignUpRequest!) { signup(params: $params) { access_token } }`,
  { params: { email, password, confirm_password: password, scope } },
);
if (auth.errors?.length) throw new Error(auth.errors[0].message);

// Since 2.4.0 MFA is ON by default, so signup OFFERS an MFA setup and WITHHOLDS
// the access token ("Proceed to mfa setup") until the user either enrols a
// factor or explicitly declines. This demo declines, which is what
// skip_mfa_setup is for: it records the refusal and releases the withheld
// token. Identification is by the MFA session cookie set above plus the email,
// so it must run on the same client. Fails under --enforce-mfa, where declining
// is not permitted; a real app would drive the TOTP/OTP setup screen instead.
//
// The token skip_mfa_setup releases carries the DEFAULT scope, not the scope
// signup asked for — the pending MFA session does not carry the request's
// scope through. So log in again once the offer is out of the way: now that
// the user has declined, login returns a token directly, with the scope we ask
// for. That scope is the subject authority the exchange below attenuates.
let userToken = auth.data.signup.access_token;
if (!userToken) {
  const skipped = await gql(
    `mutation ($params: SkipMfaSetupRequest!) { skip_mfa_setup(params: $params) { access_token } }`,
    { params: { email } },
  );
  if (skipped.errors?.length) throw new Error(skipped.errors[0].message);

  const relogin = await gql(
    `mutation ($params: LoginRequest!) { login(params: $params) { access_token } }`,
    { params: { email, password, scope } },
  );
  if (relogin.errors?.length) throw new Error(relogin.errors[0].message);
  userToken = relogin.data.login.access_token;
}
console.log('1. user token scope     :', decode(userToken).scope.join(' '));

// --- 2. Agent gets its own token (client_credentials) ---------------------
const agentGrant = await oauthToken({
  grant_type: 'client_credentials',
  client_id: AGENT_CLIENT_ID,
  client_secret: AGENT_CLIENT_SECRET,
});
console.log('2. agent token scope    :', agentGrant.scope);

// --- 3. Exchange: user token + agent token -> delegated token -------------
const exchange = await oauthToken({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  client_id: AGENT_CLIENT_ID,
  client_secret: AGENT_CLIENT_SECRET,
  subject_token: userToken, // whose authority is exercised
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  actor_token: agentGrant.access_token, // who is acting
  actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  resource: RESOURCE, // EXACTLY ONE resource (RFC 8707)
  scope: 'calendar:read', // optional further down-scope
});

const claims = decode(exchange.access_token);
console.log('3. delegated token:');
console.log('   sub (the user)       :', claims.sub);
console.log('   act (who is acting)  :', JSON.stringify(claims.act));
console.log('   aud (bound resource) :', claims.aud);
console.log('   scope (attenuated)   :', JSON.stringify(claims.scope));
console.log('   expires_in           :', exchange.expires_in, 'seconds (fixed 5-minute TTL)');

if (claims.act?.sub !== AGENT_CLIENT_ID) {
  throw new Error('act.sub should be the authenticated agent client_id');
}
console.log('\nOK: token says "agent %s acting on behalf of user %s" at %s',
  claims.act.sub, claims.sub, claims.aud);
