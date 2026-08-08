// End-to-end walkthrough of an A2A client talking to the demo agent:
//
// 1. Discover the Agent Card                     -> find securitySchemes
// 2. Read the oauth2 scheme's tokenUrl            -> Authorizer's /oauth/token
// 3. Register + authenticate as an agent (client_credentials)
// 4. Call the skill without a token               -> 401
// 5. Call the skill with the token                 -> 200
// 6. Call the skill DELEGATED, on a user's behalf  -> 200
//    (RFC 8693 token exchange; the card and the bearer check are unchanged)
// 7. Call the skill with a token lacking the card's
//    required scope                                -> 403
//
// Setup (step 3) needs the admin secret once, to register the calling agent
// as a service account. Real deployments do this from the dashboard.

import { randomUUID } from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:4002";
const AUTHORIZER_URL = process.env.AUTHORIZER_URL || "http://localhost:8080";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin";

const log = (step, msg) => console.log(`\n[${step}] ${msg}`);

// A token-withheld MFA offer is identified by a session cookie the server marks
// Secure, so no HTTP client replays it over plain http — carry it by hand.
let cookie = "";

async function gql(query, variables, headers = {}) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: AUTHORIZER_URL,
      ...(cookie && { Cookie: cookie }),
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  const mfa = res.headers.getSetCookie().find((c) => c.startsWith("mfa_session="));
  if (mfa) cookie = mfa.split(";")[0];
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// /oauth/token takes FORM-ENCODED bodies.
async function oauthToken(params) {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body;
}

const decodeJwt = (jwt) =>
  JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// Register a service account and return its credentials.
async function registerAgent(name, allowed_scopes) {
  const d = await gql(
    `mutation ($params: CreateClientRequest!) { _create_client(params: $params) { client { client_id } client_secret } }`,
    { params: { name, allowed_scopes } },
    { "x-authorizer-admin-secret": ADMIN_SECRET }
  );
  return { clientId: d._create_client.client.client_id, clientSecret: d._create_client.client_secret };
}

// POST a SendMessage call, optionally bearing `token`. Non-200 is data here:
// the walkthrough asserts on rejections too.
async function callSkill(id, token) {
  const res = await fetch(a2aUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "SendMessage",
      // v1.0 SendMessage: params carry a REQUIRED `message` (Message with role + parts).
      params: {
        message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text: "hi" }] },
      },
    }),
  });
  return { status: res.status, body: await res.json() };
}

// --- 1. Discover the Agent Card ---------------------------------------------
const card = await (await fetch(`${AGENT_URL}/.well-known/agent-card.json`)).json();
log(1, `agent: ${card.name} — ${card.description}`);
log(1, `skills: ${card.skills.map((s) => s.id).join(", ")}`);

// v1.0: the JSON-RPC endpoint lives in supportedInterfaces[], not a top-level url.
const jsonrpc = card.supportedInterfaces.find((i) => i.protocolBinding === "JSONRPC");
const a2aUrl = jsonrpc.url;
log(1, `interface: ${jsonrpc.protocolBinding} v${jsonrpc.protocolVersion} at ${a2aUrl}`);

// --- 2. Read the oauth2 security scheme -------------------------------------
// v1.0 SecurityScheme is a oneof: the kind is the JSON key (oauth2SecurityScheme).
const [schemeName, scheme] = Object.entries(card.securitySchemes)[0];
const tokenUrl = scheme.oauth2SecurityScheme.flows.clientCredentials.tokenUrl;
log(2, `security scheme "${schemeName}": client_credentials tokenUrl=${tokenUrl}`);

// --- 3. Register the calling agent as a service account, get a token -------
const { clientId, clientSecret } = await registerAgent(
  `a2a-demo-caller-${Date.now()}`,
  ["openid"]
);
log(3, `caller agent registered: ${clientId}`);

const token = await oauthToken({
  grant_type: "client_credentials",
  client_id: clientId,
  client_secret: clientSecret,
});
log(3, `client_credentials token acquired`);

