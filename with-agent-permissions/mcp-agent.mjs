// Put a REAL AI agent behind the intersection, via Authorizer's built-in MCP
// server.
//
// demo.mjs proves the rule with plain HTTP calls. This script wires the same
// rule to an actual MCP host (Claude Code, Claude Desktop, Cursor, any
// MCP-compatible client), so the thing asking "can I view this?" is a real
// model deciding to call a tool — not a script.
//
// It does two things:
//
//   node mcp-agent.mjs            setup + print the `claude mcp add` command
//   node mcp-agent.mjs --verify   the above, then drive the MCP server over
//                                 HTTP and assert the intersection holds
//
// `--verify` is the part worth reading: it speaks the same JSON-RPC an MCP host
// speaks, so a green run means a real host will see exactly this.
//
// Requirements: Node 18+, and the server started by ./run-server.sh, which
// passes --mcp-enabled. Nothing else: the MCP tools are served by that same
// process, and this script is an ordinary HTTP client of it.

const BASE = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "admin";
const ORIGIN = process.env.AUTHORIZER_ORIGIN ?? BASE;

// The canonical MCP resource identifier. It is `<url>/mcp` — the path is part
// of the identity, and it is what the delegated token's `aud` must equal and
// what a client types when adding the connector.
const MCP_RESOURCE = `${BASE}/mcp`;

const USER_EMAIL = "mcp-agent-demo@example.com";
const USER_PASSWORD = "McpAgent@Demo123";
const USER_SCOPES = ["openid", "email", "profile"];

const runId = Date.now();
const DOC_PLAN = `document:q4-plan-${runId}`;
const DOC_PAYROLL = `document:payroll-${runId}`;

const MODEL = `model
  schema 1.1
type user
type agent
type document
  relations
    define viewer: [user, agent]
    define can_view: viewer
`;

// ---------------------------------------------------------------- helpers --

async function gqlFull(query, variables, headers = {}) {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return { data: body.data, setCookies: res.headers.getSetCookie() };
}
const gql = (q, v, h) => gqlFull(q, v, h).then((r) => r.data);
const adminGql = (q, v) => gql(q, v, { "x-authorizer-admin-secret": ADMIN_SECRET });
const cookieHeader = (c) => c.map((x) => x.split(";")[0]).join("; ");

async function oauth(params) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: await res.json() };
}

// See demo.mjs: since 2.4.0 signup/login OFFER MFA enrollment and withhold the
// token until the user enrols or declines. This demo declines.
async function settleMfaOffer(auth, setCookies) {
  if (auth?.access_token) return auth.access_token;
  const { data } = await gqlFull(
    `mutation ($params: SkipMfaSetupRequest!) { skip_mfa_setup(params: $params) { access_token } }`,
    { params: { email: USER_EMAIL } },
    { Cookie: cookieHeader(setCookies) }
  );
  return data.skip_mfa_setup.access_token;
}

const decodeJwt = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// check_permissions over /graphql as the given bearer. Same operation the MCP
// `check_permissions` tool dispatches to — the transports differ, the decision
// does not. Used for the control run, whose token is a first-party login token
// and therefore not valid at /mcp.
async function check(token, object) {
  const data = await gql(
    `query ($params: CheckPermissionsInput!) {
      check_permissions(params: $params) { results { allowed } }
    }`,
    { params: { checks: [{ relation: "can_view", object }] } },
    { Authorization: `Bearer ${token}` }
  );
  return data.check_permissions.results[0].allowed;
}

