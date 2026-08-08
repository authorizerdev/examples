# TOTP multi-factor authentication

Enroll a user in TOTP (authenticator-app) MFA and log in with the second
factor. Codes are generated with the [`otpauth`](https://www.npmjs.com/package/otpauth)
library using Authorizer's TOTP parameters (SHA1, 6 digits, 30s period —
compatible with Google Authenticator etc.).

**Ops used**: `signup` → (email) → `verify_email` → `verify_otp` →
`login` → `verify_otp` → `profile`

## Flow

1. `signup`. Since 2.4.0 MFA is on by default, so nothing has to be requested:
   the `is_multi_factor_auth_enabled` signup field was removed as a security
   fix (an unauthenticated caller must not decide whether MFA applies to the
   account it is creating). With `--enforce-mfa` enrollment is additionally
   mandatory — it cannot be declined with `skip_mfa_setup`. For an existing
   user the admin `_update_user` path is the only override.
2. `verify_email` with the emailed token. Because MFA + TOTP are enabled the
   response is the **enrollment challenge** instead of tokens:
   - `should_show_totp_screen: true`
   - `authenticator_secret` (base32) and `authenticator_scanner_image`
     (base64 QR for authenticator apps)
   - `authenticator_recovery_codes` (shown once)
   - a short-lived `mfa_session` cookie in `Set-Cookie`
3. `verify_otp(params: { email, otp, is_totp: true })` with that cookie
   completes enrollment and returns the first `access_token`. Recovery codes
   are accepted in place of `otp`.
4. A fresh `login` now returns `should_show_totp_screen: true` (tokens
   withheld) + a new `mfa_session` cookie; `verify_otp` again yields the
   session.

## Run

```sh
npm install        # once, in the parent folder (pulls otpauth)
node totp-mfa.mjs
```

Requires: Mailpit up, server started via `../run-server.sh`. MFA and TOTP are
on by default since 2.4.0 — the old `--enable-mfa` / `--enable-totp-login`
flags no longer exist (the opt-outs are `--disable-mfa` / `--disable-totp-login`).
