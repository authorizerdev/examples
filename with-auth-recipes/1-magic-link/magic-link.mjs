// Magic link login, end to end:
// 1. `magic_link_login` mutation → server emails a verification link
// 2. read the email from Mailpit's API, pull the token out of the link
// 3. `verify_email` mutation with the token → access_token (the session)
// 4. `profile` query with the token → proves the session works
import {
  gql,
  clearMailbox,
  waitForEmail,
  extractVerificationToken,
  randomEmail,
} from '../lib/common.mjs';

const email = process.env.EMAIL ?? randomEmail('magic');

await clearMailbox();

// 1. Request the magic link. Response is intentionally generic so callers
// can't probe whether an account exists.
const { data: req } = await gql(
  `mutation ($params: MagicLinkLoginRequest!) {
    magic_link_login(params: $params) { message }
  }`,
  { params: { email } }
);
console.log('magic_link_login:', req.magic_link_login.message);

// 2. Fetch the email and extract the token from the /verify_email link.
const message = await waitForEmail(email);
console.log('email received:', JSON.stringify(message.Subject));
const token = extractVerificationToken(message);
console.log('token (first 40 chars):', token.slice(0, 40), '...');

// 3. Exchange the token for a session. (Clicking the link in the email does
// the same thing via GET /verify_email, then redirects to redirect_uri.)
const { data: verified } = await gql(
  `mutation ($params: VerifyEmailRequest!) {
    verify_email(params: $params) {
      message
      access_token
      expires_in
      user { id email signup_methods email_verified }
    }
  }`,
  { params: { token } }
);
const auth = verified.verify_email;
console.log('verify_email:', auth.message);
console.log('user:', auth.user);

// 4. Prove the session: authenticated profile query.
const { data: me } = await gql(
  `query { profile { id email signup_methods } }`,
  {},
  { Authorization: `Bearer ${auth.access_token}` }
);
console.log('profile (authenticated):', me.profile);

if (me.profile.email !== email) throw new Error('profile email mismatch');
console.log('\nOK: magic link flow complete —', email, 'is logged in.');
