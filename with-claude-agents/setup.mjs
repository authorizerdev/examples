#!/usr/bin/env node
// One-time admin setup for the DevOps agent-to-agent demo:
//   1. Install an OpenFGA model: users are `admin` of an `environment`, and
//      `admin` implies `can_deploy`.
//   2. Sign up (or log in) the demo user.
//   3. Grant the demo user `admin` on environment:staging ONLY — not prod.
//      That's what makes the "denied in prod" path happen naturally later,
//      instead of being special-cased in code.
//   4. Register the assistant as an Authorizer service-account client.
//
// Usage:
//   AUTHORIZER_URL=http://localhost:8080 ADMIN_SECRET=admin node setup.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "admin";

// Kept in sync with the same constants in assistant-agent.mjs (no shared
// module — each script here is meant to be read standalone).
const DEMO_EMAIL = "devops-demo@example.com";
const DEMO_PASSWORD = "DevOps@Demo123";
const DEMO_SCOPES = ["openid", "email", "profile", "infra:read", "infra:write"];

const dsl = `model
  schema 1.1

type user

type environment
  relations
    define admin: [user]
    define can_deploy: admin`;

async function gqlRaw(query, variables, headers = {}) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    // CSRF guard: state-changing requests need an Origin (or Referer) header.
    headers: { "Content-Type": "application/json", Origin: AUTHORIZER_URL, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  // getSetCookie() (Node 18.14+) is required here: the Fetch spec normally
  // folds repeated response headers into one comma-joined string, which
  // corrupts multiple Set-Cookie values — this method is the one exception.
  const cookies = res.headers.getSetCookie();
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return { data, cookies };
}

const gql = (q, v, h) => gqlRaw(q, v, h).then((r) => r.data);
const adminGql = (q, v) => gql(q, v, { "x-authorizer-admin-secret": ADMIN_SECRET });

// Authorizer's MFA is enabled-but-optional by default: a first-time signup or
// login withholds the access_token behind an "offer to set up MFA" gate
// (message: "Proceed to mfa setup") and sets a short-lived mfa_session
// cookie instead. skip_mfa_setup declines the offer and issues the token
// that was withheld — the intended fast path for API/script clients that
// aren't doing interactive MFA enrollment.
async function withMfaSkip({ data, cookies }, email, mutationField) {
  const result = data[mutationField];
  if (result.access_token) return result;
  if (!cookies.length) throw new Error(`${mutationField} returned neither a token nor an MFA session cookie`);
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
  const skip = await gql(
    `mutation ($p: SkipMfaSetupRequest!) { skip_mfa_setup(params: $p) { access_token user { id email } } }`,
    { p: { email } },
    { Cookie: cookieHeader }
  );
  return skip.skip_mfa_setup;
}

// Sign up (or log in, if the account already exists from a prior run), then
// transparently skip the optional MFA offer if one comes back.
async function signupOrLogin(email, password, scope) {
  const fields = "{ access_token user { id email } }";
  let resp, mutationField;
  try {
    resp = await gqlRaw(`mutation ($p: SignUpRequest!) { signup(params: $p) ${fields} }`, {
      p: { email, password, confirm_password: password, scope },
    });
    mutationField = "signup";
  } catch {
    resp = await gqlRaw(`mutation ($p: LoginRequest!) { login(params: $p) ${fields} }`, {
      p: { email, password, scope },
    });
    mutationField = "login";
  }
  return withMfaSkip(resp, email, mutationField);
}

async function main() {
  console.log(`Authorizer: ${AUTHORIZER_URL}\n`);

  // 1. Authorization model.
  const model = await adminGql(
    `mutation ($params: FgaWriteModelInput!) { _fga_write_model(params: $params) { id } }`,
    { params: { dsl } }
  );
  console.log(`[1/4] FGA model installed (id: ${model._fga_write_model.id})`);

  // 2. Demo user (idempotent: log in if it already exists from a prior run).
  const auth = await signupOrLogin(DEMO_EMAIL, DEMO_PASSWORD, DEMO_SCOPES);
  console.log(`[2/4] demo user ready: ${auth.user.email} (id: ${auth.user.id})`);

  // 3. Grant: demo user is admin of staging only.
  await adminGql(`mutation ($p: FgaWriteTuplesInput!) { _fga_write_tuples(params: $p) { message } }`, {
    p: { tuples: [{ user: `user:${auth.user.id}`, relation: "admin", object: "environment:staging" }] },
  });
  console.log("[3/4] tuple written: demo user is admin of environment:staging (NOT prod)");

  // 4. Register the assistant agent's service account.
  const created = await adminGql(
    `mutation ($params: CreateClientRequest!) {
      _create_client(params: $params) { client { client_id } client_secret }
    }`,
    { params: { name: `devops-assistant-${Date.now()}`, allowed_scopes: ["openid", "infra:read", "infra:write"] } }
  );
  const { client_id } = created._create_client.client;
  const client_secret = created._create_client.client_secret;
  console.log(`[4/4] assistant client registered: ${client_id}`);

  console.log("\nExport these before running the assistant (client_secret is shown once):\n");
  console.log(`  export AUTHORIZER_URL="${AUTHORIZER_URL}"`);
  console.log(`  export ASSISTANT_CLIENT_ID="${client_id}"`);
  console.log(`  export ASSISTANT_CLIENT_SECRET="${client_secret}"`);
  console.log("\nThen, in two separate terminals:\n");
  console.log("  npm run infra       # starts the infra agent (resource server), :4041");
  console.log("  npm run assistant   # starts the chat with the DevOps assistant");
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
});
