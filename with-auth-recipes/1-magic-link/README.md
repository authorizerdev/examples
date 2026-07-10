# Magic link login

Passwordless login: the user gets an email with a one-time link; following it
verifies their address and starts a session. New users are created on the fly
(when signup is enabled), so this doubles as passwordless signup.

**Ops used**: `magic_link_login` → (email) → `verify_email` → `profile`

## Flow

1. `magic_link_login(params: { email })` — always returns a generic
   "if an account exists..." message (no account enumeration). The server
   emails a link of the form `{host}/verify_email?token=...&redirect_uri=...`;
   the token is valid for 30 minutes.
2. The script reads the email from Mailpit's API and extracts the token.
   A real user would just click the link (`GET /verify_email` verifies and
   redirects to `redirect_uri` with a session).
3. `verify_email(params: { token })` returns an `AuthResponse` with
   `access_token` and the user.
4. `profile` with `Authorization: Bearer <access_token>` proves the session.

## Run

```sh
node magic-link.mjs
# or against a non-default port / a specific address:
AUTHORIZER_URL=http://localhost:8098 EMAIL=you@example.com node magic-link.mjs
```

Requires: Mailpit up, server started via `../run-server.sh`
(`--enable-magic-link-login` + `--smtp-*` flags).
