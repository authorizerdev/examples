// Shared helpers for the FGA demo scripts. Node 18+, no dependencies.

export const BASE = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
export const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "admin";
// GraphQL POSTs are origin-checked even server-to-server; must be allow-listed.
export const ORIGIN = process.env.AUTHORIZER_ORIGIN ?? BASE;

export const PASSWORD = "FgaDemo@12345";
export const PERSONAS = ["alice", "bob", "sam", "carol", "dave", "erin"];
export const emailFor = (name) => `${name}@fga-demo.example.com`;

// Returns { data, setCookies } — setCookies carries the MFA session cookie
// that skip_mfa_setup needs (see settleMfaOffer).
export async function gqlFull(query, variables = undefined, headers = {}) {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return { data: body.data, setCookies: res.headers.getSetCookie() };
}

export const gql = (q, v, h) => gqlFull(q, v, h).then((r) => r.data);

export const adminGql = (q, v) => gql(q, v, { "x-authorizer-admin-secret": ADMIN_SECRET });

// Since 2.4.0 MFA is on by default, so signup/login enrol nothing but OFFER an
// MFA setup: no access token, and the message "Proceed to mfa setup", until the
// user either enrols a factor or explicitly declines. These demos are about
// authorization, not enrollment, so they decline — that is what skip_mfa_setup
// is for. The call is identified by the MFA session cookie the previous
// response set, plus the email. Under --enforce-mfa declining is refused and
// the user must enrol instead.
async function settleMfaOffer(auth, setCookies, email) {
  if (auth?.access_token) return auth;
  const { data } = await gqlFull(
    `mutation ($p: SkipMfaSetupRequest!) { skip_mfa_setup(params: $p) { access_token user { id } } }`,
    { p: { email } },
    { Cookie: setCookies.map((c) => c.split(";")[0]).join("; ") }
  );
  return data.skip_mfa_setup;
}

// Login as a persona; sign up on first run. If the email exists with a
// different password (shared dev database), delete and recreate it.
export async function loginOrSignup(name) {
  const email = emailFor(name);
  const login = async () => {
    const { data, setCookies } = await gqlFull(
      `mutation ($p: LoginRequest!) { login(params: $p) { access_token user { id } } }`,
      { p: { email, password: PASSWORD } }
    );
    return settleMfaOffer(data.login, setCookies, email);
  };
  const signup = async () => {
    const { data, setCookies } = await gqlFull(
      `mutation ($p: SignUpRequest!) { signup(params: $p) { access_token user { id } } }`,
      { p: { email, password: PASSWORD, confirm_password: PASSWORD } }
    );
    return settleMfaOffer(data.signup, setCookies, email);
  };

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
