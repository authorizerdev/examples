# Authorizer + Go Microservices (service-to-service auth)

Production-grade example of securing a Go microservice fleet with
[Authorizer](https://authorizer.dev) and the
[authorizer-go](https://github.com/authorizerdev/authorizer-go) SDK:

- End users authenticate at the **gateway** with Authorizer-issued JWTs.
- Services authenticate to **each other** with OAuth2 `client_credentials`
  machine tokens, minted via the Go SDK and scoped per service.
- Every service verifies tokens locally against Authorizer's **JWKS** — no
  network call to the auth server on the request hot path.

## Architecture

```
                        internet │ trust boundary: internal network
                                 │
 user (JWT from Authorizer)      │
        │                        │
        ▼                        │
  ┌───────────┐  machine token   │   ┌───────────┐  machine token  ┌───────────┐
  │  gateway  │  (orders:read,   │   │  orders   │ (billing:charge)│  billing  │
  │   :4100   │──orders:write)──────▶│   :4101   │────────────────▶│   :4102   │
  └───────────┘                  │   └───────────┘                 └───────────┘
        │                        │         │                             │
        │ verifies USER JWTs     │         │ verifies MACHINE JWTs       │ verifies MACHINE JWTs
        │ (login_method !=       │         │ (login_method ==            │ requires billing:charge
        │  service_account)      │         │  service_account,           │
        ▼                        │         ▼  orders:* scopes)           ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │            Authorizer :8080  —  /oauth/token, /.well-known/jwks.json     │
  └──────────────────────────────────────────────────────────────────────────┘
```

**Trust boundaries**

- The gateway is the only public service. It never forwards the user's token
  downstream — the verified user identity travels as `X-User-ID` metadata
  while the gateway authenticates itself with its own machine token. Internal
  services therefore never need to reason about user tokens.
- Internal services accept only `login_method=service_account` tokens, so a
  stolen user JWT is useless against them (demo step: user token at orders
  → 403).
- Scopes are least-privilege per hop: the gateway can only call orders
  (`orders:read orders:write`), orders can only charge billing
  (`billing:charge`). The gateway's token at billing → `403
  insufficient_scope`; orders asking for a scope above its ceiling →
  `invalid_scope` from the token endpoint. Ceilings are enforced
  server-side by each client's `allowed_scopes`.

**Token caching (`internal/authx/token_source.go`)**

Each service holds one long-lived `TokenSource` per downstream dependency.
It mints a `client_credentials` token via the SDK
(`GetToken` + `GrantTypeClientCredentials`), caches it, and refreshes 60s
before expiry. Minting per request would put the auth server on every
request's critical path and turn it into a single point of latency/failure;
with caching the auth server is touched roughly once per token lifetime
(30 min by default).

**JWT verification (`internal/authx/middleware.go`, `jwks.go`)**

`golang-jwt/jwt/v5` + a small JWKS cache (RSA keys built from the JWKS `n`/`e`
with the stdlib). Every service validates: RS256 signature, `iss` (the
Authorizer URL), `aud` (the deployment client ID), `exp`, `token_type`,
`login_method`, and required scopes. Note: Authorizer emits the `scope` claim
as a **JSON array** on machine tokens (space-delimited strings are also
accepted for compatibility), and signs tokens without a `kid` header — the
JWKS cache falls back to the single published key.

## Quickstart

Requirements: Go 1.25+, `curl`, `python3`, a running Authorizer.

```bash
# 1. Start Authorizer (from the authorizer repo) — dev defaults: admin secret
#    "admin", client ID kbyuFDidLLm280LIwVFiazOqjO3ty8KH
make dev

# 2. Register the three service-account clients and write .env
./setup.sh                       # uses AUTHORIZER_ADMIN_SECRET (default: admin)

# 3. Run the services (three terminals, or background them)
set -a; source .env; set +a
go build -o bin/ ./cmd/...
./bin/billing &
./bin/orders &
./bin/gateway &

# 4. Drive the whole flow: signup → order → cross-service charge + negative paths
./demo.sh
```

`demo.sh` output ends with `Result: 5 passed, 0 failed`:

1. user signup via Authorizer GraphQL
2. gateway verifies the user JWT via JWKS (`GET /api/me`)
3. `POST /api/orders` → gateway → orders → billing charge
4. gateway machine token at billing → **403 insufficient_scope**
5. orders client requesting a scope above its `allowed_scopes` ceiling →
   **invalid_scope**

## Layout

```
cmd/gateway/     public API  (:4100) — user JWT auth, calls orders
cmd/orders/      internal    (:4101) — machine auth, calls billing
cmd/billing/     internal    (:4102) — machine auth, requires billing:charge
internal/authx/  shared: JWKS cache, JWT middleware, client_credentials
                 TokenSource, slog request logging, graceful shutdown
setup.sh         registers service-account clients (admin GraphQL) → .env
demo.sh          end-to-end happy path + negative paths
```

All services use structured JSON logging (`log/slog`) with a propagated
`X-Request-ID`, context propagation on outbound calls, and graceful shutdown
on SIGINT/SIGTERM.
