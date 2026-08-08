// Agent permissions demo: an agent's authority is perms(agent) ∩ perms(user).
//
// Story: Alice can read two documents — the Q4 plan and payroll. She hands a
// calendar agent a delegated token so it can help with the Q4 plan. The agent
// must be able to reach the Q4 plan and must NOT be able to reach payroll,
// even though Alice can, and even though it is holding Alice's delegation.
//
// That is the Confused Deputy problem, and the intersection is the fix:
//
//     effective authority = perms(agent) ∩ perms(user)
//
// evaluated per action, at request time, on both check_permissions and
// list_permissions.
//
// Demonstrated here:
//   1. agent + user both granted        -> allowed
//   2. user granted, agent NOT          -> DENIED  (Confused Deputy blocked)
//   3. agent granted, user NOT          -> DENIED  (agent cannot exceed Alice)
//   4. a second agent with no grants    -> denied everything
//   5. enumeration intersects too       -> payroll never appears in a listing
//   6. an explicit `user` cannot shed the agent half
//   7. revoking one agent leaves Alice and the other agent untouched
//   8. the opt-in: with no `type agent` in the model, none of this applies
//
// Requirements: Node 18+ (built-in fetch), a running Authorizer with FGA
// (make dev — FGA is on by default with SQLite). No npm dependencies.

const BASE = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "admin";
// GraphQL POSTs are origin-checked even server-to-server; must be allow-listed.
const ORIGIN = process.env.AUTHORIZER_ORIGIN ?? BASE;

const USER_EMAIL = "agent-perms-demo@example.com";
const USER_PASSWORD = "AgentPerms@Demo123";
const USER_SCOPES = ["openid", "email", "profile"];

const TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token";
const GRANT_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

// Unique per run so re-runs never collide with tuples an earlier run left
// behind — OpenFGA rejects writing a tuple that already exists.
const runId = Date.now();
const DOC_PLAN = `document:q4-plan-${runId}`;
const DOC_PAYROLL = `document:payroll-${runId}`;
const DOC_ROADMAP = `document:roadmap-${runId}`;

// Declaring `type agent` IS the opt-in — there is no flag. The feature is
// meaningless without a model that can express agent grants, and checking
// `agent:x` against a model with no agent type ERRORS in OpenFGA rather than
// returning false, so a flag switched on against an unprepared model would deny
// every delegated request. Auto-detection makes that state unreachable.
const MODEL_WITH_AGENT = `model
  schema 1.1
type user
type agent
type document
  relations
    define viewer: [user, agent]
    define can_view: viewer
`;

// The same model WITHOUT the agent type: the "operator has not opted in" state,
// used by the final section.
const MODEL_WITHOUT_AGENT = `model
  schema 1.1
type user
type document
  relations
    define viewer: [user]
    define can_view: viewer
`;

const AGENTS = [
  { key: "calendar-agent", scopes: USER_SCOPES },
  { key: "finance-agent", scopes: USER_SCOPES },
];

// ---------------------------------------------------------------- helpers --

// Returns { data, setCookies } — setCookies carries the MFA session cookie
// that skip_mfa_setup needs (see getUserToken).
async function gqlFull(query, variables = undefined, headers = {}) {
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

// Turn Set-Cookie response headers into a Cookie request header value.
const cookieHeader = (setCookies) => setCookies.map((c) => c.split(";")[0]).join("; ");

const adminGql = (q, v) => gql(q, v, { "x-authorizer-admin-secret": ADMIN_SECRET });

async function oauthToken(params) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: await res.json() };
}

const decodeJwt = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

const writeTuples = (tuples) =>
  adminGql(`mutation ($params: FgaWriteTuplesInput!) { _fga_write_tuples(params: $params) { message } }`, {
    params: { tuples },
  });

const deleteTuples = (tuples) =>
  adminGql(`mutation ($params: FgaWriteTuplesInput!) { _fga_delete_tuples(params: $params) { message } }`, {
    params: { tuples },
  });

const writeModel = (dsl) =>
  adminGql(`mutation ($params: FgaWriteModelInput!) { _fga_write_model(params: $params) { id } }`, {
    params: { dsl },
  });

// check_permissions AS the given bearer token. An `explicitUser` is passed
// straight through so section 6 can prove it changes nothing.
async function check(token, object, explicitUser = undefined) {
  const data = await gql(
    `query ($params: CheckPermissionsInput!) {
      check_permissions(params: $params) { results { relation object allowed } }
    }`,
    { params: { checks: [{ relation: "can_view", object }], ...(explicitUser ? { user: explicitUser } : {}) } },
    { Authorization: `Bearer ${token}` }
  );
  return data.check_permissions.results[0].allowed;
}

async function listVisible(token) {
  const data = await gql(
    `query ($params: ListPermissionsInput!) { list_permissions(params: $params) { objects } }`,
    { params: { relation: "can_view", object_type: "document" } },
    { Authorization: `Bearer ${token}` }
  );
  return data.list_permissions.objects;
}

