// TOTP multi-factor auth, end to end:
// 1. signup → verification email
// 2. verify_email → server starts TOTP enrollment: returns the shared secret
//    (+ QR image + recovery codes) and sets an `mfa_session` cookie
// 3. generate a code from the secret (otpauth lib) → verify_otp(is_totp) with
//    the mfa cookie → enrolled + first session
// 4. fresh login → TOTP challenge again → verify_otp → session → profile
//
// Since 2.4.0 MFA and TOTP are on by default, so nothing has to be switched on
// for this recipe (see ../run-server.sh). Signup used to opt the new user in
// with is_multi_factor_auth_enabled, but that field was removed as a security
// fix: letting an unauthenticated caller decide whether MFA applies to the
// account they are creating defeats the server's MFA-on-by-default policy.
// For an existing user the admin `_update_user` path is now the only override.
import * as OTPAuth from 'otpauth';
import {
  gql,
  clearMailbox,
  waitForEmail,
  extractVerificationToken,
  cookieHeader,
  randomEmail,
} from '../lib/common.mjs';

const email = randomEmail('totp');
const password = 'Obviously-Fake-Passw0rd!';

// Authorizer generates TOTP with pquerna/otp defaults: SHA1, 6 digits, 30s.
const totpFor = (secret) =>
  new OTPAuth.TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });

const AUTH_RESPONSE = `
  message
  access_token
  should_show_totp_screen
  authenticator_secret
  authenticator_recovery_codes
  user { id email }
`;

// 1. Sign up. MFA applies because the server has it on by default.
await clearMailbox();
const { data: signup } = await gql(
  `mutation ($params: SignUpRequest!) {
    signup(params: $params) { message }
  }`,
  { params: { email, password, confirm_password: password } }
);
console.log('signup:', signup.signup.message);

// 2. Verify the email. Because the user has MFA on and TOTP is enabled, the
// response is the TOTP enrollment: secret, QR image, recovery codes — and the
// Set-Cookie headers carry the pending mfa_session.
const token = extractVerificationToken(await waitForEmail(email));
const { data: verified, setCookies: mfaCookies1 } = await gql(
  `mutation ($params: VerifyEmailRequest!) {
    verify_email(params: $params) { ${AUTH_RESPONSE} }
  }`,
  { params: { token } }
);
const enroll = verified.verify_email;
console.log('verify_email:', enroll.message);
console.log('authenticator_secret:', enroll.authenticator_secret);
console.log('recovery codes:', enroll.authenticator_recovery_codes.length);

// 3. Complete enrollment: generate the current code and verify it.
// verify_otp requires the mfa_session cookie set in the previous step.
const { data: enrolled, setCookies: sessionCookies } = await gql(
  `mutation ($params: VerifyOTPRequest!) {
    verify_otp(params: $params) { ${AUTH_RESPONSE} }
  }`,
  { params: { email, otp: totpFor(enroll.authenticator_secret).generate(), is_totp: true } },
  { Cookie: cookieHeader(mfaCookies1) }
);
console.log('verify_otp (enrollment):', enrolled.verify_otp.message);
if (!enrolled.verify_otp.access_token) throw new Error('no access_token after enrollment');

// 4. Fresh login now challenges with TOTP instead of returning tokens.
const { data: login, setCookies: mfaCookies2 } = await gql(
  `mutation ($params: LoginRequest!) {
    login(params: $params) { ${AUTH_RESPONSE} }
  }`,
  { params: { email, password } }
);
console.log('login:', login.login.message, '| tokens withheld:', login.login.access_token === null);

const { data: mfaDone } = await gql(
  `mutation ($params: VerifyOTPRequest!) {
    verify_otp(params: $params) { ${AUTH_RESPONSE} }
  }`,
  { params: { email, otp: totpFor(enroll.authenticator_secret).generate(), is_totp: true } },
  { Cookie: cookieHeader(mfaCookies2) }
);
const session = mfaDone.verify_otp;
console.log('verify_otp (login):', session.message);

const { data: me } = await gql(
  `query { profile { id email } }`,
  {},
  { Authorization: `Bearer ${session.access_token}` }
);
console.log('profile (authenticated):', me.profile);

if (me.profile.email !== email) throw new Error('profile email mismatch');
console.log('\nOK: TOTP MFA flow complete —', email, 'enrolled and logged in with a second factor.');