// --- 4. Call the skill without a token --------------------------------------
const unauth = await callSkill(1);
log(4, `call without a token -> HTTP ${unauth.status}`);
if (unauth.status !== 401) throw new Error("expected 401");

// --- 5. Call the skill with the token ---------------------------------------
const authed = await callSkill(2, token.access_token);
log(5, `call with the token -> HTTP ${authed.status}: ${JSON.stringify(authed.body.result)}`);
if (authed.status !== 200) throw new Error("expected 200");

// --- 6. The same call, DELEGATED on a user's behalf --------------------------
// The Agent Card advertises client_credentials, and this server's bearer check
// only cares that the token is a valid Authorizer-issued one — so an agent that
// must act FOR a user swaps the grant, not the card. RFC 8693 token exchange,
// delegation profile: an actor_token is REQUIRED (Authorizer rejects
// impersonation), and the minted token keeps sub = the user while recording the
// agent in `act`.
const email = `a2a-demo-user+${Date.now()}@example.com`;
const password = "A2a-demo-user-1!";
const scope = ["openid"];

const signup = await gql(
  `mutation ($params: SignUpRequest!) { signup(params: $params) { access_token } }`,
  { params: { email, password, confirm_password: password, scope } }
);
// Since 2.4.0 MFA is ON by default, so signup enrols nothing but OFFERS an MFA
// setup and WITHHOLDS the access token ("Proceed to mfa setup") until the user
// either enrols a factor or explicitly declines. This demo declines, which is
// what skip_mfa_setup is for: it records the refusal and releases the withheld
// token. Identification is by the MFA session cookie carried above plus the
// email, so it must run on the same client. Fails under --enforce-mfa, where
// declining is not permitted; a real app would drive the setup screen instead.
let userToken = signup.access_token;
if (!userToken) {
  log(6, `signup withheld the token and offered MFA setup — declining it`);
  const skipped = await gql(
    `mutation ($params: SkipMfaSetupRequest!) { skip_mfa_setup(params: $params) { access_token } }`,
    { params: { email } }
  );
  userToken = skipped.skip_mfa_setup.access_token;
}

const delegated = await oauthToken({
  grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
  client_id: clientId,
  client_secret: clientSecret,
  subject_token: userToken, // whose authority is exercised
  subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  actor_token: token.access_token, // who is acting — REQUIRED, no impersonation
  actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
  resource: a2aUrl, // EXACTLY ONE resource (RFC 8707)
  scope: "openid",
});
const claims = decodeJwt(delegated.access_token);
log(6, `delegated token: sub=${claims.sub} act=${JSON.stringify(claims.act)} aud=${claims.aud} scope=${JSON.stringify(claims.scope)}`);
if (claims.act?.sub !== clientId) throw new Error("act.sub should be the calling agent");

const onBehalf = await callSkill(3, delegated.access_token);
log(6, `delegated call -> HTTP ${onBehalf.status}: authenticated as ${onBehalf.body.result?.message?.metadata?.authenticatedAs} (the user, not the agent)`);
if (onBehalf.status !== 200) throw new Error("expected 200");

// --- 7. A token that lacks the scope the card demands -> 403 ------------------
// The card's `security` requirement is not decoration: a perfectly valid
// Authorizer token whose scopes don't satisfy it is rejected.
const weak = await registerAgent(`a2a-demo-unscoped-${Date.now()}`, ["profile"]);
const weakToken = await oauthToken({
  grant_type: "client_credentials",
  client_id: weak.clientId,
  client_secret: weak.clientSecret,
});
const denied = await callSkill(4, weakToken.access_token);
log(7, `valid token without scope "openid" -> HTTP ${denied.status}: ${denied.body.error} (${denied.body.error_description})`);
if (denied.status !== 403) throw new Error("expected 403");

console.log(
  "\nDone: card discovery -> client_credentials -> authenticated call -> delegated call (act chain) -> scope rejection."
);