// Assert-and-report. Every line of this demo's output is a claim about the
// server's behaviour, so a wrong one must fail the run rather than print.
let failures = 0;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)})`}`);
}

// Since 2.4.0 MFA is on by default, so signup/login enrol nothing but OFFER an
// MFA setup: no access token, and the message "Proceed to mfa setup", until the
// user either enrols a factor or explicitly declines. This demo is about
// authorization, not enrollment, so it declines — that is what skip_mfa_setup
// is for. The call is identified by the MFA session cookie the previous
// response set, plus the email. Under --enforce-mfa declining is refused and
// the user must enrol instead.
async function settleMfaOffer(auth, setCookies) {
  if (auth?.access_token) return auth.access_token;
  const { data } = await gqlFull(
    `mutation ($params: SkipMfaSetupRequest!) { skip_mfa_setup(params: $params) { access_token } }`,
    { params: { email: USER_EMAIL } },
    { Cookie: cookieHeader(setCookies) }
  );
  return data.skip_mfa_setup.access_token;
}

async function getUserToken() {
  const login = async () => {
    const { data, setCookies } = await gqlFull(
      `mutation ($params: LoginRequest!) { login(params: $params) { access_token } }`,
      { params: { email: USER_EMAIL, password: USER_PASSWORD, scope: USER_SCOPES } }
    );
    return settleMfaOffer(data.login, setCookies);
  };
  const signup = async () => {
    const { data, setCookies } = await gqlFull(
      `mutation ($params: SignUpRequest!) { signup(params: $params) { access_token } }`,
      {
        params: {
          email: USER_EMAIL,
          password: USER_PASSWORD,
          confirm_password: USER_PASSWORD,
          scope: USER_SCOPES,
        },
      }
    );
    return settleMfaOffer(data.signup, setCookies);
  };

  try {
    return await login();
  } catch {}
  try {
    return await signup();
  } catch {}
  // _delete_user takes an id, not an email: a phone-only signup has no email,
  // so email was never an identifier every account has. Look the id up first.
  const { _user: stale } = await adminGql(
    `query ($params: GetUserRequest!) { _user(params: $params) { id } }`,
    { params: { email: USER_EMAIL } }
  );
  await adminGql(`mutation ($params: DeleteUserRequest!) { _delete_user(params: $params) { message } }`, {
    params: { id: stale.id },
  });
  return signup();
}

// Mint a delegated token for `agent` acting for the user.
//
// NOTE the resource: to call AUTHORIZER's own API the token must name
// Authorizer as its RFC 8707 resource. A token exchanged for
// https://some-other-service.example is bound there and will not authenticate
// here — that binding is the whole point, not an obstacle.
async function delegateToAuthorizer(agent, userToken) {
  const { status, body } = await oauthToken({
    grant_type: GRANT_TOKEN_EXCHANGE,
    client_id: agent.client_id,
    client_secret: agent.client_secret,
    subject_token: userToken,
    subject_token_type: TOKEN_TYPE_ACCESS,
    actor_token: agent.machine_token,
    actor_token_type: TOKEN_TYPE_ACCESS,
    resource: BASE,
  });
  if (status !== 200) throw new Error(`exchange failed for ${agent.key}: ${JSON.stringify(body)}`);
  return body.access_token;
}

// ------------------------------------------------------------------- main --

