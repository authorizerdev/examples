// Agent-to-agent delegation demo (RFC 8693 token exchange, delegation profile).
//
// Story: a user asks an orchestrator agent to "summarize my CRM pipeline and
// export it". The orchestrator farms the work out to tool agents. Each hand-off
// is a token exchange: the downstream agent receives a short-lived token that
// still says sub = the user, carries the full actor chain in the nested `act`
// claim, and can only ever LOSE scopes (attenuation), never gain them.
//
// Chain built here (the deepest the server supports, maxActChainDepth = 4):
//
//   user ──> orchestrator ──> research-agent ──> crm-reader ──> export-agent
//              (hop 1)           (hop 2)           (hop 3)        (hop 4)
//
// Then three rejections are demonstrated:
//   1. a 5th hop (archiver)          -> chain depth > 4
//   2. mailer re-widening mail:send  -> empty scope after attenuation
//   3. actor_token of another agent  -> actor binding violation
//
// Requirements: Node 18+ (built-in fetch), a running Authorizer (make dev).
// No npm dependencies.

const BASE = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "admin";
// GraphQL POSTs are origin-checked even server-to-server; must be allow-listed.
const ORIGIN = process.env.AUTHORIZER_ORIGIN ?? BASE;

const USER_EMAIL = "delegation-demo@example.com";
const USER_PASSWORD = "Delegation@Demo123";
const USER_SCOPES = ["openid", "email", "profile", "crm:read", "crm:write", "mail:send"];

const TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token";
const GRANT_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

// Each agent is an OAuth client (service account). allowed_scopes is its
// delegation CEILING: a token it mints can never carry more than this.
const AGENTS = [
  { key: "orchestrator", scopes: USER_SCOPES }, // trusted front-line agent
  { key: "research-agent", scopes: ["openid", "crm:read", "crm:write"] },
  { key: "crm-reader", scopes: ["openid", "crm:read"] },
  { key: "export-agent", scopes: ["openid", "crm:read"] },
  { key: "archiver", scopes: ["openid", "crm:read"] }, // used for the depth-5 rejection
  { key: "mailer", scopes: ["mail:send"] }, // used for the attenuation rejection
];

// ---------------------------------------------------------------- helpers --

async function gql(query, variables = undefined, headers = {}) {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

const adminGql = (q, v) => gql(q, v, { "x-authorizer-admin-secret": ADMIN_SECRET });

// POST /oauth/token (form-encoded). Returns { status, body } — negative cases
// are part of the demo, so non-200 is data, not an exception.
async function oauthToken(params) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: await res.json() };
}

const decodeJwt = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// Render the nested act claim outermost-first: "export-agent -> crm-reader -> ...".
function actChain(act, nameByClientId) {
  const hops = [];
  for (let cur = act; cur; cur = cur.act) hops.push(nameByClientId.get(cur.sub) ?? cur.sub);
  return hops.join(" -> ");
}

function printDelegated(label, tokenResponse, nameByClientId) {
  const c = decodeJwt(tokenResponse.access_token);
  console.log(`\n${label}`);
  console.log(`  sub (unchanged user): ${c.sub}`);
  console.log(`  act chain (who acted, outermost first): ${actChain(c.act, nameByClientId)}`);
  console.log(`  act claim: ${JSON.stringify(c.act)}`);
  console.log(`  scope: [${c.scope.join(", ")}]`);
  console.log(`  aud (resource-bound): ${c.aud}`);
  console.log(`  expires_in: ${tokenResponse.expires_in}s (short-lived by design)`);
}

// One delegation hop: `agent` exchanges `subjectToken` for an attenuated,
// resource-bound token. actor_token is the agent's OWN machine token — that is
// how the server proves who the immediate actor is.
function exchange(agent, subjectToken, resource, scope = undefined) {
  return oauthToken({
    grant_type: GRANT_TOKEN_EXCHANGE,
    client_id: agent.client_id,
    client_secret: agent.client_secret,
    subject_token: subjectToken,
    subject_token_type: TOKEN_TYPE_ACCESS,
    actor_token: agent.machine_token,
    actor_token_type: TOKEN_TYPE_ACCESS,
    resource,
    ...(scope ? { scope } : {}),
  });
}

function expectRejection(label, { status, body }) {
  if (status === 200) throw new Error(`${label}: expected a rejection but got a token!`);
  console.log(`\n${label}`);
  console.log(`  HTTP ${status} ${body.error}: ${body.error_description}`);
}

// Login as the demo user; sign up on first run. If the email exists with a
// different password (a shared dev database), delete and recreate it.
async function getUserToken() {
  const login = () =>
    gql(`mutation ($params: LoginRequest!) { login(params: $params) { access_token } }`, {
      params: { email: USER_EMAIL, password: USER_PASSWORD, scope: USER_SCOPES },
    }).then((d) => d.login.access_token);
  const signup = () =>
    gql(`mutation ($params: SignUpRequest!) { signup(params: $params) { access_token } }`, {
      params: { email: USER_EMAIL, password: USER_PASSWORD, confirm_password: USER_PASSWORD, scope: USER_SCOPES },
    }).then((d) => d.signup.access_token);

  try {
    return await login();
  } catch {}
  try {
    return await signup();
  } catch {}
  await adminGql(`mutation ($params: DeleteUserRequest!) { _delete_user(params: $params) { message } }`, {
    params: { email: USER_EMAIL },
  });
  return signup();
}

// ------------------------------------------------------------------- main --

