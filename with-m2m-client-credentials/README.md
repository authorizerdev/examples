# Machine-to-Machine Auth (client_credentials)

A background worker authenticates as itself — no user involved — using the OAuth2 `client_credentials` grant (RFC 6749 §4.4). Plain Node, built-in `fetch`, zero dependencies.

**Requires an Authorizer server built from `main`** (the client registry / machine-identity features are newer than the latest release):

```bash
git clone https://github.com/authorizerdev/authorizer.git
cd authorizer
make dev   # serves http://localhost:8080, admin secret: admin
```

## 1. Register the machine client (admin, once)

```bash
AUTHORIZER_URL=http://localhost:8080 ADMIN_SECRET=admin node setup.mjs
```

`setup.mjs` calls the admin GraphQL mutation `_create_client` (authenticated with the `x-authorizer-admin-secret` header) and prints the `client_id` and `client_secret`.

Three things to know about the client you just created:

- **`allowed_scopes` is the ceiling.** A token request may only ask for a subset of it; anything outside fails with `invalid_scope` — there is no silent downgrade. Omitting `scope` grants the full allowed set.
- **An empty `allowed_scopes` is deny-all.** A client with no scopes can be issued nothing; `_create_client` requires at least one non-empty scope.
- **The secret is shown exactly once** — at creation and at `_rotate_client_secret`. It is never retrievable afterwards; store it in your secret manager immediately.

## 2. Get a token and call APIs (worker)

```bash
CLIENT_ID=<from setup> CLIENT_SECRET=<from setup> node worker.mjs
```

`worker.mjs` POSTs a **form-encoded** body to `/oauth/token`:

```
grant_type=client_credentials&client_id=...&client_secret=...&scope=read:invoices
```

The response carries `access_token`, `token_type`, `expires_in` and the granted `scope` — no `refresh_token` and no `id_token` (machines simply re-authenticate on expiry). The token's `login_method` claim is `service_account`.

The secret can also be sent via HTTP Basic auth (`-u client_id:client_secret`) instead of the body.

> Placeholder values above (`admin`, the demo client id) come from `make dev`. Never use them outside local development.
