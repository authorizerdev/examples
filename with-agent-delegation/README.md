# Agent-to-Agent Delegation with Authorizer

A runnable demo of **RFC 8693 token exchange (delegation profile)** for agentic
workloads: a user hands work to an orchestrator agent, which farms sub-tasks out
to tool agents. Every hand-off mints a new short-lived token that still says
`sub = the user`, records **who acted** in a nested `act` claim, and can only
ever **lose** scopes — never gain them.

No npm dependencies. Node 18+ (built-in `fetch`).

## The scenario

> "Summarize my CRM pipeline and export it."

```
user ──> orchestrator ──> research-agent ──> crm-reader ──> export-agent
           hop 1              hop 2             hop 3          hop 4  (server max)
```

- **orchestrator** — the front-line agent the user talks to (broad ceiling)
- **research-agent** — plans the CRM work (`crm:read crm:write`)
- **crm-reader** — actually queries the CRM (`crm:read` only)
- **export-agent** — renders the export (`crm:read` only)
- **archiver / mailer** — exist to demonstrate rejections (see below)

Each agent is an Authorizer **client (service account)** whose `allowed_scopes`
is its **delegation ceiling**: a token it mints via exchange can never carry a
scope outside that list.

## Run it

```sh
# 1. Start Authorizer (from the authorizer repo root)
make dev

# 2. Run the demo
node demo.mjs
```

Environment overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`AUTHORIZER_ADMIN_SECRET` (default `admin`, matches `make dev`),
`AUTHORIZER_ORIGIN` (default = `AUTHORIZER_URL`; GraphQL requests are
origin-checked even server-to-server, so it must be on the instance's
`--allowed-origins` list).

The script is self-contained: it registers the agent clients (admin API), signs
the demo user up (or in), runs the whole chain plus the negative cases, and
deletes the demo clients at the end.

## How a hop works

Each hop is one `POST /oauth/token` call made **by the receiving agent**, using
its own client credentials:

```
grant_type    = urn:ietf:params:oauth:grant-type:token-exchange
subject_token = the token being delegated (the user's token, or a previous
                delegated token for re-delegation)
actor_token   = the agent's OWN machine token (from client_credentials)
resource      = exactly ONE resource URI — the minted token's aud is bound to it
scope         = optional: request even less than you'd be given
```

The response is a normal RFC 8693 response; `expires_in` is **300 seconds** —
delegated tokens are deliberately short-lived and stateless (never persisted,
verified purely by signature).

## Reading the `act` chain

Hop 4's decoded token looks like this (ids shortened):

```json
{
  "sub": "79b27a8a…",                     // ALWAYS the original user
  "act": {
    "sub": "export-agent",                // outermost = who acts RIGHT NOW
    "act": {
      "sub": "crm-reader",                // …who was itself delegated by…
      "act": {
        "sub": "research-agent",
        "act": { "sub": "orchestrator" }  // innermost = first hop
      }
    }
  },
  "scope": ["openid", "crm:read"],
  "aud": "https://export.internal/api"
}
```

Read it **outside-in**: the top-level `act.sub` is the current actor (its
registered `client_id`, set by the server — never a client-supplied claim);
each nested `act` is one step earlier in the chain. `sub` never changes, so a
resource server always knows *whose* data is being touched and *which* agents
touched it, in order. The same chain is written to the audit log as
`orchestrator>research-agent>crm-reader>export-agent>user`.

Machine-token note: the `scope` claim in Authorizer machine/delegated tokens is
a **JSON array**, not the space-delimited string some libraries expect.

## Scope attenuation

At every hop the minted scope is:

```
effective = subject_token.scope ∩ agent.allowed_scopes [∩ requested scope]
```

Because the subject token's own scope is always in the intersection,
re-exchanging an already-narrowed token can only narrow further — **monotonic
non-widening**. In the demo:

| Hop | Ceiling | Result |
|---|---|---|
| user token | — | `openid email profile crm:read crm:write mail:send` |
| 1 orchestrator | full | unchanged |
| 2 research-agent | `openid crm:read crm:write` | drops `email profile mail:send` |
| 3 crm-reader | `openid crm:read` + requests `openid crm:read` | drops `crm:write` |
| 4 export-agent | `openid crm:read` | unchanged (already minimal) |

## The rejections (fail-closed invariants)

The demo ends with three live rejections:

1. **Chain depth** — a 5th hop is rejected (`invalid_request`). The server caps
   the `act` nesting at **4 actors**; real delegation is a few hops, and an
   unbounded chain is a token-bloat and audit-legibility risk.
2. **Attenuation is one-way** — the user originally granted `mail:send`, but it
   was dropped at hop 2. `mailer` (ceiling `[mail:send]`) exchanging hop 3's
   token gets `invalid_scope`: the intersection is empty. A downstream agent can
   never recover a scope an upstream agent gave up.
3. **Actor binding** — presenting *another agent's* machine token as
   `actor_token` is rejected (`invalid_grant`). The actor token's `sub` must be
   the authenticated client itself; a valid-but-unrelated token cannot stand in.

## Security invariants (recap)

- **Delegation only, never impersonation**: `actor_token` is mandatory; the
  minted token always exposes the acting agent in `act`.
- **Actor binding**: the immediate actor is the *authenticated* client; the
  server writes its registered `client_id` into `act.sub` itself.
- **Audience/resource binding (RFC 8707)**: exactly one `resource` per
  exchange; the token's `aud` is that URI, so it cannot be replayed against a
  different resource server.
- **TTL**: 300s. Steal a delegated token and it dies in minutes; there is no
  refresh token on this grant.
- **Monotonic attenuation** and **bounded chain depth**, as demonstrated.
- **Revocation is checked at exchange time**: a deactivated user (or agent)
  cannot seed a fresh delegation.
