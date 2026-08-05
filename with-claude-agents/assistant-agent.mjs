#!/usr/bin/env node
// The DevOps assistant: a real Claude Agent SDK agent the user chats with.
//
// When the user asks it to restart or scale a service, Claude decides (via
// tool use, not scripted branching) to call the `deploy_action` tool. That
// tool is where the identity/delegation/authorization stack happens:
//
//   1. The assistant authenticates itself (client_credentials) -> its own
//      machine token (the RFC 8693 `actor_token`).
//   2. It exchanges the user's session token for a short-lived, resource-
//      bound, scope-attenuated token (RFC 8693 delegation + RFC 8707
//      resource binding) — the token says "assistant, acting for this user".
//   3. It calls the infra agent (a SEPARATE process) over HTTP with that
//      delegated token. The infra agent — not this one — makes the actual
//      permission decision.
//
// Requirements: Authorizer running (`make dev`), ANTHROPIC_API_KEY set,
// AUTHORIZER_URL / ASSISTANT_CLIENT_ID / ASSISTANT_CLIENT_SECRET from
// `node setup.mjs`, and the infra agent running (`npm run infra`).

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const INFRA_AGENT_URL = process.env.INFRA_AGENT_URL ?? "http://localhost:4041/deploy";
const CLIENT_ID = process.env.ASSISTANT_CLIENT_ID;
const CLIENT_SECRET = process.env.ASSISTANT_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set ASSISTANT_CLIENT_ID / ASSISTANT_CLIENT_SECRET — see `node setup.mjs`.");
  process.exit(1);
}

// Kept in sync with the same constants in setup.mjs.
const DEMO_EMAIL = "devops-demo@example.com";
const DEMO_PASSWORD = "DevOps@Demo123";
const DEMO_SCOPES = ["openid", "email", "profile", "infra:read", "infra:write"];

const TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token";

async function gqlRaw(query, variables, headers = {}) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: AUTHORIZER_URL, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  // getSetCookie() (Node 18.14+) is required here: the Fetch spec normally
  // folds repeated response headers into one comma-joined string, which
  // corrupts multiple Set-Cookie values — this method is the one exception.
  const cookies = res.headers.getSetCookie();
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return { data: body.data, cookies };
}

// Authorizer's MFA is enabled-but-optional by default: a first-time signup or
// login withholds the access_token behind an "offer to set up MFA" gate
// instead of issuing it. skip_mfa_setup declines that offer and issues the
// token that was withheld — the intended fast path for a script that isn't
// doing interactive MFA enrollment.
async function withMfaSkip({ data, cookies }, email, mutationField) {
  const token = data[mutationField].access_token;
  if (token) return token;
  if (!cookies.length) throw new Error(`${mutationField} returned neither a token nor an MFA session cookie`);
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
  const skip = await gqlRaw(
    `mutation ($p: SkipMfaSetupRequest!) { skip_mfa_setup(params: $p) { access_token } }`,
    { p: { email } },
    { Cookie: cookieHeader }
  );
  return skip.data.skip_mfa_setup.access_token;
}

// The user's own session token — this NEVER leaves this process except
// wrapped inside a delegated, attenuated, resource-bound token (see below).
async function getUserToken() {
  const fields = "{ access_token }";
  let resp, mutationField;
  try {
    resp = await gqlRaw(`mutation ($p: LoginRequest!) { login(params: $p) ${fields} }`, {
      p: { email: DEMO_EMAIL, password: DEMO_PASSWORD, scope: DEMO_SCOPES },
    });
    mutationField = "login";
  } catch {
    resp = await gqlRaw(`mutation ($p: SignUpRequest!) { signup(params: $p) ${fields} }`, {
      p: { email: DEMO_EMAIL, password: DEMO_PASSWORD, confirm_password: DEMO_PASSWORD, scope: DEMO_SCOPES },
    });
    mutationField = "signup";
  }
  return withMfaSkip(resp, DEMO_EMAIL, mutationField);
}

async function oauthToken(params) {
  const res = await fetch(`${AUTHORIZER_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: AUTHORIZER_URL },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  return { status: res.status, body };
}

const userToken = await getUserToken();
console.log(`[assistant] signed in as ${DEMO_EMAIL}`);

// The deploy_action tool — this is the ONLY thing the assistant's Claude
// loop can do that touches infrastructure, and every call re-derives a fresh
// delegated token (5-minute TTL; nothing long-lived is cached).
const deployAction = tool(
  "deploy_action",
  "Restart or scale a service in a given environment (staging or prod). " +
    "Always call this instead of claiming an action succeeded on your own.",
  {
    action: z.enum(["restart", "scale"]),
    service: z.string().describe("Service name, e.g. 'payments'"),
    environment: z.enum(["staging", "prod"]),
    replicas: z.number().int().positive().optional().describe("Only for action=scale"),
  },
  async ({ action, service, environment, replicas }) => {
    // 1. The assistant's own machine identity (RFC 6749 client_credentials).
    const cc = await oauthToken({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    if (cc.status !== 200) {
      return { content: [{ type: "text", text: `Could not authenticate as the assistant: ${JSON.stringify(cc.body)}` }] };
    }

    // 2. RFC 8693 delegation: exchange the user's token for one bound to the
    // infra agent (RFC 8707 `resource`), attenuated to infra:write only.
    const xchg = await oauthToken({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      subject_token: userToken,
      subject_token_type: TOKEN_TYPE_ACCESS,
      actor_token: cc.body.access_token,
      actor_token_type: TOKEN_TYPE_ACCESS,
      resource: INFRA_AGENT_URL,
      scope: "infra:write",
    });
    if (xchg.status !== 200) {
      return { content: [{ type: "text", text: `Delegation denied: ${JSON.stringify(xchg.body)}` }] };
    }

    // 3. Call the infra agent — a separate process — with the delegated token.
    const res = await fetch(INFRA_AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${xchg.body.access_token}` },
      body: JSON.stringify({ action, service, environment, replicas }),
    });
    const result = await res.json();
    return { content: [{ type: "text", text: JSON.stringify({ http_status: res.status, ...result }, null, 2) }] };
  }
);

const devopsTools = createSdkMcpServer({ name: "devops", tools: [deployAction] });

const SYSTEM_PROMPT =
  "You are a DevOps assistant. When the user asks to restart or scale a service, " +
  "call the deploy_action tool — never claim an action succeeded without calling it. " +
  "If the tool reports a permission or authorization error, explain plainly that the " +
  "user lacks permission for that environment; don't retry or suggest workarounds.";

const rl = readline.createInterface({ input: stdin, output: stdout });
console.log("DevOps assistant ready. Try: \"restart payments in staging\", then \"restart payments in prod\".");
console.log("(Ctrl+C to quit)\n");

// ponytail: one-shot query() per line, no cross-turn memory — each DevOps
// command here is self-contained, so conversation history isn't needed.
for (;;) {
  const line = await rl.question("You: ");
  if (!line.trim()) continue;
  stdout.write("Assistant: ");
  for await (const message of query({
    prompt: line,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { devops: devopsTools },
      allowedTools: ["mcp__devops__deploy_action"],
    },
  })) {
    // query() yields the full Claude Agent SDK event stream; the turn's
    // actual model output arrives as `assistant` messages wrapping a
    // regular Messages-API response (`message.message.content` blocks).
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) {
      if (block.type === "text") stdout.write(block.text);
      else if (block.type === "tool_use") console.log(`\n  [calling ${block.name}(${JSON.stringify(block.input)})]`);
    }
  }
  console.log("\n");
}
