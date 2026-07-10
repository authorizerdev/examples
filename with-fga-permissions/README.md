# Fine-Grained Authorization (FGA)

Document sharing with Authorizer's embedded [OpenFGA](https://openfga.dev) engine. Plain Node, built-in `fetch`, zero dependencies.

## What is ReBAC?

Relationship-based access control answers "may this user do X to this object?" from a graph of relationships instead of role flags. You define a **model** (object types and their relations: `owner`, `editor`, `viewer`, and derived permissions like `can_edit`), grant access by writing **tuples** (`user:alice` is `owner` of `document:1`), and ask the engine at request time. Because permissions derive from relations (`editor: [user] or owner`), one `owner` tuple grants edit and view too — no permission explosion, per-object granularity.

**Scopes vs FGA:** OAuth scopes (see the [`with-m2m-client-credentials`](../with-m2m-client-credentials) example) say what a *token* may do — coarse, per-client capabilities like `calendar:read`. FGA says what a *user* may do *to one specific object* — `bob can_view document:1` but not `document:2`. Use scopes to bound clients and tokens; use FGA for per-resource authorization inside your app. They compose: a request must carry an acceptable scope *and* pass the FGA check.

## Run it

**Requires an Authorizer server built from `main`**:

```bash
git clone https://github.com/authorizerdev/authorizer.git
cd authorizer
make dev   # serves http://localhost:8080, admin secret: admin (FGA is on by default with SQLite)
```

Then:

```bash
node setup.mjs   # admin: install the authorization model (_fga_write_model)
node demo.mjs    # users + tuples + checks
```

## The two API surfaces

| Surface | Operations | Credential |
| --- | --- | --- |
| **Admin** — author model, grant/revoke | `_fga_write_model`, `_fga_write_tuples`, `_fga_delete_tuples`, `_fga_read_tuples`, `_fga_get_model`, `_fga_list_users`, `_fga_expand`, `_fga_reset` | `x-authorizer-admin-secret` header, server-side only |
| **Client** — answer "may I…?" | `check_permissions`, `list_permissions` | The caller's own bearer token / session cookie |

`demo.mjs` signs up alice and bob, writes tuples as admin (alice `owner`, bob `viewer` of `document:1`), then each user checks with their own token:

```
check_permissions as bob:
  can_view document:1 -> true
  can_edit document:1 -> false
  can_delete document:1 -> false

list_permissions as bob (can_view documents): [ 'document:1' ]
```

The checked subject is pinned server-side to the caller's token — a user cannot ask about someone else (the optional `user` field is honored only for super-admins or when it equals the caller's own subject).

Revoking is the mirror image: `_fga_delete_tuples` with the same tuple. See the [FGA guide](https://docs.authorizer.dev/core/fga-guide) for advanced patterns (groups, hierarchies, conditions).

> Placeholder values (`admin`, demo emails/passwords) come from `make dev`. Never use them outside local development.
