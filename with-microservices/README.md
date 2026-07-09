# Authorizer + Microservices: service-to-service auth

A realistic three-service topology where [Authorizer](https://authorizer.dev) is the
single identity authority for **both** kinds of principals:

- **Users** authenticate with Authorizer (login/signup/OAuth) and present their JWT
  to the public gateway.
- **Services** are `service_account` clients in Authorizer's
  [client registry](https://docs.authorizer.dev/core/client-registry) and mint their
  own short-lived machine tokens with the OAuth2 `client_credentials` grant
  (RFC 6749 §4.4) at `POST /oauth/token`.

Node.js only — `express` for the servers, [`jose`](https://github.com/panva/jose)
(pinned) for JWT verification, built-in `fetch` for everything else. No hand-rolled
crypto.

## Architecture

```
                          PUBLIC ZONE          │            INTERNAL ZONE
                                               │
 ┌──────────┐   user JWT   ┌───────────────┐   │   gateway machine token   ┌────────────────┐
 │ end user │ ───────────▶ │    gateway    │ ──┼─────────────────────────▶ │ orders-service │
 │ (browser │  Bearer ...  │    :4000      │   │   scope: orders:write     │     :4001      │
 │  or app) │              │               │   │   + X-User-Id header      │                │
 └──────────┘              │ verifies user │   │                           │ verifies       │
      │                    │ JWT via JWKS  │   │                           │ machine JWT    │
      │ login /            └───────┬───────┘   │                           └───────┬────────┘
      │ signup                     │           │                                   │
      ▼                            │           │        orders machine token       │
 ┌────────────────────────┐        │           │        scope: billing:charge      │
 │       Authorizer       │        │           │                                   ▼
 │         :8080          │ ◀──────┘           │                           ┌────────────────┐
 │                        │  GET /.well-known/ │                           │ billing-service│
 │  /oauth/token          │      jwks.json     │                           │     :4002      │
 │  (client_credentials)  │ ◀─────────────────────────────────────────────│                │
 │  /.well-known/jwks.json│   POST /oauth/token (form-encoded)             │ verifies       │
 │  /graphql (admin API)  │                    │                           │ machine JWT    │
 └────────────────────────┘                    │                           └────────────────┘
```

**Trust boundaries**

1. **Edge (public → gateway).** Anything past this line requires a *user* JWT the
   gateway has verified locally: signature against Authorizer's JWKS, plus `iss`
   and `aud` claims. No network round-trip to Authorizer per request.
2. **Internal mesh (gateway → orders → billing).** User tokens never cross this
   line. Every internal hop is authenticated by the *calling service's own*
   machine token, verified the same way plus two machine-specific checks:
   `login_method === "service_account"` and the required scope in the `scope`
   claim. User context travels as `X-User-Id` / `X-User-Email` headers, which
   services accept **only** alongside a valid machine token.
3. **Authorizer itself.** The only holder of the signing private key and the
   admin secret. Services hold nothing but their own `client_id`/`client_secret`.

**Why each service gets its own identity and scope ceiling**

Each service is registered with a distinct `allowed_scopes` allow-list — its
*authorization ceiling*. A `client_credentials` request for any scope outside the
ceiling fails with `invalid_scope`; there is no silent downgrade.

| Service | `allowed_scopes` (ceiling) | Can therefore reach |
|---|---|---|
| `example-gateway` | `orders:read`, `orders:write` | orders-service only |
| `example-orders-service` | `billing:charge` | billing-service charges only |
| `example-billing-service` | `billing:refund` (reserved) | nothing yet |

The payoff is blast-radius containment, provable per token: if orders-service is
compromised, the attacker holds credentials that can mint **only**
`billing:charge` tokens — they cannot read orders, cannot refund, and cannot
impersonate the gateway. The demo proves both failure modes end-to-end: billing
rejects a gateway token (`403 insufficient scope`), and Authorizer refuses to even
mint `billing:refund` for the orders identity (`400 invalid_scope`). Shared
"internal API key" setups can't express either property.

## What the tokens look like

Claims verified by the services (all confirmed against the server source):

| Claim | User token | Machine token |
|---|---|---|
| `iss` | Authorizer URL **as seen by the token request** | same |
| `aud` | the instance's global `--client-id` | same — *not* the service's own `client_id` |
| `sub` | user ID | the service account's internal `id` (a UUID) |
| `scope` | **JSON array** of strings | **JSON array** — e.g. `["billing:charge"]` |
| `login_method` | login method (e.g. `basic_auth`) | always `service_account` |

Two easy-to-miss details, handled in [`lib/auth.js`](./lib/auth.js):

- **`scope` is an array**, not the space-delimited string OAuth responses use.
- **The issuer pitfall:** Authorizer derives `iss` from the incoming request's
  host. If users get tokens via `http://localhost:8080` but a service verifies
  with `EXPECTED_ISSUER=http://authorizer:8080`, verification fails with
  `ERR_JWT_CLAIM_VALIDATION_FAILED (iss)`. Keep every party on one URL (the
  docker-compose file does), or set `EXPECTED_ISSUER` explicitly.

Machine tokens carry no `id_token` and no `refresh_token` — services simply
re-authenticate on expiry (`lib/auth.js` caches until 30s before `exp`).

## Run it (local, against `make dev`)

Prereqs: Node ≥ 20.12, and an Authorizer server from `main`:

```bash
# in the authorizer server repo
make dev   # SQLite + dev RSA keys on :8080, admin secret "admin"
```

Then, in this folder:

```bash
npm install

# 1. Register the three service_account clients (admin GraphQL,
#    x-authorizer-admin-secret header) and write .env with the credentials.
#    Secrets are returned exactly once by the API — .env is their only copy.
AUTHORIZER_ADMIN_SECRET=admin node setup.js

# 2. Start the services (three terminals, or background them)
npm run start:billing &
npm run start:orders &
npm run start:gateway &

# 3. End-to-end demo: signup user → order → charge → negative scope checks
npm run demo
```

Expected demo output (abridged):

```
1) signing up demo user demo.user+...@example.com
2) POST /api/orders (user token)
   201 { id: 'ord_1', ..., status: 'charged', charge_id: 'ch_1' }
3) GET /api/orders (user token)  200 [...]
4) GET /api/orders without token -> 401 (expect 401)
5) gateway token vs billing /charges -> 403 (expect 403)
6) orders requests billing:refund -> 400 invalid_scope (expect 400 invalid_scope)
All checks passed.
```

## Run it (docker-compose)

```bash
docker compose up -d authorizer gateway orders billing
docker compose run --rm setup                    # registers clients, writes .env
docker compose restart gateway orders billing    # pick up the new .env
docker compose exec gateway node scripts/demo.js # run from INSIDE the network
```

The `authorizer` image is a **placeholder** — build it from `main` first
(`make build-local-image` in the server repo) and match the image name in
[`docker-compose.yml`](./docker-compose.yml). The demo must run inside the
network so the user token's `iss` is `http://authorizer:8080` like everyone
else's (see the issuer pitfall above).

## Files

```
setup.js                    registers 3 service_account clients via admin GraphQL, writes .env
lib/auth.js                 JWKS verify (jose), scope middleware, cached client_credentials fetcher
gateway/server.js           public edge: verifies USER JWTs, calls orders with its machine token
orders-service/server.js    verifies gateway's machine token, charges via billing with its own
billing-service/server.js   verifies orders' machine token + billing:charge scope
scripts/demo.js             end-to-end proof incl. negative scope tests
docker-compose.yml          whole topology on one network
```

All secrets in this example (`admin`, the dev client id, `.env.example` values)
are development placeholders — never deploy them.
