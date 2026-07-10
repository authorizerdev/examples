# Authorizer Example with Go

Signup, login and profile with the [Go SDK](https://github.com/authorizerdev/authorizer-go) (release `2.1.0`) over the GraphQL protocol, plus the admin client listing users.

## Run an Authorizer instance

```bash
git clone https://github.com/authorizerdev/authorizer.git
cd authorizer
make dev   # http://localhost:8080, admin secret: admin
```

## Run the example

```bash
go run .
```

Defaults match `make dev`; override with `AUTHORIZER_URL`, `CLIENT_ID`, `ADMIN_SECRET` env vars.

## Notes

- The SDK release is tagged `2.1.0` (no `v` prefix), so Go resolves it as the pseudo-version `v0.0.0-20260616165143-dc16e71b66f7` you see in `go.mod` — same code, exact commit of the release tag.
- The client supports three wire protocols: `graphql` (default, used here), `rest`, and `grpc` (`authorizer.WithProtocol`).
- Admin operations (`admin.Users`, etc.) authenticate with the `x-authorizer-admin-secret` header, handled by `NewAuthorizerAdminClient`.
- **Do not use `GetToken` in `2.1.0`** — it is a non-functional stub in that release (fixed on the SDK's unreleased `main`). Get tokens via `Login`, or call `POST /oauth/token` directly for machine flows (see the `with-m2m-client-credentials` example).