async function main() {
  console.log(`Authorizer: ${BASE}\n`);

  console.log("== Setup: authorization model (declaring `type agent` IS the opt-in) ==");
  await writeModel(MODEL_WITH_AGENT);
  console.log("  type user / type agent / type document(viewer: [user, agent])");

  console.log("\n== Setup: registering agent service accounts ==");
  for (const agent of AGENTS) {
    const data = await adminGql(
      `mutation ($params: CreateClientRequest!) {
        _create_client(params: $params) { client { id client_id } client_secret }
      }`,
      { params: { name: `${agent.key}-${runId}`, allowed_scopes: agent.scopes } }
    );
    agent.client_id = data._create_client.client.client_id;
    agent.client_secret = data._create_client.client_secret;

    const { status, body } = await oauthToken({
      grant_type: "client_credentials",
      client_id: agent.client_id,
      client_secret: agent.client_secret,
    });
    if (status !== 200) throw new Error(`client_credentials failed for ${agent.key}: ${JSON.stringify(body)}`);
    agent.machine_token = body.access_token;
    console.log(`  ${agent.key}: ${agent.client_id}`);
  }
  const [calendarAgent, financeAgent] = AGENTS;

  const userToken = await getUserToken();
  const userId = decodeJwt(userToken).sub;
  console.log(`\n== Alice signs in ==\n  sub: ${userId}`);

  // Alice can read the Q4 plan and payroll. She cannot read the roadmap.
  await writeTuples([
    { user: `user:${userId}`, relation: "viewer", object: DOC_PLAN },
    { user: `user:${userId}`, relation: "viewer", object: DOC_PAYROLL },
  ]);
  // The calendar agent is trusted with the Q4 plan and the roadmap — NOT payroll.
  await writeTuples([
    { user: `agent:${calendarAgent.client_id}`, relation: "viewer", object: DOC_PLAN },
    { user: `agent:${calendarAgent.client_id}`, relation: "viewer", object: DOC_ROADMAP },
  ]);
  console.log(`\n== Grants ==`);
  console.log(`  Alice          -> q4-plan, payroll`);
  console.log(`  calendar-agent -> q4-plan, roadmap`);
  console.log(`  finance-agent  -> (nothing)`);

  const delegated = await delegateToAuthorizer(calendarAgent, userToken);
  const claims = decodeJwt(delegated);
  console.log(`\n== Delegated token (calendar-agent acting for Alice) ==`);
  console.log(`  sub (still Alice):   ${claims.sub}`);
  console.log(`  act.sub (the agent): ${claims.act.sub}`);
  console.log(`  aud (this server):   ${claims.aud}`);

  console.log(`\n== 1-3. The intersection, one row per case ==`);
  expect("q4-plan  — agent YES, Alice YES -> allowed", await check(delegated, DOC_PLAN), true);
  expect("payroll  — agent NO,  Alice YES -> DENIED (Confused Deputy blocked)", await check(delegated, DOC_PAYROLL), false);
  expect("roadmap  — agent YES, Alice NO  -> DENIED (agent cannot exceed Alice)", await check(delegated, DOC_ROADMAP), false);

  console.log(`\n  For contrast, Alice's OWN token is unaffected by any of this:`);
  expect("payroll  — Alice herself -> allowed", await check(userToken, DOC_PAYROLL), true);

  console.log(`\n== 4. A second agent, granted nothing ==`);
  const financeDelegated = await delegateToAuthorizer(financeAgent, userToken);
  expect("q4-plan  — finance-agent holds no grant -> denied", await check(financeDelegated, DOC_PLAN), false);
  expect("payroll  — finance-agent holds no grant -> denied", await check(financeDelegated, DOC_PAYROLL), false);

  console.log(`\n== 5. Enumeration intersects too ==`);
  const agentSees = await listVisible(delegated);
  const aliceSees = await listVisible(userToken);
  // Asserted per-document rather than as whole-list equality: a real store has
  // other tuples in it, and this demo's claim is about THESE documents.
  expect("Alice enumerates q4-plan", aliceSees.includes(DOC_PLAN), true);
  expect("Alice enumerates payroll", aliceSees.includes(DOC_PAYROLL), true);
  expect("the agent enumerates q4-plan", agentSees.includes(DOC_PLAN), true);
  expect("the agent does NOT enumerate payroll", agentSees.includes(DOC_PAYROLL), false);
  console.log(`     Without this an agent could not ACT on payroll yet would still SEE it`);
  console.log(`     listed, leaking Alice's resource names.`);

  console.log(`\n== 6. An explicit \`user\` cannot shed the agent half ==`);
  expect("payroll with user: \"user:<alice>\" -> still denied", await check(delegated, DOC_PAYROLL, `user:${userId}`), false);
  expect("payroll with user: \"<alice>\" (bare id) -> still denied", await check(delegated, DOC_PAYROLL, userId), false);
  console.log(`     The gate is on WHO the caller is, never on what they typed.`);

  console.log(`\n== 7. Revoking one agent touches nothing else ==`);
  await deleteTuples([{ user: `agent:${calendarAgent.client_id}`, relation: "viewer", object: DOC_PLAN }]);
  expect("calendar-agent -> q4-plan is now denied", await check(delegated, DOC_PLAN), false);
  expect("Alice -> q4-plan still allowed", await check(userToken, DOC_PLAN), true);

  console.log(`\n== 8. The opt-in: a model with no \`type agent\` ==`);
  // Tuples survive a model rewrite — only the schema changed, so Alice keeps
  // her payroll grant and the agent keeps the tuples it still has. The ONLY
  // difference is that the model can no longer express an agent subject.
  await writeModel(MODEL_WITHOUT_AGENT);
  expect(
    "payroll — the agent now inherits Alice's FULL authority -> allowed",
    await check(delegated, DOC_PAYROLL),
    true
  );
  console.log(`     This is the documented compatibility path, not a bug: deployments that`);
  console.log(`     have not opted in keep their existing behaviour byte-for-byte. It is`);
  console.log(`     counted as authorizer_fga_delegated_checks_total{outcome="not_enforced"}`);
  console.log(`     so you can alert on agent traffic arriving unconstrained.`);

  // Leave the store as we found it for the next run.
  await writeModel(MODEL_WITH_AGENT);

  console.log(
    failures === 0
      ? `\nAll assertions held. Effective authority is perms(agent) ∩ perms(user).`
      : `\n${failures} assertion(s) FAILED — the server did not behave as documented.`
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nDemo failed: ${err.message}`);
  process.exit(1);
});
