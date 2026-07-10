# Agent delegation with the Python SDK (RFC 8693)

An orchestrator agent acts **on behalf of a user** and re-delegates to a
specialist agent — the agentic-AI identity pattern, built on the Authorizer
Python SDK's `get_token` (client_credentials + token exchange).

```
 user ──► orchestrator agent ──► specialist agent
 sub  =  user                    user            (never changes)
 act  =  {orchestrator}          {specialist, act: {orchestrator}}
 scope:  crm:read crm:write  ──► crm:read        (can only narrow)
 aud  =  https://crm.internal ──► https://reports.internal (RFC 8707)
```

Why each agent gets its own service account: the `act` chain gives you a
tamper-proof audit trail of *which* software acted, while `sub` keeps every
downstream authorization decision keyed on the *user's* rights. Scope
attenuation is monotonic — a downstream agent can never re-widen what an
upstream hop dropped (`invalid_scope`), and delegated tokens live 5 minutes.

## Quickstart

Requires a server built from main (`make dev` in the server repo → :8080)
and the **unreleased** Python SDK from local main (token-exchange support
merged, not yet on PyPI — switch to `pip install authorizer-py` at the next
release):

```bash
python3 -m venv .venv
.venv/bin/pip install -e ../../../authorizer-python

export AUTHORIZER_CLIENT_ID=kbyuFDidLLm280LIwVFiazOqjO3ty8KH   # make-dev default
export AUTHORIZER_ADMIN_SECRET=admin

.venv/bin/python setup.py    # registers the two agents; prints export lines (secrets shown ONCE)
# paste the export lines, then:
.venv/bin/python demo.py           # sync: 2 hops + attenuation + rejection
.venv/bin/python demo.py --async   # same first hop on the async client
```

## What the demo shows

1. User signs up (fresh email per run — re-runnable)
2. Orchestrator mints its own machine token (`client_credentials`)
3. **Hop 1**: orchestrator exchanges the user's token (`subject_token`) with
   its own token as `actor_token` — the agent also authenticates the exchange
   call itself with its `client_secret` (actor binding: the actor token must
   belong to the authenticated client)
4. **Hop 2**: the specialist re-exchanges the *delegated* token — the nested
   `act` chain grows, scope narrows again
5. **Rejection**: re-widening to `crm:write` from the `crm:read` token fails
   with "requested scope is empty after attenuation"

## SDK notes

- `GetTokenRequest` carries all RFC 8693 params (`subject_token`,
  `actor_token`, `resource`, plus `client_secret` for the exchange auth)
- The async client (`AsyncAuthorizerClient`) mirrors the sync API 1:1
- Known parity gap: the SDK's `Client` type doesn't expose `client_id` yet
  (server added it in authorizer#664); `setup.py` uses `client.id`, which
  equals `client_id` for admin-created clients
