# Two Claude Agents, One Authorizer: DevOps Delegation + Fail-Closed Authorization

A runnable demo of **agent-to-agent auth** where both agents are real, LLM-driven
processes built with the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) —
not scripted stand-ins — talking to each other over HTTP, with Authorizer as the
identity, delegation, and authorization layer underneath.

```
 user ──chat──> assistant-agent (Claude) ──HTTP, Bearer <delegated token>──> infra-agent (Claude)
                     |                                                            |
                     | client_credentials + RFC 8693 token exchange               | validates JWT (JWKS, aud)
                     v                                                            | check_permissions (OpenFGA)
                Authorizer  <───────────────────────────────────────────────────  |
                 :8080                                                       admin/staging only
```

## The scenario

You chat with a DevOps assistant: *"restart the payments service in staging"*,
then *"restart the payments service in prod"*. The assistant is not allowed to
decide access on its own — it delegates to a separate **infra agent** process,
which is the one that actually checks whether *you* (not the assistant) are
allowed to act on that environment, via an OpenFGA `can_deploy` relation.

Staging works. Prod is denied — not because the code special-cases "prod", but
because `setup.mjs` only grants the demo user `admin` on `environment:staging`.
That's the point: authorization stays keyed to what the **user** can do, no
matter which agent is acting for them.

## Why two processes, not one script

Other examples in this repo (`with-agent-delegation`, `with-agents-python`)
simulate multi-hop delegation with scripted `fetch` calls inside a single
script — great for seeing the RFC 8693 mechanics in isolation. Here, the two
agents are **independent, long-running services**, each with its own Claude
Agent SDK loop deciding what to do:

- **assistant-agent.mjs** — the front-line agent you chat with. Its Claude
  loop decides *when* to call the `deploy_action` tool; the tool then does the
  OAuth/delegation dance and calls the infra agent over the network.
- **infra-agent.mjs** — a resource server that also happens to use Claude:
  it enforces the permission check, then asks Claude to narrate the (simulated)
  execution plan. No real infrastructure is touched.

## Run it

Requires Node 18+, a running Authorizer (`make dev` from the server repo root
→ `:8080`), and `ANTHROPIC_API_KEY` set (the Claude Agent SDK reads it, or use
`ant auth login` — see the SDK docs).

```sh
npm install

# One-time: installs the FGA model, creates the demo user + staging-only
# grant, and registers the assistant's service-account client.
node setup.mjs
# ^ prints `export ASSISTANT_CLIENT_ID=...` / `ASSISTANT_CLIENT_SECRET=...` — run those.

# Terminal 2:
npm run infra

# Terminal 1 (after exporting the two vars setup.mjs printed):
npm run assistant
```

Then in the assistant's chat prompt:

```
You: restart payments in staging
You: restart payments in prod
```

The first succeeds (with a Claude-narrated "execution plan" from the infra
agent). The second comes back denied — the assistant explains why, without
retrying or working around it.

## How a request actually flows

Every `deploy_action` tool call the assistant's Claude makes does this, fresh
each time (delegated tokens are 5 minutes, non-refreshable, by design):

1. **`client_credentials`** — the assistant authenticates as itself (its own
   registered service-account client) to get a machine token. This is the
   RFC 8693 `actor_token`: proof of *which agent* is acting.
2. **RFC 8693 token exchange** — the assistant exchanges the user's own
   session token (`subject_token`) for a new token: same `sub` (the user),
   bound to the infra agent's URL (`resource`, RFC 8707 — so it's useless
   against any other API), scope narrowed to `infra:write` only.
3. **HTTP call to the infra agent** — a real network hop between two
   processes, carrying that delegated bearer token.
4. **Local JWT validation** — the infra agent checks signature (JWKS),
   issuer, and `aud == its own resource URL`, exactly like an MCP resource
   server would (see `with-mcp`).
5. **`check_permissions`** — the infra agent asks Authorizer, as *itself*
   (its own admin/service credential — `ADMIN_SECRET`), whether the token's
   `sub` (the real user, extracted from the token it just validated locally)
   has `can_deploy` on that environment. It can't simply re-present the
   delegated token as its own bearer here: Authorizer's own API requires
   `aud` to be Authorizer's own client_id, and this token's `aud` is
   deliberately *this server* (RFC 8707) — that mismatch is what makes the
   token useless anywhere but here. So the infra agent authenticates
   separately and passes an explicit `user: "user:<sub>"` override, which
   Authorizer honors only for a super-admin caller — never for the agent's
   own identity. Authorization stays keyed to the real human throughout (see
   `internal/service/fga.go` in the server repo), and an ambiguous case fails
   closed.
6. **Only if allowed** does the infra agent ask Claude to narrate an
   execution plan for the (simulated) action.

## Notes

- `deploy_action` is the assistant's only tool — Claude decides when to call
  it from the conversation, it isn't scripted branching.
- The assistant's chat loop is one `query()` call per line (no cross-turn
  memory) — each DevOps command here is self-contained, so conversation state
  isn't needed for this demo.
- Nothing here touches real infrastructure — the infra agent's response is
  always `simulated: true`.
- Re-running `setup.mjs` registers a **new** assistant client each time;
  delete the old one from the dashboard (or via `_delete_client`) if you don't
  want it to accumulate.
