# Enterprise ReBAC with Authorizer FGA

A runnable, multi-tenant relationship-based access control (ReBAC) demo against
Authorizer's embedded fine-grained authorization engine (OpenFGA). One model,
one seeded demo org, and a storytelling walkthrough that exercises the five
enterprise patterns most real deployments end up needing:

1. **Org hierarchy with permission inheritance** (org → team → project → document)
2. **Role grants** via `role#assignee` usersets
3. **User-specific overrides** (a direct tuple for one outsider)
4. **Exclusions** (`but not blocked` — a deny that beats every grant path)
5. **`service_account` subjects** (machine identities in the authorization graph)

No npm dependencies. Node 18+ (built-in `fetch`).

## Run it

```sh
# 1. Start Authorizer (from the authorizer repo root). With a SQLite/Postgres/
#    MySQL main database FGA is enabled automatically — no extra flags.
make dev

# 2. Install the model + seed the demo org  (DESTRUCTIVE: resets the FGA store)
node setup.mjs

# 3. The story — 15 live checks, each asserting its expected outcome
node walkthrough.mjs

# 4. "What can each persona access?"
node list-permissions.mjs
```

Environment overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`AUTHORIZER_ADMIN_SECRET` (default `admin`, matches `make dev`),
`AUTHORIZER_ORIGIN` (default = `AUTHORIZER_URL`; GraphQL requests are
origin-checked even server-to-server).

`setup.mjs` creates six real users (`alice@fga-demo.example.com` … password in
`api.mjs`), so the walkthrough runs every check with the **persona's own access
token** — the server pins the check subject to the caller's token; a client
cannot claim to be someone else. Only a super-admin may evaluate an explicit
other subject (used here for the CI bot).

## The cast

| Persona | Position in the graph |
|---|---|
| **alice** | org admin of `organization:acme` |
| **bob** | member of `team:eng` |
| **sam** | lead of `team:eng`, owner of `document:spec` |
| **dave** | member of `team:eng`, **blocked** on `document:salary-report` |
| **carol** | outside contractor — one direct override tuple |
| **erin** | assignee of `role:auditor` |
| **ci-bot** | `service_account:ci-bot` — viewer of `document:runbook` |

The model lives in [`model.fga`](./model.fga); the tuples in
[`setup.mjs`](./setup.mjs).

## The patterns

### 1. Org hierarchy with inheritance

Objects point *up* the hierarchy (`org` on a team, `team` on a project,
`project` on a document) and permissions flow *down* via tuple-to-userset
(`admin from org`, `lead from team`, `viewer from project`). One structural
tuple per level wires it; a grant at any level reaches everything beneath it —
alice's single `admin organization:acme` tuple lets her view every document of
every project of every team in the org.

```text
user:<alice>       admin    organization:acme
organization:acme  org      team:eng
user:<bob>         member   team:eng
user:<sam>         lead     team:eng
team:eng           team     project:phoenix
organization:acme  org      project:phoenix
team:eng#member    viewer   project:phoenix      # the whole team, one tuple
project:phoenix    project  document:spec
project:phoenix    project  document:salary-report
```

`team:eng#member viewer project:phoenix` is a **userset subject**: "everyone
who is a member of team:eng". Because `member` is itself `[user] or admin from
org`, the org admin is included automatically.

### 2. Role grants (`role#assignee`)

Model the role as an object and bind its assignee-set wherever the role should
apply. Onboarding is then ONE tuple (`assignee role:auditor`), offboarding is
deleting it — no per-resource churn. Here the auditor role is bound once at the
org and inherited by every project and document (`auditor from org`).

```text
role:auditor#assignee  auditor   organization:acme
user:<erin>            assignee  role:auditor
```

### 3. User-specific overrides

Nothing special is needed: relations like `viewer: [user, …]` accept direct
user tuples alongside the inherited paths, so a one-off grant is just a normal
tuple on a single object. Carol has exactly one document and nothing else.

```text
user:<carol>  viewer  document:spec
```

### 4. Exclusion — `but not blocked`

`can_view: viewer but not blocked` makes `blocked` a true deny: it wins over
every grant path — direct, inherited, group, or role. Dave is a full team
member with the same inherited access as bob, yet the one `blocked` tuple hides
the salary report from him (the walkthrough checks bob on the same document to
prove it is the block, not a missing grant).

```text
user:<dave>  blocked  document:salary-report
```

### 5. `service_account` subjects

The model declares `type service_account` and admits it in type restrictions
(`viewer: [user, service_account, …]`), so machine identities live in the same
graph as humans. The id should be the service account's `client_id` — the same
value that appears as `sub` in its machine tokens.

```text
service_account:ci-bot  viewer  document:runbook
```

**Server support note:** writing and admin-checking `service_account` tuples
works today (the walkthrough's ci-bot checks run live as super-admin with
`user: "service_account:ci-bot"`). But a machine caller presenting its own
machine token to `check_permissions` is currently resolved as a `user:`-typed
subject, so its `service_account:` tuples won't match — self-service checks by
machine callers land with PR
[#665](https://github.com/authorizerdev/authorizer/pull/665) (unreleased at
the time of writing). This demo therefore runs user-side checks with personal
tokens and the machine check via the admin path, which is fully supported.

## Reading the results

`walkthrough.mjs` prints each check with its reasoning and fails the process if
any answer deviates from the model's expected behavior — it doubles as a
regression test for the model. `list-permissions.mjs` shows the flip side:
`list_permissions` with a `relation`/`object_type` filter answers "which
documents can you view?" per persona (note dave's list correctly omits the
salary report), and unfiltered it enumerates everything a subject holds.
