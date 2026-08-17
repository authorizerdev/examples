# Setup: secretless Kubernetes auth against Authorizer

All admin calls use the super-admin GraphQL API with the
`x-authorizer-admin-secret` header (the `--admin-secret` value, `admin` in
these manifests). The `Origin` header is required — Authorizer's CSRF guard
rejects state-changing requests without it.

## 1. Cluster and images

```bash
kind create cluster --name authorizer-demo --config k8s/kind-config.yaml

# Authorizer server image (built from server main; substitute the next
# published release once it ships)
kind load docker-image authorizer:local --name authorizer-demo

# Worker image (vendor first — go.mod has a local replace, see app/Dockerfile)
cd app && go mod vendor && docker build -t authorizer-worker:local . && cd ..
kind load docker-image authorizer-worker:local --name authorizer-demo

kubectl apply -f k8s/rbac.yaml -f k8s/authorizer.yaml
# Wait for authorizer to be ready before creating the trusted issuer:
kubectl -n authorizer-demo rollout status deploy/authorizer
```

Authorizer is now reachable on the host at `http://localhost:30080`.

## 2. Find the cluster's OIDC issuer and JWKS

Projected ServiceAccount tokens are JWTs signed by the cluster:

```bash
kubectl get --raw /.well-known/openid-configuration | jq -r .issuer
# kind default: https://kubernetes.default.svc.cluster.local

kubectl get --raw /openid/v1/jwks > jwks.json
```

**SSRF constraint (important):** Authorizer fetches trusted-issuer JWKS with an
SSRF-hardened client that rejects private, loopback, and link-local addresses.
A kind cluster's own JWKS endpoint lives on a private ClusterIP, so Authorizer
cannot fetch it directly. Host `jwks.json` at a **publicly-routable URL**
(only the public keys — nothing sensitive), e.g.:

```bash
# any public static host works; ngrok in front of a local file server:
python3 -m http.server 9000 &            # serves ./jwks.json
ngrok http 9000                          # note the https://….ngrok…/ URL
JWKS_URL="https://<your-tunnel>/jwks.json"
```

**This mirror step is only for default-issuer clusters like this kind demo.**
EKS, GKE and AKS publish a public https issuer with public OIDC discovery by
default, so there is nothing to mirror: use `key_source_type: "oidc_discovery"`
and skip straight to step 3. Check which case you are in with the command at
the top of this step — if `.issuer` is a public URL, you are done here.

If you do run a mirror, **refresh it when the cluster rotates its signing
keys**. A stale mirror stops validating newly-issued tokens, and one that keeps
serving a retired key keeps validating tokens it should not. Authorizer caches
a fetched JWKS for 10 minutes, so its own staleness is bounded — the mirror's
is yours to manage.

## 3. Create the service-account client

```bash
curl -s http://localhost:30080/graphql \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:30080' \
  -H 'x-authorizer-admin-secret: admin' \
  -d '{"query":"mutation { _create_client(params: { name: \"k8s-worker\", allowed_scopes: [\"read:demo\"] }) { client { id client_id } client_secret } }"}'
```

Note the returned `client.id` (internal id — this is what the trusted issuer
binds to). The `client_secret` is returned once; for this secretless flow you
can simply discard it.

## 4. Register the trusted issuer

`issuer_url` must equal the token's `iss` exactly; `expected_aud` must equal
the audience projected in `k8s/worker.yaml`; `allowed_subjects` is an exact
allow-list (empty = deny-all).

```bash
curl -s http://localhost:30080/graphql \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:30080' \
  -H 'x-authorizer-admin-secret: admin' \
  -d '{"query":"mutation { _add_trusted_issuer(params: { service_account_id: \"<client.id from step 3>\", name: \"kind demo worker\", issuer_url: \"https://kubernetes.default.svc.cluster.local\", key_source_type: \"static_jwks_url\", jwks_url: \"<JWKS_URL from step 2>\", expected_aud: \"http://authorizer.authorizer-demo.svc:8080\", allowed_subjects: \"system:serviceaccount:authorizer-demo:worker\", issuer_type: \"kubernetes_sa\" }) { id issuer_url is_active } }"}'
```

## 5. Run the worker

```bash
kubectl apply -f k8s/worker.yaml
kubectl -n authorizer-demo logs -f deploy/worker
# expect: "got access token (...)" then "sample endpoint 200: {...}"
```

## TokenReview (the "tokenreview" in this example's name) — current state

Offline JWKS validation proves the assertion was signed by the cluster, not
that the pod/ServiceAccount still exists. Authorizer implements online
TokenReview validation (`authentication.k8s.io/v1`) per trust row via two
fields on the trusted-issuer record: `enable_token_review` and
`kubernetes_api_server_url`.

Honest status, verified against server source:

- **Runtime: implemented.** When `enable_token_review` is set on the row,
  Authorizer POSTs the assertion to `<kubernetes_api_server_url>/apis/authentication.k8s.io/v1/tokenreviews`
  after all offline checks and rejects fail-closed unless the apiserver reports
  `authenticated: true`. It authenticates that call with its own in-cluster
  ServiceAccount token — which is why `k8s/rbac.yaml` binds the `authorizer`
  ServiceAccount to `system:auth-delegator`.
- **Admin API: settable.** `_add_trusted_issuer` and `_update_trusted_issuer`
  both accept `enable_token_review` and `kubernetes_api_server_url`, and both
  are returned by the queries. (An earlier revision of this file said they were
  not — that is out of date.) `kubernetes_api_server_url` is validated at write
  time: required, and `https`, whenever `enable_token_review` is true.
- **`kubernetes_api_server_url` is security-sensitive.** Authorizer
  authenticates the TokenReview call with its own in-cluster ServiceAccount
  token, so whatever host you configure receives that credential. Keep the
  binding to `system:auth-delegator` (TokenReview only, as in `k8s/rbac.yaml`)
  so the credential grants nothing else.
- **SSRF limitation:** the TokenReview call goes through the same
  SSRF-hardened client, so only a publicly-routable apiserver endpoint works
  (managed clusters' public API endpoints). `https://kubernetes.default.svc`
  is a private ClusterIP and is rejected by design — a kind cluster cannot use
  TokenReview at all.