async function setup() {
  await adminGql(`mutation ($params: FgaWriteModelInput!) { _fga_write_model(params: $params) { id } }`, {
    params: { dsl: MODEL },
  });

  const created = await adminGql(
    `mutation ($params: CreateClientRequest!) {
      _create_client(params: $params) { client { client_id } client_secret }
    }`,
    { params: { name: `mcp-calendar-agent-${runId}`, allowed_scopes: USER_SCOPES } }
  );
  const agent = {
    client_id: created._create_client.client.client_id,
    client_secret: created._create_client.client_secret,
  };

  const machine = await oauth({
    grant_type: "client_credentials",
    client_id: agent.client_id,
    client_secret: agent.client_secret,
  });
  if (machine.status !== 200) throw new Error(`client_credentials: ${JSON.stringify(machine.body)}`);

  let userToken;
  try {
    const { data, setCookies } = await gqlFull(
      `mutation ($params: SignUpRequest!) { signup(params: $params) { access_token } }`,
      { params: { email: USER_EMAIL, password: USER_PASSWORD, confirm_password: USER_PASSWORD, scope: USER_SCOPES } }
    );
    userToken = await settleMfaOffer(data.signup, setCookies);
  } catch {
    const { data, setCookies } = await gqlFull(
      `mutation ($params: LoginRequest!) { login(params: $params) { access_token } }`,
      { params: { email: USER_EMAIL, password: USER_PASSWORD, scope: USER_SCOPES } }
    );
    userToken = await settleMfaOffer(data.login, setCookies);
  }
  const userId = decodeJwt(userToken).sub;

  // Alice sees both documents. The agent is trusted with the Q4 plan ONLY.
  await adminGql(`mutation ($params: FgaWriteTuplesInput!) { _fga_write_tuples(params: $params) { message } }`, {
    params: {
      tuples: [
        { user: `user:${userId}`, relation: "viewer", object: DOC_PLAN },
        { user: `user:${userId}`, relation: "viewer", object: DOC_PAYROLL },
        { user: `agent:${agent.client_id}`, relation: "viewer", object: DOC_PLAN },
      ],
    },
  });

  // The delegated token names the MCP SERVER as its RFC 8707 resource.
  //
  // `${BASE}/mcp`, not `${BASE}`. The audience decides which single surface the
  // token opens, and the two are not interchangeable: a token bound to the bare
  // URL authenticates GraphQL/REST/gRPC and is refused at /mcp, while this one
  // is the exact mirror. Getting it wrong yields a 401 from /mcp that looks like
  // a permissions bug and is really an audience mismatch.
  const delegated = await oauth({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: agent.client_id,
    client_secret: agent.client_secret,
    subject_token: userToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    actor_token: machine.body.access_token,
    actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
    resource: MCP_RESOURCE,
  });
  if (delegated.status !== 200) throw new Error(`token exchange: ${JSON.stringify(delegated.body)}`);

  return { delegated: delegated.body.access_token, userToken, agent, userId };
}

// -------------------------------------------------------- the MCP HTTP probe --

// Speaks the same JSON-RPC an MCP host speaks, over the same Streamable HTTP
// transport a real client uses. No subprocess, no second database connection:
// the tools are served by the server ./run-server.sh already started, and the
// bearer on each request is what decides who is asking.
async function mcpRpc(bearer, method, params) {
  const res = await fetch(MCP_RESOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextRpcId++, method, ...(params ? { params } : {}) }),
  });
  if (res.status === 401) {
    // The 401 IS the protocol here: it carries the RFC 9728 pointer a fresh
    // client follows to discover where to authenticate. For this script it
    // almost always means the token's audience is not `${BASE}/mcp`, or the
    // 5-minute delegated token expired — a delegated token has no refresh
    // token, so the fix is to re-run, not to refresh.
    throw new Error(
      `401 from ${MCP_RESOURCE} (${res.headers.get("www-authenticate") ?? "no challenge"}). ` +
        `Is the server running with --mcp-enabled, and is the token still fresh?`
    );
  }
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

let nextRpcId = 1;

async function driveMcp(bearer, label) {
  await mcpRpc(bearer, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "with-agent-permissions", version: "1.0" },
  });

  const toolCall = async (name, args) => {
    const res = await mcpRpc(bearer, "tools/call", { name, arguments: args });
    if (res.isError) throw new Error(`${name}: ${res.content?.[0]?.text ?? "tool error"}`);
    return JSON.parse(res.content[0].text);
  };

  const check = await toolCall("check_permissions", {
    checks: [
      { relation: "can_view", object: DOC_PLAN },
      { relation: "can_view", object: DOC_PAYROLL },
    ],
  });
  const list = await toolCall("list_permissions", { relation: "can_view", object_type: "document" });
  return {
    label,
    plan: check.results[0].allowed,
    payroll: check.results[1].allowed,
    objects: list.objects,
  };
}

// ------------------------------------------------------------------- main --

let failures = 0;
const expect = (label, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
};

const { delegated, userToken, agent, userId } = await setup();

