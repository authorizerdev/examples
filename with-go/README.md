# Authorizer Example with Go

Signup, login and profile with the [Go SDK](https://github.com/authorizerdev/authorizer-go) (release `v2.2.0-rc.4`) over the GraphQL protocol, plus the admin client listing users.

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

- The SDK is v2+, so the module path carries the `/v2` suffix: import `github.com/authorizerdev/authorizer-go/v2` and require `github.com/authorizerdev/authorizer-go/v2 v2.2.0-rc.4` in `go.mod`.
- The client supports three wire protocols: `graphql` (default, used here), `rest`, and `grpc` (`authorizer.WithProtocol`).
- Admin operations (`admin.Users`, etc.) authenticate with the `x-authorizer-admin-secret` header, handled by `NewAuthorizerAdminClient`.
- `GetToken` is functional in `v2.2.0-rc.4` (including `client_credentials`); you can also get tokens via `Login`, or call `POST /oauth/token` directly for machine flows (see the `with-m2m-client-credentials` example).