async function main() {
  console.log(`Authorizer: ${BASE}\n`);

  // 1. Register the agents (admin op). Each returns its client_secret exactly once.
  console.log("== Setup: registering agent service accounts ==");
  const runId = Date.now(); // unique names so re-runs don't collide
  for (const agent of AGENTS) {
    const data = await adminGql(
      `mutation ($params: CreateClientRequest!) {
        _create_client(params: $params) { client { id client_id allowed_scopes } client_secret }
      }`,
      { params: { name: `${agent.key}-${runId}`, allowed_scopes: agent.scopes } }
    );
    agent.id = data._create_client.client.id;
    agent.client_id = data._create_client.client.client_id;
    agent.client_secret = data._create_client.client_secret;
    console.log(`  ${agent.key}: ceiling [${agent.scopes.join(", ")}]`);
  }
  const nameByClientId = new Map(AGENTS.map((a) => [a.client_id, a.key]));

  try {
    // 2. A user signs in (sign up on first run) with the full scope set.
    const userToken = await getUserToken();
    console.log(`\n== User token ==\n  sub: ${decodeJwt(userToken).sub}`);
    console.log(`  scope: [${decodeJwt(userToken).scope.join(", ")}]  (no act claim: nobody is acting for the user yet)`);

    // 3. Each agent authenticates itself: client_credentials -> machine token.
    //    Note: the scope claim in machine tokens is a JSON array, not a string.
    for (const agent of AGENTS) {
      const { status, body } = await oauthToken({
        grant_type: "client_credentials",
        client_id: agent.client_id,
        client_secret: agent.client_secret,
      });
      if (status !== 200) throw new Error(`client_credentials failed for ${agent.key}: ${JSON.stringify(body)}`);
      agent.machine_token = body.access_token;
    }
    console.log("\n== Machine tokens issued (client_credentials) for all agents ==");

    // 4. The delegation chain. Watch three things at each hop:
    //    sub never changes, the act chain grows, the scope only shrinks.
    console.log("\n==================== DELEGATION CHAIN ====================");

    const [orchestrator, research, crmReader, exportAgent, archiver, mailer] = AGENTS;

    // Hop 1: user -> orchestrator. Full user scope fits under its ceiling.
    let hop1 = await exchange(orchestrator, userToken, "https://api.internal/orchestrator");
    printDelegated("Hop 1: orchestrator acts for the user", hop1.body, nameByClientId);

    // Hop 2: orchestrator -> research-agent. The DELEGATED token is the
    // subject_token now (re-delegation): ceiling drops email/profile/mail:send.
    let hop2 = await exchange(research, hop1.body.access_token, "https://crm.internal/api");
    printDelegated("Hop 2: research-agent re-delegated by orchestrator (scope attenuated)", hop2.body, nameByClientId);

    // Hop 3: research-agent -> crm-reader, and the agent itself asks for less
    // than it could get (scope param): crm:write is dropped two ways.
    let hop3 = await exchange(crmReader, hop2.body.access_token, "https://crm.internal/api/read", "openid crm:read");
    printDelegated("Hop 3: crm-reader (requested scope narrowed to read-only)", hop3.body, nameByClientId);

    // Hop 4: crm-reader -> export-agent. Depth 4 = the server's maximum.
    let hop4 = await exchange(exportAgent, hop3.body.access_token, "https://export.internal/api");
    printDelegated("Hop 4: export-agent (maximum chain depth reached)", hop4.body, nameByClientId);

    // 5. Negative cases — every one of these is the server failing CLOSED.
    console.log("\n==================== REJECTIONS ====================");

    // 5a. A 5th hop: act chain would be depth 5 > maxActChainDepth (4).
    expectRejection(
      "5th hop rejected (archiver tries to extend the chain past depth 4)",
      await exchange(archiver, hop4.body.access_token, "https://archive.internal/api")
    );

    // 5b. Attenuation is monotonic: the user originally granted mail:send, but
    // it was dropped at hop 2. mailer (ceiling [mail:send]) cannot get it back
    // from hop 3's token — the intersection is empty.
    expectRejection(
      "mailer rejected (cannot re-widen to mail:send from an already-narrowed token)",
      await exchange(mailer, hop3.body.access_token, "https://mail.internal/api")
    );

    // 5c. Actor binding: mailer authenticates as itself but presents the
    // ORCHESTRATOR's machine token as actor_token. A valid-but-unrelated token
    // must not stand in as the actor.
    expectRejection(
      "actor_token of another agent rejected (actor binding)",
      await oauthToken({
        grant_type: GRANT_TOKEN_EXCHANGE,
        client_id: mailer.client_id,
        client_secret: mailer.client_secret,
        subject_token: userToken,
        subject_token_type: TOKEN_TYPE_ACCESS,
        actor_token: orchestrator.machine_token, // not mailer's own!
        actor_token_type: TOKEN_TYPE_ACCESS,
        resource: "https://mail.internal/api",
      })
    );

    console.log("\nDone. Full chain minted and all three invariant violations rejected.");
  } finally {
    // 6. Cleanup: remove the demo clients so re-runs don't accumulate.
    for (const agent of AGENTS) {
      if (!agent.id) continue;
      await adminGql(
        `mutation ($params: ClientRequest!) { _delete_client(params: $params) { message } }`,
        { params: { id: agent.id } }
      ).catch(() => {});
    }
    console.log("\n(cleanup: demo agent clients deleted)");
  }
}

main().catch((err) => {
  console.error(`\nDemo failed: ${err.message}`);
  process.exit(1);
});
