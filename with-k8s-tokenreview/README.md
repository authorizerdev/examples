# with-k8s-tokenreview — secretless Kubernetes workload auth

A Go worker authenticates to [Authorizer](https://authorizer.dev) **without any
client_secret**: it presents its projected Kubernetes ServiceAccount token as an
RFC 7523 `client_assertion` (jwt-bearer) on the `client_credentials` grant, gets
an Authorizer access token, and uses it against a sample protected endpoint.

```
┌──────────────────────────── kind cluster ────────────────────────────┐
│                                                                      │
│  ┌─────────────┐  projected SA token           ┌──────────────────┐  │
│  │ worker pod  │  (aud=authorizer, kubelet-    │ authorizer pod   │  │
│  │             │   minted & rotated)           │ (authorizer:local│  │
│  │ /var/run/   │                               │  + SQLite)       │  │
│  │ secrets/    │  POST /oauth/token            │                  │  │
│  │ tokens/…  ──┼──────────────────────────────►│ iss → trusted    │  │
│  │             │  grant_type=client_credentials│ issuer row       │  │
│  │             │  client_assertion_type=       │  │               │  │
│  │             │    …:jwt-bearer               │  ▼               │  │
│  │             │  client_assertion=<SA token>  │ JWKS verify,     │  │
│  │             │                               │ aud/exp/subject/ │  │
│  │             │◄──────────────────────────────┼ replay checks    │  │
│  │             │  Authorizer access token      │                  │  │
│  │      │      │                               │ (optional)       │  │
│  │      ▼      │                               │ TokenReview ─────┼──┼──► kube-apiserver
│  │ GET /hello  │                               └──────────────────┘  │    (system:auth-delegator)
│  │ Bearer <at> │                                        ▲            │
│  └─────────────┘                                        │            │
│                              cluster JWKS ──────────────┘            │
│               (must be publicly routable — see setup.md)             │
└──────────────────────────────────────────────────────────────────────┘
```

## Why secretless beats client_secret in Kubernetes

- **Nothing to distribute or leak.** A `client_secret` in Kubernetes lives in a
  Secret object — base64 in etcd, visible to anyone with `get secrets`, copied
  into CI, rotated by hand (i.e. never). The projected SA token is minted by
  the kubelet, exists only in the pod's filesystem, and rotates automatically.
- **Identity, not possession.** The credential *is* the workload's platform
  identity (`system:serviceaccount:<ns>:<name>`), attested by the cluster and
  pinned server-side by an exact-match subject allow-list. A stolen secret works
  from anywhere; the assertion is audience-bound (`aud` must equal the trusted
  issuer's `expected_aud`), short-lived (≤1 h `exp − iat` ceiling), and
  **single-use** (replay-cached until `exp`).
- **Deprovisioning is automatic.** Delete the ServiceAccount/pod and, with
  TokenReview enabled, even a not-yet-expired token stops working.

## Contents

| Path | What |
|------|------|
| `app/` | Go worker (SDK `GetToken` with `ClientAssertion`) + built-in sample protected endpoint + Dockerfile |
| `k8s/kind-config.yaml` | Single-node kind cluster, authorizer exposed on host :30080 |
| `k8s/authorizer.yaml` | Authorizer Deployment (`authorizer:local` — load with `kind load docker-image`; substitute the next published release when it ships) + Service |
| `k8s/rbac.yaml` | Authorizer ServiceAccount + `system:auth-delegator` ClusterRoleBinding (for TokenReview) |
| `k8s/worker.yaml` | Worker ServiceAccount + Deployment with the projected token volume |
| `setup.md` | Step-by-step: cluster, images, admin GraphQL (client + trusted issuer), TokenReview status |

Follow `setup.md` top to bottom to run it.

## Trusted issuer fields (exact server semantics)

| Field | Value here | Semantics (verified against server source) |
|-------|-----------|--------------------------------------------|
| `service_account_id` | `_create_client` → `client.id` | Internal id of the `service_account` client the assertion authenticates as. Only `service_account`-kind clients may use `client_credentials`. |
| `issuer_url` | `https://kubernetes.default.svc.cluster.local` (kind) | Must equal the token's `iss` **exactly**; globally unique across all trusted issuers. |
| `key_source_type` | `static_jwks_url` | `oidc_discovery` (fetch `jwks_uri` from `{issuer_url}/.well-known/openid-configuration`) or `static_jwks_url`. `spiffe_bundle_endpoint` has no fetcher and is **rejected at write time**. |
| `jwks_url` | public URL of the cluster JWKS | Required for `static_jwks_url`. Fetched SSRF-hardened: private/loopback/link-local addresses rejected, redirects refused, 1 MiB cap, cached 10 min. |
| `expected_aud` | `http://authorizer.authorizer-demo.svc:8080` | The `aud` the assertion **must** contain exactly. Equals the `audience` in the projected volume. |
| `subject_claim` | omitted (defaults `sub`) | Claim identifying the workload. |
| `allowed_subjects` | `system:serviceaccount:authorizer-demo:worker` | Comma-separated **exact-match** allow-list. **Empty = deny-all.** |
| `issuer_type` | `kubernetes_sa` | `kubernetes_sa` \| `spiffe_jwt` \| `oidc` \| `cloud_oidc`. Non-SPIFFE rows are reachable only via the jwt-bearer assertion type. |

Validation is fail-closed and every rejection is the same generic
`invalid_client`: asymmetric algs only (RS/PS/ES), `exp`/`iat` required,
lifetime ceiling 1 h, 60 s clock skew, single-use replay cache keyed by `jti`
or `(iss,sub,iat,exp)` (K8s SA tokens carry no `jti`).

**Because assertions are single-use, mint fresh tokens rather than re-present
cached ones.** This worker re-reads the kubelet-rotated file every 5 minutes;
tight-loop workloads should mint per-request tokens via the TokenRequest API.

## What was executed vs. written blind

Executed live on this machine, exactly per `setup.md`:

- **Full in-cluster e2e**: kind cluster from `k8s/kind-config.yaml`; the
  `authorizer:local` image loaded via `kind load docker-image` and rolled out
  from `k8s/authorizer.yaml`; client + trusted issuer created through the
  admin GraphQL on :30080; the worker Deployment ran with a **real
  kubelet-projected token** verified against the **real cluster JWKS**
  (exposed through a public ngrok tunnel because of the SSRF rule above).
  Worker log: `got access token (expires_in=1800s scope="read:demo")` →
  `sample endpoint 200`.
- Negative paths (against a live server built from the same source): replaying
  an already-used assertion → `invalid_client`; presenting a jwt-spiffe-shaped
  token via jwt-bearer (cross-profile) → `invalid_client`.

Not executed: the TokenReview online check — not settable through the admin
API yet, and kind's apiserver is a private address the SSRF-hardened client
rejects by design (honest status in `setup.md`).
