// Shared helpers for the FGA demo scripts. Node 18+, no dependencies.

export const BASE = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
export const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "admin";
// GraphQL POSTs are origin-checked even server-to-server; must be allow-listed.
export const ORIGIN = process.env.AUTHORIZER_ORIGIN ?? BASE;

export const PASSWORD = "FgaDemo@12345";
export const PERSONAS = ["alice", "bob", "sam", "carol", "dave", "erin"];
export const emailFor = (name) => `${name}@fga-demo.example.com`;

export async function gql(query, variables = undefined, headers = {}) {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

export const adminGql = (q, v) => gql(q, v, { "x-authorizer-admin-secret": ADMIN_SECRET });

// Login as a persona; sign up on first run. If the email exists with a
// different password (shared dev database), delete and recreate it.
export async function loginOrSignup(name) {
  const email = emailFor(name);
  const login = () =>
    gql(`mutation ($p: LoginRequest!) { login(params: $p) { access_token user { id } } }`, {
      p: { email, password: PASSWORD },
    }).then((d) => d.login);
  const signup = () =>
    gql(`mutation ($p: SignUpRequest!) { signup(params: $p) { access_token user { id } } }`, {
      p: { email, password: PASSWORD, confirm_password: PASSWORD },
    }).then((d) => d.signup);

  try {
    return await login();
  } catch {}
  try {
    return await signup();
  } catch {}
  await adminGql(`mutation ($p: DeleteUserRequest!) { _delete_user(params: $p) { message } }`, {
    p: { email },
  });
  return signup();
}

// check_permissions as the calling persona (subject pinned to their own token).
export async function check(token, relation, object) {
  const d = await gql(
    `query ($p: CheckPermissionsInput!) {
      check_permissions(params: $p) { results { allowed relation object } }
    }`,
    { p: { checks: [{ relation, object }] } },
    { Authorization: `Bearer ${token}` }
  );
  return d.check_permissions.results[0].allowed;
}

// check_permissions as super-admin for an EXPLICIT subject (e.g. a
// service_account) — only super-admins may evaluate a subject other than
// their own token's.
export async function adminCheck(subject, relation, object) {
  const d = await adminGql(
    `query ($p: CheckPermissionsInput!) {
      check_permissions(params: $p) { results { allowed } }
    }`,
    { p: { user: subject, checks: [{ relation, object }] } }
  );
  return d.check_permissions.results[0].allowed;
}
