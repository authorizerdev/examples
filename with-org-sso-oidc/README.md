# Per-Organization OIDC SSO (Enterprise Broker)

Each Authorizer [organization](https://docs.authorizer.dev) can bring its own
upstream OIDC identity provider. Authorizer acts as the **Relying Party
(broker)**: the org's users authenticate at their corporate IdP (here:
Keycloak), Authorizer verifies the ID token, JIT-provisions the user into the
org, and issues a normal Authorizer session — your apps keep integrating with
Authorizer only.

```
User ──► /oauth/sso/{org_slug}/login ──► Keycloak /authorize (PKCE + state + nonce)
     ◄── /oauth/sso/{org_slug}/callback ◄── code
Authorizer verifies ID token (JWKS, iss, aud, nonce) ──► JIT provision ──► session cookie
     ──► redirect back to your app (redirect_uri + state)
```

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Keycloak (org IdP) + `authorizer:local` |
| `1-bootstrap-keycloak.sh` | Realm `acme`, OIDC client for the broker callback, test user `jdoe` |
| `2-setup-authorizer.sh` | `_create_organization` + `_create_org_oidc_connection` (admin GraphQL) |
| `3-login-flow.sh` | The full brokered login, driven headlessly with curl |

All scripts take env overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`KEYCLOAK_URL` (default `http://localhost:8082`), `ADMIN_SECRET` (default `admin`),
`ORG_SLUG` (default `acme`). All secrets in this example are obviously fake.

## The one hard requirement: a public https issuer

Authorizer's broker **hard-requires** the upstream `issuer_url` to be:

1. an **https** URL, and
2. resolvable to a **non-private, non-loopback IP** — every upstream fetch
   (discovery, JWKS, token exchange) goes through an SSRF-hardened HTTP client
   with no dev bypass.

So `http://localhost:8082` can never back the broker. For a local demo, front
Keycloak with a free https tunnel:

```sh
ngrok http 8082          # or: cloudflared tunnel --url http://localhost:8082
export KEYCLOAK_URL=https://<your-tunnel-domain>   # the URL ngrok prints
```

and start Keycloak with its hostname pinned to that URL (`KC_HOSTNAME` in
`docker-compose.yml`, uncommented and filled in) so the discovery document,
the token `iss`, and the browser-facing endpoints all agree — the broker's
RFC 9207 mix-up defense rejects any mismatch.

In production this is a non-issue: corporate IdPs (Okta, Entra ID, Google
Workspace, a real Keycloak deployment) already live on public https URLs.

## Run it

```sh
# 0. Start the stack (or run Authorizer via `make dev` in the authorizer repo)
docker compose up -d          # set KC_HOSTNAME first, see above

# 1. Create realm + client + test user at the IdP
KEYCLOAK_URL=https://<tunnel> ./1-bootstrap-keycloak.sh

# 2. Create the org + OIDC connection in Authorizer
KEYCLOAK_URL=https://<tunnel> ./2-setup-authorizer.sh

# 3. Drive the whole login headlessly (what a browser would do)
./3-login-flow.sh
```

Expected end state of step 3: a `302` back to
`http://localhost:8090/dashboard?state=demo-app-state-123`, an Authorizer
session cookie, and a `session` GraphQL query returning the JIT-provisioned
`jdoe@acme.test`.

In a real app you only build step 1's URL:

```
GET {AUTHORIZER_URL}/oauth/sso/{org_slug}/login
      ?redirect_uri=https://app.example.com/dashboard   # must pass --allowed-origins
      &state=RANDOM_STATE                               # echoed back to you
```

## Admin API reference (verified against the GraphQL schema)

```graphql
mutation {
  _create_org_oidc_connection(params: {
    org_id: "ORG_ID"
    name: "ACME Keycloak"
    issuer_url: "https://idp.example.com/realms/acme"  # OIDC discovery base
    client_id: "authorizer-broker"    # issued BY the IdP TO Authorizer
    client_secret: "..."              # stored encrypted, never returned
    # scopes: defaults to "openid profile email"
    # redirect_uri: derived from the request host when omitted:
    #   {host}/oauth/sso/{org_slug}/callback
  }) { id org_id issuer_url sso_client_id is_active }
}
```

One OIDC connection per org. Related: `_update_org_oidc_connection`
(supplying `client_secret` rotates it), `_delete_org_oidc_connection`,
`_org_oidc_connection` (fetch by `id` **or** `org_id`). The upstream
`client_secret` is never projected back in any response.

## JIT provisioning & security notes

- Federated identity is keyed by `(org_id, issuer, sub)` — **never by email**.
  An upstream assertion whose email collides with an existing local account is
  rejected fail-closed, not linked.
- First-time users are created and added as org members automatically.
- PKCE (S256), single-use `state`, `nonce`, JWKS verification, `aud` check,
  and asymmetric-alg-only ID tokens are enforced by the broker.

If the org's IdP only speaks SAML 2.0, see [`../with-org-saml`](../with-org-saml).
