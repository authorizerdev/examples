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
and the Authorizer Python SDK (token-exchange support ships in
`authorizer-py>=0.3.0rc4`):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

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
- The SDK's `Client` type now exposes `client_id` (the public OAuth
  identifier) alongside `id` (the internal surrogate key), so `setup.py`
  prints `client.client_id`. The two coincide for admin-created clients but
  not in general — the reserved interactive client is one where they differ
- Signup returns no access token on a default install: MFA is on since
  2.4.0, so both flows decline the offer with `skip_mfa_setup` and then log
  in again to get a token carrying the demo's `crm:*` scopes
