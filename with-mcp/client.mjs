// End-to-end walkthrough: 401 -> discovery -> token -> 200.
//
// 1. Call the MCP server with no token            -> 401 + WWW-Authenticate
// 2. Fetch RFC 9728 protected-resource metadata   -> find the AS (Authorizer)
// 3. Fetch the AS's OIDC metadata                 -> find the token endpoint
// 4. Mint a delegated, resource-bound token:
//      a. user signs up / logs in (GraphQL)       -> subject_token
//      b. agent service-account client_credentials-> actor_token
//      c. RFC 8693 token exchange + resource=...  -> aud-bound access token
// 5. Call the MCP server with the token           -> 200, tools work
//
// Setup (step 4b) needs the admin secret once, to register the agent
// service account. Real deployments do this from the dashboard.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:4001/mcp";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin";

const log = (step, msg) => console.log(`\n[${step}] ${msg}`);
const decodeJwt = (t) =>
  JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

async function gql(url, query, variables, headers = {}) {
  const res = await fetch(`${url}/graphql`, {
    method: "POST",
    // Authorizer's CSRF guard requires an Origin on state-changing requests.
    headers: { "Content-Type": "application/json", Origin: url, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// --- 1. Unauthenticated call: expect 401 + WWW-Authenticate ---------------
const probe = await fetch(MCP_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
});
log(1, `POST ${MCP_URL} without a token -> HTTP ${probe.status}`);
const www = probe.headers.get("www-authenticate");
log(1, `WWW-Authenticate: ${www}`);
if (probe.status !== 401) throw new Error("expected 401");

// --- 2. RFC 9728 discovery: resource metadata -> authorization server -----
const metadataUrl = /resource_metadata="([^"]+)"/.exec(www)[1];
const prm = await (await fetch(metadataUrl)).json();
log(2, `resource metadata ${metadataUrl}`);
log(2, `resource=${prm.resource} authorization_servers=${prm.authorization_servers}`);
const authorizerUrl = prm.authorization_servers[0];

// --- 3. AS metadata: token endpoint ----------------------------------------
const oidc = await (
  await fetch(`${authorizerUrl}/.well-known/openid-configuration`)
).json();
log(3, `token_endpoint=${oidc.token_endpoint}`);

// --- 4a. User signs up (the human the agent will act for) ------------------
const email = `mcp_demo_${Date.now()}@authorizer.dev`;
const password = "Password@123";
const signup = await gql(
  authorizerUrl,
  `mutation ($params: SignUpRequest!) { signup(params: $params) { access_token } }`,
  { params: { email, password, confirm_password: password } }
);
const subjectToken = signup.signup.access_token;
log("4a", `user ${email} signed up; subject_token acquired`);

// --- 4b. Register the agent service account (admin, one-time setup) --------
const created = await gql(
  authorizerUrl,
  `mutation ($params: CreateClientRequest!) { _create_client(params: $params) { client { client_id } client_secret } }`,
  { params: { name: `mcp-demo-agent-${Date.now()}`, allowed_scopes: ["openid", "email", "profile"] } },
  { "x-authorizer-admin-secret": ADMIN_SECRET }
);
const { client_id: agentId } = created._create_client.client;
const agentSecret = created._create_client.client_secret;
log("4b", `agent service account registered: ${agentId}`);

const basic = Buffer.from(`${agentId}:${agentSecret}`).toString("base64");
const ccRes = await fetch(oidc.token_endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${basic}`,
  },
  body: new URLSearchParams({ grant_type: "client_credentials" }),
});
const cc = await ccRes.json();
if (!ccRes.ok) throw new Error(JSON.stringify(cc));
log("4b", `agent actor_token acquired via client_credentials`);

// The agent token is valid but NOT bound to the MCP server (its aud is the
// deployment client_id) — the MCP server must reject it. RFC 8707 in action.
const wrongAud = await fetch(MCP_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${cc.access_token}`,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
});
log("4b", `agent token (aud != MCP server) rejected -> HTTP ${wrongAud.status}`);
if (wrongAud.status !== 401) throw new Error("expected 401 for wrong audience");

// --- 4c. RFC 8693 token exchange, bound to this MCP server (RFC 8707) ------
const xchgRes = await fetch(oidc.token_endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${basic}`,
  },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    actor_token: cc.access_token,
    actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
    resource: prm.resource, // <- binds aud to the MCP server
  }),
});
const xchg = await xchgRes.json();
if (!xchgRes.ok) throw new Error(JSON.stringify(xchg));
const claims = decodeJwt(xchg.access_token);
log("4c", `delegated token minted: aud=${claims.aud} scope=[${claims.scope}] act.sub=${claims.act?.sub}`);

// --- 5. Authenticated MCP session ------------------------------------------
const client = new Client({ name: "demo-client", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${xchg.access_token}` } },
  })
);
const tools = await client.listTools();
log(5, `MCP connected. tools: ${tools.tools.map((t) => t.name).join(", ")}`);

const whoami = await client.callTool({ name: "whoami", arguments: {} });
log(5, `whoami ->\n${whoami.content[0].text}`);

const sum = await client.callTool({ name: "add", arguments: { a: 20, b: 22 } });
log(5, `add(20, 22) -> ${sum.content[0].text}`);

await client.close();
console.log("\nDone: 401 -> discovery -> token -> 200.");
