# Token Exchange & Delegation (RFC 8693)

An AI agent acts **on behalf of a user** — and every downstream service can see both identities. Plain Node, built-in `fetch`, zero dependencies.

**Requires an Authorizer server built from `main`**:

```bash
git clone https://github.com/authorizerdev/authorizer.git
cd authorizer
make dev   # serves http://localhost:8080, admin secret: admin
```

## Run it

```bash
# 1. Register the agent's service account (admin, once)
node setup.mjs

# 2. Full delegation flow (values printed by setup.mjs)
AGENT_CLIENT_ID=<id> AGENT_CLIENT_SECRET=<secret> node delegate.mjs
```

## The delegation chain

`delegate.mjs` does three token requests:

1. **User logs in** — their access token is the *authority being exercised* (`subject_token`).
2. **Agent authenticates as itself** — `client_credentials` gives it an *actor token* proving who is acting.
3. **Exchange** — a form-encoded `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, the `subject_token`, the `actor_token`, and **exactly one** `resource` (RFC 8707). Zero or repeated `resource` values are rejected — a multi-audience delegated token would be replayable across services.

The delegated token keeps `sub` = the **user** and adds the `act` claim = the **agent**:

```jsonc
{
  "sub": "user-id",                       // whose authority
  "act": { "sub": "agent-client-id" },    // who is acting (multi-hop nests here)
  "aud": "https://calendar.example",      // only valid at this resource
  "scope": ["calendar:read"]              // attenuated
}
```

The `actor_token` is required: a subject-only exchange would be impersonation, which this endpoint refuses.

## Attenuation

The delegated scope is always the intersection:

```
effective = user_token.scope ∩ agent.allowed_scopes ( ∩ requested scope )
```

In this demo the user holds `calendar:write` but the agent's ceiling (`allowed_scopes` from `setup.mjs`) doesn't include it — so the delegated token can never write, no matter what is requested. An empty intersection fails with `invalid_scope`, and because the subject token's own scope is always intersected, re-exchanging a delegated token can only narrow further — never regain scope.

## 5-minute TTL

Delegated tokens are not refreshable and expire in **300 seconds**. That is the revocation story: the agent must re-exchange for more time, and revoking the user (or deactivating the agent client) stops the next exchange immediately, while in-flight tokens die within the window.

> Placeholder values (`admin`, demo email/password) come from `make dev`. Never use them outside local development.