console.log(`Authorizer: ${BASE}`);
console.log(`\n== Setup ==`);
console.log(`  user  ${userId}  -> can view q4-plan AND payroll`);
console.log(`  agent ${agent.client_id}  -> trusted with q4-plan ONLY`);
console.log(`  documents: ${DOC_PLAN}, ${DOC_PAYROLL}`);

// --emit-config <path>: write an MCP client config (the shape `claude
// --mcp-config` and Claude Desktop both accept) plus the document ids, so a
// REAL model can be pointed at this with no copy-paste.
if (process.argv.includes("--emit-config")) {
  const out = process.argv[process.argv.indexOf("--emit-config") + 1];
  if (!out) throw new Error("--emit-config needs a path");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    out,
    JSON.stringify(
      {
        mcpServers: {
          "authorizer-agent": {
            type: "http",
            url: MCP_RESOURCE,
            headers: { Authorization: `Bearer ${delegated}` },
          },
        },
      },
      null,
      2
    )
  );
  console.log(`\nWrote MCP config to ${out}`);
  console.log(JSON.stringify({ docPlan: DOC_PLAN, docPayroll: DOC_PAYROLL, userId, agentClientId: agent.client_id }));
} else if (!process.argv.includes("--verify")) {
  console.log(`\n== Register the agent's MCP server with Claude Code ==\n`);
  console.log(`claude mcp add --transport http authorizer-agent ${MCP_RESOURCE} \\`);
  console.log(`  --header "Authorization: Bearer ${delegated}"\n`);
  console.log(`Then ask the agent, in plain language:`);
  console.log(`  "Can you view ${DOC_PLAN}?"       -> the tool answers allowed`);
  console.log(`  "Can you view ${DOC_PAYROLL}?"   -> the tool answers DENIED`);
  console.log(`\nThe second one is the whole point: the delegating user CAN see that`);
  console.log(`document. The agent was never granted it, so the agent cannot — no`);
  console.log(`matter how the question is phrased, because the answer is decided`);
  console.log(`server-side from the token, not from the conversation.`);
  console.log(`\nThe token expires in 5 minutes; re-run this script to mint a fresh one.`);
  console.log(`Run with --verify to prove all of the above without a model in the loop.`);
} else {
  console.log(`\n== Driving the real MCP server over HTTP (delegated token) ==`);
  const asAgent = await driveMcp(delegated, "delegated");
  expect("check_permissions q4-plan -> allowed", asAgent.plan, true);
  expect("check_permissions payroll -> DENIED", asAgent.payroll, false);
  expect("list_permissions includes q4-plan", asAgent.objects.includes(DOC_PLAN), true);
  expect("list_permissions EXCLUDES payroll", asAgent.objects.includes(DOC_PAYROLL), false);

  // The audience boundary, from the client side. Alice's ordinary login token
  // authenticates /graphql perfectly well (the control below uses it), and it
  // opens nothing here — a token is valid at exactly the one surface its `aud`
  // names. This is why the delegated token above had to name `${BASE}/mcp` as
  // its resource rather than `${BASE}`.
  console.log(`\n== The user's ordinary login token cannot open /mcp ==`);
  let refused = false;
  try {
    await mcpRpc(userToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "with-agent-permissions", version: "1.0" },
    });
  } catch {
    refused = true;
  }
  expect("a login token is refused at /mcp", refused, true);

  // Control: same tuples, same permission API, no agent in the loop. Run over
  // GraphQL precisely BECAUSE the token above is not accepted at /mcp — the
  // point being proven is that the agent's presence changes the answer, not
  // that the transport does.
  console.log(`\n== Control: the same check as the USER, over /graphql ==`);
  const userSeesPlan = await check(userToken, DOC_PLAN);
  const userSeesPayroll = await check(userToken, DOC_PAYROLL);
  expect("check_permissions q4-plan -> allowed", userSeesPlan, true);
  expect("check_permissions payroll -> allowed (the user CAN see it)", userSeesPayroll, true);

  console.log(
    failures === 0
      ? `\nSame user, same tuples, same tools. The ONLY difference is that the agent\n` +
          `is in the loop — and payroll went from allowed to denied.`
      : `\n${failures} assertion(s) FAILED.`
  );
}

process.exit(failures === 0 ? 0 : 1);
