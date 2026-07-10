# SCIM 2.0 Provisioning (per organization)

Authorizer exposes a per-organization inbound **SCIM 2.0** (RFC 7644) endpoint
so enterprise directories (Okta, Microsoft Entra ID, OneLogin, …) can
provision and deprovision that org's users automatically.

- Base URL: `{AUTHORIZER_URL}/scim/v2`
- Auth: `Authorization: Bearer <endpoint token>` — one token per org
- Media type: `application/scim+json`

The org is resolved **solely from the bearer token** — never from the URL or
body — so one org's token can never touch another org's users. A missing or
wrong token is a constant-time `401`.

## Files

| File | Purpose |
|------|---------|
| `1-setup.sh` | `_create_organization` + `_create_scim_endpoint` — prints the bearer token (shown **once**) |
| `2-provision-demo.sh` | Simulates an IdP: dedup probe, create, get, filtered list, PUT update, deactivate, reactivate, DELETE |
| `3-rotate-token.sh` | `_rotate_scim_token` — proves the old token 401s and the new one works |

Env overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`ADMIN_SECRET` (default `admin`), `ORG_SLUG` (default `initech`). Run
Authorizer via `make dev` in the authorizer repo or any deployment.

```sh
./1-setup.sh                  # prints:  export SCIM_TOKEN=...
export SCIM_TOKEN=...
./2-provision-demo.sh
./3-rotate-token.sh
```

## Supported SCIM surface

| Route | Method | Behavior |
|-------|--------|----------|
| `/scim/v2/Users` | POST | Create (JIT-provision) a user in the org |
| `/scim/v2/Users` | GET | Only the `userName eq "..."` filter (the IdP dedup probe). An **unfiltered list returns an empty set** — org enumeration is out of scope |
| `/scim/v2/Users/{id}` | GET | Fetch one user |
| `/scim/v2/Users/{id}` | PUT | Replace mutable profile fields + `active` flag |
| `/scim/v2/Users/{id}` | PATCH | **Honours only the `active` attribute** (the Okta/Entra deprovision path); other paths are accepted and ignored — use PUT for profile edits |
| `/scim/v2/Users/{id}` | DELETE | Treated as deactivation (`active: false`), not a hard delete |
| `/scim/v2/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` | GET | SCIM discovery documents |

Groups are not implemented. `userName` is required on create (primary email is
used if the IdP omits it); `externalId` is stored and round-tripped.

## Deprovisioning semantics (synchronous)

- `PATCH {"active": false}` (or `DELETE`) marks the user revoked and
  **immediately revokes their sessions and refresh tokens** — a still-held
  access token fails introspection and cannot be refreshed.
- A user provisioned with `active: false` can never be issued a token.
- `active: true` reactivates the account.

## Wiring an IdP at the endpoint

### Okta

1. Add a **SCIM 2.0** provisioning integration to your app.
2. SCIM connector base URL: `https://your-authorizer.example/scim/v2`
3. Unique identifier field: `userName`; authentication mode: **HTTP Header**,
   with the bearer token from `1-setup.sh`.
4. Enable **Create Users**, **Update User Attributes**, **Deactivate Users**.

### Microsoft Entra ID (Azure AD)

1. Enterprise application → **Provisioning** → mode *Automatic*.
2. Tenant URL: `https://your-authorizer.example/scim/v2`
3. Secret Token: the endpoint token. Test the connection.
4. Entra's deprovision flow (`PATCH active:false`) is fully supported and
   revokes sessions immediately.

## Token rotation policy

The token is high-entropy and stored only as a hash — it is returned **once**
at creation and once per rotation, never retrievable again. Rotate with
`_rotate_scim_token` (see `3-rotate-token.sh`):

- immediately if the token may have been exposed,
- routinely (e.g. quarterly) as part of secret hygiene,
- then update the IdP's secret (Okta *API token* / Entra *Secret Token*) —
  the old token is invalidated the moment the mutation returns.

Admin ops (all keyed by `org_id`): `_create_scim_endpoint`,
`_rotate_scim_token`, `_delete_scim_endpoint`, and the `_scim_endpoint` query
(returns the endpoint record, never the token).
