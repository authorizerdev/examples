# with-auth-recipes

Runnable scripts for the classic end-user auth recipes against a local
[Authorizer](https://authorizer.dev) server:

| Recipe | What it shows | GraphQL ops used |
| --- | --- | --- |
| [1-magic-link](./1-magic-link) | Passwordless login via emailed link | `magic_link_login`, `verify_email`, `profile` |
| [2-totp-mfa](./2-totp-mfa) | TOTP second factor: enrollment + challenged login | `signup`, `verify_email`, `login`, `verify_otp` |
| [3-webhooks](./3-webhooks) | `user.signup` webhook + HMAC signature verification | `_add_webhook`, `_webhooks`, `_delete_webhook` |
| [4-email-templates](./4-email-templates) | Custom magic-link email template | `_add_email_template`, `_email_templates`, `_delete_email_template` |

Plain Node 18+ scripts (built-in `fetch`); the only dependency is
[`otpauth`](https://www.npmjs.com/package/otpauth) for generating TOTP codes.

## Quickstart

```sh
# 1. Mailpit — local SMTP sink (SMTP :1025, web UI/API http://localhost:8025)
docker compose up -d

# 2. Authorizer dev server, configured for all four recipes
./run-server.sh            # from the authorizer repo checkout next to examples/
                           # PORT=8098 ./run-server.sh if :8080 is taken

# 3. Deps (only otpauth, for recipe 2)
npm install

# 4. Run recipes
node 1-magic-link/magic-link.mjs
node 2-totp-mfa/totp-mfa.mjs
node 3-webhooks/webhook-demo.mjs      # see its README for a one-time sudo step
node 4-email-templates/email-template.mjs
```

If the server runs on a non-default port, point the scripts at it:
`AUTHORIZER_URL=http://localhost:8098 node 1-magic-link/magic-link.mjs`.

## Why plain `make dev` isn't enough

`make dev` starts Authorizer without SMTP and with magic link / MFA disabled.
`run-server.sh` is `make dev` plus the flags these recipes need:

```
--smtp-host=localhost --smtp-port=1025 --smtp-sender-email=...  # Mailpit
--enable-email-verification                                     # emails on signup
--enable-magic-link-login                                       # recipe 1, 4
--enforce-mfa=false                                             # recipe 2
```

Since 2.4.0 MFA and TOTP are on by default, so the `--enable-mfa` and
`--enable-totp-login` flags this script used to pass no longer exist — the
opt-outs are `--disable-mfa` / `--disable-totp-login`. `--enforce-mfa=false`
is now also the default; it stays spelled out because recipe 2 depends on
enrollment being *offered* rather than *forced*, and enforcing it would
entangle the other recipes.

All secrets in `run-server.sh` (admin secret `admin`, client id/secret, JWT
secret) are throwaway dev values — never reuse them.

## How the scripts talk to the server

- GraphQL: `POST /graphql` with `Content-Type: application/json` **and an
  allow-listed `Origin` header** — the CSRF middleware rejects mutations
  without one.
- Admin (`_`-prefixed) ops: authenticated with the
  `x-authorizer-admin-secret` header (alternative: the `authorizer-admin`
  cookie from `_admin_login`).
- Emails: read back via Mailpit's REST API
  (`GET /api/v1/search?query=to:<addr>`, `GET /api/v1/message/<id>`).

Shared helpers live in [`lib/common.mjs`](./lib/common.mjs).
