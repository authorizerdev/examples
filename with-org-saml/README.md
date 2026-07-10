# Per-Organization SAML 2.0 SSO (Authorizer as Service Provider)

For organizations whose IdP speaks SAML 2.0, Authorizer acts as a **SAML SP
per org**: users authenticate at the corporate IdP (here: Keycloak),
Authorizer validates the signed assertion against the org's pinned IdP
certificate, JIT-provisions the user, and issues a normal Authorizer session.

## Per-org endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/oauth/saml/{org_slug}/metadata` | GET | SP metadata XML — import at the IdP |
| `/oauth/saml/{org_slug}/login` | GET | SP-initiated login (AuthnRequest via HTTP-Redirect) |
| `/oauth/saml/{org_slug}/acs` | POST | Assertion Consumer Service |

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Keycloak (org SAML IdP) + `authorizer:local` |
| `1-bootstrap-keycloak.sh` | Realm `globex`, SAML client matching Authorizer's SP entity ID + ACS URL, attribute mappers, test user `pgibbons` |
| `2-setup-authorizer.sh` | Extracts entity ID / SSO URL / signing cert from Keycloak's IdP descriptor XML and runs `_create_org_saml_connection` |
| `3-login-flow.sh` | The full SP-initiated login, driven headlessly with curl |

Env overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`KEYCLOAK_URL` (default `http://localhost:8082`), `ADMIN_SECRET` (default
`admin`), `ORG_SLUG` (default `globex`). All secrets are obviously fake.

## https requirement (lighter than the OIDC broker)

`idp_sso_url` (and the optional `sp_entity_id`/`acs_url` overrides) must be
**https** — but unlike the OIDC broker, Authorizer never contacts the IdP
server-side: only the user's browser visits the SSO URL, and the IdP posts the
assertion back to Authorizer. Any https front for Keycloak works; a free
tunnel is the zero-config option for a local demo:

```sh
ngrok http 8082
export KEYCLOAK_URL=https://<your-tunnel-domain>
```

Pin `KC_HOSTNAME` in `docker-compose.yml` to that URL so Keycloak's SAML
entity ID and endpoints are consistent.

## Run it

```sh
docker compose up -d          # set KC_HOSTNAME first, see above
KEYCLOAK_URL=https://<tunnel> ./1-bootstrap-keycloak.sh
KEYCLOAK_URL=https://<tunnel> ./2-setup-authorizer.sh
./3-login-flow.sh
```

Expected end state: a `302` back to
`http://localhost:8090/dashboard?state=demo-app-state-456`, an Authorizer
session cookie, and a `session` query returning the JIT-provisioned
`pgibbons@globex.test` with mapped `given_name`/`family_name`.

### Known limitation: browser POSTs to the ACS

Authorizer's CSRF middleware currently requires state-changing POSTs to carry
an allow-listed `Origin` **and** `Content-Type: application/json` or
`X-Requested-With`. A real IdP's browser auto-submit form posts
`application/x-www-form-urlencoded` from the IdP's origin, so it is rejected
with `403 csrf_validation_failed` unless the server exempts
`/oauth/saml/*/acs` (as it already does for `/oauth_callback/*` and
`/scim/v2/*`). `3-login-flow.sh` adds the two headers to emulate an accepted
POST; until the exemption ships, browser-based SAML logins against this build
will be blocked at the ACS.

## Admin API reference (verified against the GraphQL schema)

```graphql
mutation {
  _create_org_saml_connection(params: {
    org_id: "ORG_ID"
    name: "Globex Keycloak SAML"
    idp_entity_id: "https://idp.example.com/realms/globex"  # assertion Issuer; globally unique
    idp_sso_url: "https://idp.example.com/realms/globex/protocol/saml"  # HTTP-Redirect binding
    idp_certificate: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
    # sp_entity_id / acs_url: optional overrides; derived from the request host:
    #   {host}/oauth/saml/{org_slug}/metadata  and  {host}/oauth/saml/{org_slug}/acs
    # attribute_mapping: optional JSON, e.g. "{\"email\":\"mail\"}"
    # allow_idp_initiated: defaults to false
  }) { id sp_entity_id acs_url allow_idp_initiated is_active }
}
```

Related: `_update_org_saml_connection` (supplying `idp_certificate` replaces
it), `_delete_org_saml_connection`, `_org_saml_connection` (by `id` or
`org_id`). The IdP certificate is accepted on write, never projected back.

## Attribute mapping & JIT provisioning

The **NameID is the federated subject** — identity is keyed by
`(org_id, IdP entity ID, NameID)`, never by email (email collisions with
existing accounts are rejected fail-closed). Default attribute names, override
with `attribute_mapping`:

| Authorizer field | Default SAML attribute |
|------------------|------------------------|
| `email` | `email` |
| `given_name` | `firstName` |
| `family_name` | `lastName` |
| `nickname` | `displayName` |
| `picture` | `picture` |

The Keycloak bootstrap script registers matching `saml-user-property-mapper`s.

## SP-initiated vs IdP-initiated

- **SP-initiated is the default and recommended flow**: responses must match a
  pending AuthnRequest (`InResponseTo`), `RelayState` is an opaque single-use
  handle, and the final app redirect is validated against `--allowed-origins`.
- **IdP-initiated SSO is disabled by default** (`allow_idp_initiated: false`).
  Enabling it disables `InResponseTo` validation for **all** responses on that
  connection (library limitation), leaving replay defense solely to the
  single-use assertion-ID cache. Enable only if the org's IdP cannot do
  SP-initiated flows.

Other ACS enforcement: signature over the consumed assertion only against the
pinned cert (XSW defense), unsigned assertions rejected, Audience/Recipient/
Destination must match this org's SP identity, bounded clock skew, single-use
assertion IDs. AuthnRequests are currently emitted unsigned — the Keycloak
client is configured with `saml.client.signature=false` accordingly.
