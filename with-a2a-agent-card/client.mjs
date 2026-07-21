// End-to-end walkthrough of an A2A client talking to the demo agent:
//
// 1. Discover the Agent Card                     -> find securitySchemes
// 2. Read the oauth2 scheme's tokenUrl            -> Authorizer's /oauth/token
// 3. Register + authenticate as an agent (client_credentials)
// 4. Call the skill without a token               -> 401
// 5. Call the skill with the token                 -> 200
//
// Setup (step 3) needs the admin secret once, to register the calling agent
// as a service account. Real deployments do this from the dashboard.

import { randomUUID } from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:4002";
const AUTHORIZER_URL = process.env.AUTHORIZER_URL || "http://localhost:8080";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin";

const log = (step, msg) => console.log(`\n[${step}] ${msg}`);

async function gql(query, variables, headers = {}) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: AUTHORIZER_URL, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
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
const created = await gql(
  `mutation ($params: CreateClientRequest!) { _create_client(params: $params) { client { client_id } client_secret } }`,
  { params: { name: `a2a-demo-caller-${Date.now()}`, allowed_scopes: ["openid"] } },
  { "x-authorizer-admin-secret": ADMIN_SECRET }
);
const { client_id: clientId } = created._create_client.client;
const clientSecret = created._create_client.client_secret;
log(3, `caller agent registered: ${clientId}`);

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const tokenRes = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
  body: new URLSearchParams({ grant_type: "client_credentials" }),
});
const token = await tokenRes.json();
if (!tokenRes.ok) throw new Error(JSON.stringify(token));
log(3, `client_credentials token acquired`);

// v1.0 SendMessage: params carry a REQUIRED `message` (Message with role + parts).
const sendMessage = (id) => ({
  jsonrpc: "2.0",
  id,
  method: "SendMessage",
  params: {
    message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text: "hi" }] },
  },
});

// --- 4. Call the skill without a token --------------------------------------
const unauth = await fetch(a2aUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(sendMessage(1)),
});
log(4, `call without a token -> HTTP ${unauth.status}`);
if (unauth.status !== 401) throw new Error("expected 401");

// --- 5. Call the skill with the token ---------------------------------------
const authed = await fetch(a2aUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.access_token}` },
  body: JSON.stringify(sendMessage(2)),
});
const result = await authed.json();
log(5, `call with the token -> HTTP ${authed.status}: ${JSON.stringify(result.result)}`);
if (authed.status !== 200) throw new Error("expected 200");

console.log("\nDone: agent card discovery -> client_credentials -> authenticated A2A call.");
