# with-spiffe — SPIFFE JWT-SVID as the client credential

A Go workload in a SPIRE trust domain authenticates to
[Authorizer](https://authorizer.dev) **without any client_secret**: it fetches
a JWT-SVID from the SPIRE agent's Workload API and presents it at
`POST /oauth/token` with `grant_type=client_credentials` and the
`jwt-spiffe` client assertion type.

> **Preview**: the jwt-spiffe profile follows `draft-ietf-oauth-spiffe-client-auth`
> (an expired individual draft); the URN
> `urn:ietf:params:oauth:client-assertion-type:jwt-spiffe` is not
> IANA-registered. Authorizer ships it as experimental.

```
┌────────────────────────── docker compose ───────────────────────────┐
│                                                                     │
│ ┌──────────────┐  node attest   ┌──────────────┐  server API sock   │
│ │ spire-agent  │◄──(join token)─│ spire-server │◄──────────────┐    │
│ └──────┬───────┘                │ jwt_issuer=  │        ┌──────┴───┐│
│        │ Workload API socket    │ https://oidc-│        │spire-oidc││
│        │ (unix, shared volume)  │ discovery.…  │        │ JWKS :9988─┼──► public URL
│        ▼                        └──────────────┘        └──────────┘│   (tunnel/domain)
│ ┌──────────────┐  1. FetchJWTSVID(aud=authorizer)                   │        │
│ │ workload     │     → JWT-SVID: iss=jwt_issuer,                    │        │
│ │ (Go,         │       sub=spiffe://demo.example/workload           │        │
│ │ authorizer-go│                                 ┌──────────────┐   │        │
│ │ SDK)         │  2. POST /oauth/token           │ authorizer   │   │        │
│ │              ├────────────────────────────────►│ (authorizer: │   │        │
│ │              │  grant_type=client_credentials  │  local)      │   │        │
│ │              │  client_assertion_type=         │              │   │        │
│ │              │    …:jwt-spiffe                 │ iss → trust  │   │        │
│ │              │  client_assertion=<JWT-SVID>    │ row → JWKS ──┼───┼────────┘
│ │              │◄────────────────────────────────┤ verify + pin │   │  (SSRF-hardened:
│ │              │  3. Authorizer access token     │ SPIFFE ID    │   │   public IPs only)
│ └──────────────┘                                 └──────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

Note `iss ≠ sub` on this path — `iss` is the SPIRE server's `jwt_issuer` (it
locates the trust row and key set), `sub` is the workload's SPIFFE ID (pinned
against `allowed_subjects`). That asymmetry is exactly why jwt-spiffe is a
distinct assertion type from jwt-bearer; the server refuses to cross the two.

## Why secretless beats client_secret here

- **Identity is attested, not distributed.** SPIRE issues the SVID only after
  node + workload attestation (here: join-token node attestation and a
  `unix:uid:0` workload selector). There is no secret to provision, copy into
  CI, or rotate.
- **Short-lived and single-use.** JWT-SVIDs default to a 5-minute TTL here,
  and Authorizer replay-caches every assertion (`jti`, or `(iss,sub,iat,exp)`)
  until expiry — a captured SVID cannot be re-presented. The workload fetches
  a **fresh** SVID per token-endpoint call.
- **Audience-bound.** The SVID is minted for `aud=<expected_aud>`; a token
  minted for any other service is rejected at Authorizer.
- **Deprovisioning = deleting the registration entry.** No credential sweep.

## Contents

| Path | What |
|------|------|
| `workload/` | Go workload: go-spiffe v2 Workload API → SDK `GetToken` with the jwt-spiffe assertion. Dockerfile included. |
| `docker-compose.yaml` | spire-server, spire-agent, spire-oidc (OIDC discovery provider / JWKS), authorizer (`authorizer:local` — substitute the next published release when it ships), workload |
| `conf/` | SPIRE server/agent/OIDC provider configs (`agent.conf` is rendered from the template by setup.sh) |
| `setup.sh` | One-shot bring-up: join token → agent, registration entry, Authorizer client + trusted issuer, workload |

## Quickstart

```bash
# 1. Expose the SPIRE JWKS publicly. Authorizer's JWKS fetcher is
#    SSRF-hardened (private/loopback IPs rejected, redirects refused), so the
#    compose-internal http://spire-oidc:8443/keys is NOT fetchable — put a
#    tunnel or public domain in front of localhost:9988 and add its hostname
#    to `domains` in conf/oidc/oidc-discovery-provider.conf (the provider
#    refuses unlisted Host headers):
ngrok http 9988   # → https://<tunnel-host>

# 2. Bring everything up:
JWKS_URL="https://<tunnel-host>/keys" ./setup.sh

# 3. Watch the exchange:
docker compose logs -f workload
# fetched JWT-SVID for spiffe://demo.example/workload
# exchanged JWT-SVID for Authorizer access token (expires_in=1800s scope="read:demo")
```

In production the OIDC discovery provider already runs behind a public TLS
domain (that is its purpose — the same requirement AWS IAM / GCP federation
have), so no tunnel is involved: set `issuer_url`/`jwks_url` to that domain.

## Trusted issuer fields (exact server semantics)

| Field | Value here | Semantics (verified against server source) |
|-------|-----------|--------------------------------------------|
| `service_account_id` | `_create_client` → `client.id` | Internal id of the `service_account` client the SVID authenticates as. |
| `issuer_url` | `https://oidc-discovery.demo.example` | Must equal the SVID's `iss` — i.e. `jwt_issuer` in `conf/server/server.conf`. Globally unique. |
| `key_source_type` | `static_jwks_url` | `static_jwks_url` (the provider's `/keys`) or `oidc_discovery` (works when `issuer_url` is the provider's real public URL). **`spiffe_bundle_endpoint` is accepted by the API but its fetcher is NOT implemented server-side — do not use it.** |
| `jwks_url` | public URL of `/keys` | Fetched SSRF-hardened; must be publicly routable; cached 10 min. |
| `expected_aud` | `http://authorizer:8080` | The `aud` the SVID must contain exactly. Equals the workload's `AUDIENCE` env. |
| `subject_claim` | omitted (defaults `sub`) | For SPIFFE rows the value must be a `spiffe://` URI or the assertion is rejected. |
| `allowed_subjects` | `spiffe://demo.example/workload` | Exact-match allow-list of SPIFFE IDs. **Empty = deny-all.** |
| `issuer_type` | `spiffe_jwt` | Required for the jwt-spiffe assertion type; a `spiffe_jwt` row is unreachable via jwt-bearer and vice versa. |

Other enforced rules: asymmetric algs only (SPIRE's ES256 is on the allow-list
and verified working), `exp`/`iat` required, lifetime ceiling 1 h (`exp − iat`),
60 s clock skew, single-use replay cache, every rejection is the same generic
`invalid_client`.

## What was executed vs. written blind

Executed live on this machine:

- **Full compose e2e**: `./setup.sh` brought up spire-server + spire-oidc +
  spire-agent (join-token node attestation) + `authorizer:local` + the
  workload container. The workload fetched a real JWT-SVID over the Workload
  API (unix:uid:0 attestation) and exchanged it at the real Authorizer
  container: `exchanged JWT-SVID for Authorizer access token
  (expires_in=1800s scope="read:demo")`. The SPIRE JWKS was served through a
  public ngrok tunnel because of the SSRF rule above.
- Negative paths (against a live server built from the same source): replaying
  a used assertion → `invalid_client`; presenting a SPIFFE SVID with the
  jwt-bearer type (cross-profile) → `invalid_client`.

Found while executing (already fixed in the files): the SPIRE images run as
uid 1000 and `authorizer:local` as a non-root user, so all services needed
`user: "0:0"` for the root-owned named volumes (demo-only); the OIDC provider
refuses requests whose Host header is not in `domains` — your tunnel host must
be added there.
