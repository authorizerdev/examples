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
//                                 stdio and assert the intersection holds
//
// `--verify` is the part worth reading: it speaks the same JSON-RPC an MCP host
// speaks, so a green run means a real host will see exactly this.
//
// Requirements: Node 18+, and the server started by ./run-server.sh (the MCP
// subcommand is a separate process that needs the same database and JWT flags,
// which that script keeps short).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Override to build a specific checkout, e.g. a release worktree. Must be the
// same checkout run-server.sh started: `authorizer mcp` is a second process
// against the same database, not a client of the running one.
const SERVER_DIR = process.env.AUTHORIZER_SERVER_DIR ?? path.resolve(HERE, "../../authorizer");
const DB_PATH = path.join(HERE, ".agent-demo.db");
// A DELEGATED TOKEN LIVES 5 MINUTES. `go run` recompiles the whole server on
// every spawn, which can eat most of that window before the first tool call —
// the token then fails validation and the failure looks like a permissions bug
// rather than an expiry. Build once, spawn the binary.
const BIN_PATH = path.join(HERE, ".agent-demo-bin");

const BASE = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "admin";
const ORIGIN = process.env.AUTHORIZER_ORIGIN ?? BASE;

// Must match run-server.sh — `authorizer mcp` validates the bearer itself.
const JWT_SECRET = process.env.AUTHORIZER_JWT_SECRET ?? "insecure-local-agent-demo-secret";
const ENCRYPTION_KEY = process.env.AUTHORIZER_ENCRYPTION_KEY ?? "insecure-local-agent-demo-encryption-key";
const CLIENT_ID = "kbyuFDidLLm280LIwVFiazOqjO3ty8KH";
const CLIENT_SECRET = "60Op4HFM0I8ajz0WdiStAbziZ-VFQttXuxixHHs2R7r7-CW8GR79l-mmLqMhc-Sa";

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

  // The delegated token names AUTHORIZER as its RFC 8707 resource, which is
  // what lets it authenticate at Authorizer's own API (and therefore at the
  // MCP tools, which dispatch to it).
  const delegated = await oauth({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: agent.client_id,
    client_secret: agent.client_secret,
    subject_token: userToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    actor_token: machine.body.access_token,
    actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
    resource: BASE,
  });
  if (delegated.status !== 200) throw new Error(`token exchange: ${JSON.stringify(delegated.body)}`);

  return { delegated: delegated.body.access_token, userToken, agent, userId };
}

// The flags `authorizer mcp` needs. It is a standalone process that opens the
// database directly and validates the bearer itself, so it needs the same
// database + JWT settings as the server that minted the token.
function mcpArgs(bearer) {
  return [
    "mcp",
    "--database-type=sqlite",
    `--database-url=${DB_PATH}`,
    "--jwt-type=HS256",
    `--jwt-secret=${JWT_SECRET}`,
    "--admin-secret=" + ADMIN_SECRET,
    `--encryption-key=${ENCRYPTION_KEY}`,
    `--client-id=${CLIENT_ID}`,
    `--client-secret=${CLIENT_SECRET}`,
    `--url=${BASE}`,
    `--mcp-bearer=${bearer}`,
  ];
}

// ------------------------------------------------------- the MCP stdio probe --

// Speaks the same JSON-RPC an MCP host speaks, over the same stdio transport.
async function driveMcp(bearer, label) {
  const child = spawn(BIN_PATH, mcpArgs(bearer), {
    cwd: SERVER_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;

  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // the server also logs non-JSON lines
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });

  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
      setTimeout(() => pending.has(id) && reject(new Error(`timeout on ${method}`)), 60000);
    });

  try {
    await call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "with-agent-permissions", version: "1.0" },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const toolCall = async (name, args) => {
      const res = await call("tools/call", { name, arguments: args });
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
  } finally {
    child.kill();
  }
}

// Builds the server binary once. Spawning `go run` per MCP process would
// recompile every time and burn the delegated token's short TTL.
function buildBinary() {
  return new Promise((resolve, reject) => {
    const b = spawn("go", ["build", "-o", BIN_PATH, "."], { cwd: SERVER_DIR, stdio: "inherit" });
    b.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`go build exited ${code}`))));
  });
}

// ------------------------------------------------------------------- main --

let failures = 0;
const expect = (label, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
};

// Build BEFORE minting, so the delegated token starts its 5-minute life with
// the slow part already done.
if (process.argv.includes("--verify")) await buildBinary();

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
      { mcpServers: { "authorizer-agent": { command: BIN_PATH, args: mcpArgs(delegated) } } },
      null,
      2
    )
  );
  console.log(`\nWrote MCP config to ${out}`);
  console.log(JSON.stringify({ docPlan: DOC_PLAN, docPayroll: DOC_PAYROLL, userId, agentClientId: agent.client_id }));
} else if (!process.argv.includes("--verify")) {
  console.log(`\n== Register the agent's MCP server with Claude Code ==\n`);
  console.log(`claude mcp add authorizer-agent -- \\`);
  console.log(`  ${BIN_PATH} ${mcpArgs(delegated).join(" \\\n  ")}\n`);
  console.log(`(build it first: cd ${SERVER_DIR} && go build -o ${BIN_PATH} .)\n`);
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
  console.log(`\n== Driving the real MCP server over stdio (delegated token) ==`);
  const asAgent = await driveMcp(delegated, "delegated");
  expect("check_permissions q4-plan -> allowed", asAgent.plan, true);
  expect("check_permissions payroll -> DENIED", asAgent.payroll, false);
  expect("list_permissions includes q4-plan", asAgent.objects.includes(DOC_PLAN), true);
  expect("list_permissions EXCLUDES payroll", asAgent.objects.includes(DOC_PAYROLL), false);

  console.log(`\n== Control: the same tools with the USER's own token ==`);
  const asUser = await driveMcp(userToken, "user");
  expect("check_permissions q4-plan -> allowed", asUser.plan, true);
  expect("check_permissions payroll -> allowed (the user CAN see it)", asUser.payroll, true);

  console.log(
    failures === 0
      ? `\nSame user, same tuples, same tools. The ONLY difference is that the agent\n` +
          `is in the loop — and payroll went from allowed to denied.`
      : `\n${failures} assertion(s) FAILED.`
  );
}

process.exit(failures === 0 ? 0 : 1);
