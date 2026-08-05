# Per-Agent Permissions with Authorizer

A runnable demo of **agent identity in fine-grained authorization**: an AI agent
acting for a user gets the **intersection** of what the agent is trusted with
and what that user can reach.

```
effective authority = perms(agent) ∩ perms(user)
```

Evaluated per action, at request time, on both `check_permissions` and
`list_permissions`.

No npm dependencies. Node 18+ (built-in `fetch`).

## Why an intersection

Give an agent a user's token and it holds the user's authority. Give it its own
grants and it holds those. Neither alone is safe:

- **Only the user's authority** — a hijacked or prompt-injected agent can do
  anything its user can. That is the classic
  [Confused Deputy](https://en.wikipedia.org/wiki/Confused_deputy_problem): a
  calendar agent talked into reading payroll, *because its user can read
  payroll*.
- **Only the agent's authority** — the agent reaches resources its user was
  never allowed near, and "on behalf of Alice" becomes a fiction.

Intersecting both means an agent can only ever do what **it** is trusted with
**and** what its **user** could have done itself. Neither identity widens the
other.

## The scenario

> Alice hands a calendar agent a delegated token to help with the Q4 plan.

| Subject | Granted `viewer` on |
|---|---|
| Alice (the user) | q4-plan, payroll |
| calendar-agent | q4-plan, roadmap |
| finance-agent | *(nothing)* |

The calendar agent acting for Alice can therefore reach **only q4-plan**:

| Document | Agent | Alice | Result |
|---|---|---|---|
| q4-plan | ✅ | ✅ | **allowed** |
| payroll | ❌ | ✅ | **denied** — Confused Deputy blocked |
| roadmap | ✅ | ❌ | **denied** — the agent cannot exceed Alice |

## Run it

```sh
# 1. Start Authorizer (from the authorizer repo root).
#    FGA is on by default with SQLite.
make dev

# 2. Run the demo
node demo.mjs
```

Environment overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`AUTHORIZER_ADMIN_SECRET` (default `admin`), `AUTHORIZER_ORIGIN`.

Every line of output is an assertion against the live server — the demo exits
non-zero if any of them does not hold.

## Turning it on: declare `type agent`

**There is no flag.** Declaring `type agent` in your authorization model *is*
the opt-in:

```dsl
model
  schema 1.1

type user
type agent

type document
  relations
    define viewer: [user, agent]
    define can_view: viewer
```

That is deliberate. Checking `agent:x` against a model with **no** agent type
does not return `false` in OpenFGA — it **errors**, and permission checks fail
closed on errors. A flag switched on against an unprepared model would therefore
deny *every* delegated request: a total authorization outage rather than a
graceful degradation. Auto-detection makes that state unreachable.

Section 8 of the demo shows the other side of that trade: rewrite the model
without `type agent` and the same agent immediately inherits Alice's full
authority again. Deployments that never opt in keep their existing behaviour
byte-for-byte, and that state is counted as
`authorizer_fga_delegated_checks_total{outcome="not_enforced"}` so you can alert
on agent traffic arriving unconstrained.

> **Before you deploy the model:** the moment `type agent` appears, every
> delegated caller must also satisfy the agent half. Grant your agents first, or
> their calls start being denied — the `denied_by_agent` outcome tells you
> exactly that is happening.

## Granting an agent

An agent's subject is `agent:<client_id>` — the `client_id` of the
`service_account` that authenticated the exchange, and the same value that
appears as `act.sub` on the delegated token:

```graphql
mutation {
  _fga_write_tuples(params: { tuples: [
    { user: "agent:calendar-agent-client-id", relation: "viewer", object: "document:q4-plan" }
  ]}) { message }
}
```

Agents are independent subjects, so one user can delegate to as many as they
like and each carries its own, separately revocable reach. Deleting one agent's
tuple touches neither the user nor any other agent (section 7).

## Calling Authorizer's own API

A delegated token is bound to exactly one `resource` (RFC 8707) and is accepted
only there. To let an agent ask **Authorizer** about its own authority, exchange
for Authorizer's own URL:

```sh
-d "resource=$AUTHORIZER_URL"      # ← Authorizer itself
```

A token exchanged for `https://calendar.example` will not authenticate here.
That binding is the point, not an obstacle.

## What this demo also proves

- **Enumeration intersects** (section 5). Without it an agent that cannot *act*
  on payroll would still see it *listed*, leaking the user's resource names.
- **An explicit `user` cannot shed the agent half** (section 6), in either the
  `user:<id>` or bare-`<id>` spelling. The gate is on *who the caller is*, never
  on what they typed.
- **Only the immediate actor participates.** In a multi-hop chain
  (`app → agent → sub-agent`) the check is `perms(sub-agent) ∩ perms(user)`;
  prior hops are recorded for audit but never grant or deny.

## Test it with a REAL AI agent

`demo.mjs` proves the rule with plain HTTP calls — the "agent" is a script.
To put an actual model behind it, use Authorizer's **built-in MCP server**: give
it a delegated token as its bearer and register it with any MCP host (Claude
Code, Claude Desktop, Cursor).

```sh
# 1. Start the server (HS256 + a local sqlite file, so the MCP flags stay short)
./run-server.sh

# 2. Mint a delegated token and print the registration command
node mcp-agent.mjs
```

That prints a ready-to-paste `claude mcp add …` command. Register it, then ask
the agent in plain language:

> "Can you view `document:q4-plan-…`?" → the tool answers **allowed**
> "Can you view `document:payroll-…`?" → the tool answers **denied**

The second one is the whole point. The delegating user **can** read payroll. The
agent was never granted it, so the agent cannot — no matter how the question is
phrased, because the decision is made server-side from the token, not from the
conversation. Prompt injection has nothing to work with.

### Prove it without a model in the loop

```sh
node mcp-agent.mjs --verify
```

This spawns the real `authorizer mcp` process and speaks the same JSON-RPC an
MCP host speaks, asserting the intersection holds through the tool surface —
then repeats the identical calls with the **user's own** token as a control:

```
== Driving the real MCP server over stdio (delegated token) ==
  ✓ check_permissions q4-plan -> allowed
  ✓ check_permissions payroll -> DENIED
  ✓ list_permissions includes q4-plan
  ✓ list_permissions EXCLUDES payroll

== Control: the same tools with the USER's own token ==
  ✓ check_permissions q4-plan -> allowed
  ✓ check_permissions payroll -> allowed (the user CAN see it)
```

Same user, same tuples, same tools. The only difference is that the agent is in
the loop — and payroll went from allowed to denied.

### Things that will bite you

- **`authorizer mcp` is a separate process.** It opens the database directly and
  validates the bearer itself, so it needs the *same* `--database-*`, `--jwt-*`
  and `--encryption-key` flags as the server that minted the token. Point it at
  a different database or a different JWT secret and every tool call returns
  `Unauthenticated` — which looks like a permissions bug and is not one.
- **A delegated token lives 5 minutes.** Re-run `mcp-agent.mjs` to mint a fresh
  one. Don't spend that budget compiling: build the binary once
  (`go build -o .agent-demo-bin .`) rather than using `go run` per spawn.
- **Check what is actually listening on :8080.** A stray `make dev` from another
  terminal will answer health checks while `run-server.sh` silently fails to
  bind, and you will be testing a different deployment than you think.

## Related

- [`with-agent-delegation`](../with-agent-delegation) — how the delegated token
  is minted, scoped and chained (RFC 8693 token exchange)
- [`with-fga-permissions`](../with-fga-permissions) — the FGA model and tuples
  without agents in the picture
- [`with-rag-fga`](../with-rag-fga) — permission-aware retrieval
- Docs: [Agent Identity & Permissions](https://docs.authorizer.dev/enterprise/agent-identity)
