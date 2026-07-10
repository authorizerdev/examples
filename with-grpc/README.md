# Authorizer with gRPC (Go)

Minimal Go client for Authorizer's **gRPC API** — the third transport besides
GraphQL and REST. One binary, five live calls:

1. `Signup` (public `AuthorizerService`)
2. `Login` → access token
3. `Profile` — authenticated with `authorization: Bearer <token>` metadata
4. `Users` (admin `AuthorizerAdminService`) — authenticated with `x-authorizer-admin-secret` metadata
5. `CreateClient` — mint an OAuth service account, secret returned once

## Run

```bash
# Terminal 1 — from the authorizer server repo:
make dev          # HTTP :8080, gRPC :9091, admin secret "admin"

# Terminal 2 — from this folder:
go run .
# flags: -grpc 127.0.0.1:9091  -url http://localhost:8080  -admin-secret admin
```

## When to choose which transport

| Transport | Choose it when |
| :--- | :--- |
| **gRPC** (`:9091`) | Service-to-service calls in Go/Python/etc.; typed stubs, streaming-ready, lowest overhead. This example. |
| **REST** (`/v1/*` on `:8080`) | Anything that speaks HTTP/JSON — curl, webhooks, languages without generated stubs. Served by grpc-gateway from the *same* handlers as gRPC. |
| **GraphQL** (`/graphql` on `:8080`) | Browser apps and the official SDKs; select exactly the fields you need, one endpoint. |

All three hit the same service layer — pick per caller, mix freely.

## Authentication metadata (pure gRPC)

gRPC has no cookies; auth travels as metadata on each call:

| Metadata key | Value | Used for |
| :--- | :--- | :--- |
| `authorization` | `Bearer <access_token>` | Authenticated user RPCs (`Profile`, `UpdateProfile`, `Logout`, ...) |
| `x-authorizer-admin-secret` | The configured admin secret | All `AuthorizerAdminService` RPCs except `AdminLogin` |
| `x-authorizer-url` | Public base URL, e.g. `http://localhost:8080` | **Set on every call.** Resolves the JWT issuer; without it the server falls back to the gRPC `:authority` header, which is usually wrong. |
| `cookie` | `authorizer_session=<value>` | Alternative to bearer; required for `Session` (cookie-only) |

```go
ctx = metadata.AppendToOutgoingContext(ctx,
    "x-authorizer-url", "http://localhost:8080",
    "authorization", "Bearer "+accessToken)
```

## REST equivalence (grpc-gateway)

Every RPC maps to a `/v1/*` REST route on the HTTP port. Step 3 as curl:

```bash
TOKEN=$(curl -s http://localhost:8080/v1/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8080' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .access_token)

curl -s http://localhost:8080/v1/profile -H "Authorization: Bearer $TOKEN"
```

Note: REST **POST**s go through browser CSRF protection — send an `Origin`
header matching `--allowed-origins`. Pure gRPC calls skip this (no browser,
no CSRF).

## Ports & TLS

- gRPC listens on its own port: `--grpc-port` (default **9091**), separate from HTTP (**8080**).
- `make dev` serves plaintext gRPC — fine locally. In production terminate TLS on the gRPC listener (`--grpc-tls-cert`/`--grpc-tls-key`) and dial with `credentials.NewTLS(&tls.Config{})` instead of `insecure.NewCredentials()`. Bearer tokens must never cross an unencrypted channel outside local dev.
- Server reflection is on by default (`--enable-grpc-reflection`), so `grpcurl -plaintext localhost:9091 list` works too.

## Regenerating the stubs

`gen/authorizer/v1/` is vendored from the server repo's protos:

```bash
# from the authorizer repo's proto/ directory
buf generate --template buf.gen.clients.yaml --include-imports
# copy gen/go-client/authorizer/v1/*.go here (adjust go_package_prefix to this module)
```
