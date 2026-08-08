#!/usr/bin/env node
// FGA in action:
//   1. Two users sign up (alice, bob).
//   2. Your backend (admin credential) grants access by writing tuples:
//      alice owns document:1, bob may only view it.
//   3. Each user asks, with their OWN token, what they may do:
//      check_permissions / list_permissions.
//
// Usage:
//   AUTHORIZER_URL=http://localhost:8080 ADMIN_SECRET=admin node demo.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'admin';

// A token-withheld MFA offer is identified by a session cookie, and Node's
// fetch has no cookie jar — so carry the cookie across requests by hand.
let cookie = '';

const gql = async (query, variables, headers = {}) => {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: 'POST',
    // CSRF guard: POST /graphql needs an Origin (or Referer) header.
    headers: {
      'Content-Type': 'application/json',
      Origin: AUTHORIZER_URL,
      ...(cookie && { Cookie: cookie }),
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  const mfa = res.headers.getSetCookie().find((c) => c.startsWith('mfa_session='));
  if (mfa) cookie = mfa.split(';')[0];
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors[0].message);
  return data;
};

// --- 1. Users ---------------------------------------------------------------
const signupOrLogin = async (email) => {
  const password = 'Fga-demo-pass-1!';
  const fields = '{ access_token user { id email } }';
  let auth;
  try {
    const d = await gql(
      `mutation ($p: SignUpRequest!) { signup(params: $p) ${fields} }`,
      { p: { email, password, confirm_password: password } },
    );
    auth = d.signup;
  } catch {
    const d = await gql(
      `mutation ($p: LoginRequest!) { login(params: $p) ${fields} }`,
      { p: { email, password } },
    );
    auth = d.login;
  }

  // Since 2.4.0 MFA is ON by default, so signup/login OFFER an MFA setup and
  // WITHHOLD the access token ("Proceed to mfa setup") until the user either
  // enrols a factor or explicitly declines. This demo declines, which is what
  // skip_mfa_setup is for: it records the refusal and releases the withheld
  // token. Identification is by the MFA session cookie set above plus the
  // email, so it must run on the same client. Fails under --enforce-mfa, where
  // declining is not permitted; a real app would drive the setup screen.
  if (!auth.access_token) {
    const d = await gql(
      `mutation ($p: SkipMfaSetupRequest!) { skip_mfa_setup(params: $p) ${fields} }`,
      { p: { email } },
    );
    auth = d.skip_mfa_setup;
  }
  return auth;
};

const alice = await signupOrLogin('fga-alice@example.com');
const bob = await signupOrLogin('fga-bob@example.com');
console.log('alice:', alice.user.id);
console.log('bob  :', bob.user.id);

// --- 2. Grant access (admin writes tuples) ----------------------------------
// Subjects are "user:<authorizer user id>" — the token's `sub` claim.
try {
  await gql(
    `mutation ($p: FgaWriteTuplesInput!) { _fga_write_tuples(params: $p) { message } }`,
    {
      p: {
        tuples: [
          { user: `user:${alice.user.id}`, relation: 'owner', object: 'document:1' },
          { user: `user:${bob.user.id}`, relation: 'viewer', object: 'document:1' },
        ],
      },
    },
    { 'x-authorizer-admin-secret': ADMIN_SECRET },
  );
  console.log('tuples written: alice owner of document:1, bob viewer of document:1');
} catch (err) {
  // Writing a tuple that already exists is an error, not a no-op, so a second
  // run of this demo would fail here. The grant from the first run still
  // stands, which is all the checks below need.
  if (!/already exist/i.test(err.message)) throw err;
  console.log('tuples already present from an earlier run, reusing them');
}

// --- 3. Check access as each user (their own bearer token) ------------------
const checkQuery = `query ($p: CheckPermissionsInput!) {
  check_permissions(params: $p) { results { relation object allowed } }
}`;
const checks = {
  checks: [
    { relation: 'can_view', object: 'document:1' },
    { relation: 'can_edit', object: 'document:1' },
    { relation: 'can_delete', object: 'document:1' },
  ],
};

for (const [name, who] of [['alice', alice], ['bob', bob]]) {
  const d = await gql(checkQuery, { p: checks }, { Authorization: `Bearer ${who.access_token}` });
  console.log(`\ncheck_permissions as ${name}:`);
  for (const r of d.check_permissions.results) {
    console.log(`  ${r.relation} ${r.object} -> ${r.allowed}`);
  }
}

// list_permissions: "which documents can bob view?"
const d = await gql(
  `query ($p: ListPermissionsInput!) {
    list_permissions(params: $p) { objects truncated }
  }`,
  { p: { relation: 'can_view', object_type: 'document' } },
  { Authorization: `Bearer ${bob.access_token}` },
);
console.log('\nlist_permissions as bob (can_view documents):', d.list_permissions.objects);
