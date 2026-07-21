# Authorizer + A2A: an Agent Card backed by an OAuth2 authorization server

This example shows **Authorizer as the OAuth2 authorization server behind an
A2A (Agent2Agent) v1.0 Agent Card**. A small Node agent (`server.mjs`)
publishes a spec-shaped Agent Card and authenticates every call as an
ordinary OAuth2 resource server — because that is *all* A2A asks of the
identity layer.

```
┌──────────┐  1. GET /.well-known/          ┌─────────────────┐
│          │     agent-card.json            │                 │
│  A2A      │ ─────────────────────────────► │  A2A agent      │
│  client   │ ◄── securitySchemes[].          │  (this example) │
│  (agent)  │     oauth2SecurityScheme.flows. │  :4002          │
│           │     clientCredentials.tokenUrl  │                 │
│           │                                 └────────┬────────┘
│           │  2. token request                        │ validates JWT:
│           │     (client_credentials)                  │ JWKS + issuer
│           ▼                                          ▼
│  ┌─────────────────────────────────────────────────────────┐
└─►│  Authorizer :8080                                       │
   │  /.well-known/openid-configuration   (AS metadata)      │
   │  /.well-known/jwks.json              (signing keys)     │
   │  /oauth/token                        (token endpoint)   │
   └─────────────────────────────────────────────────────────┘
```

## Where Authorizer fits — and where it deliberately doesn't

A2A v1.0 (Linux Foundation, `a2a-protocol.org/latest/specification/`) is not
an identity protocol. It defines an Agent Card (a discovery document) and a
JSON-RPC 2.0 wire protocol for agent tasks; for auth it says: authenticate
however the card's `securitySchemes` says to, using standard OAuth2/OIDC. It
explicitly does **not** define its own token format, and — this is the part
worth being precise about — it does **not** define an identity-provider-hosted
Agent Card registry. Cards are hosted by the agent itself, at a well-known
path; the spec's own words are that curated registries are optional and "the
current A2A specification does not prescribe a standard API" for them.

| Concern | A2A's answer | Who implements it here |
|---|---|---|
| Agent identity (auth) | `securitySchemes` = A2A `SecurityScheme`, a `oneof` whose kind is the JSON key (`oauth2SecurityScheme`, `httpAuthSecurityScheme`, `apiKeySecurityScheme`, `openIdConnectSecurityScheme`, `mtlsSecurityScheme`) — modeled on OpenAPI 3.x but not the literal `{"type":...}` shape | **Authorizer** (`/oauth/token`, JWKS, OIDC discovery) |
| Card discovery | `GET /.well-known/agent-card.json` on the agent's own domain (the **current** v1.0 path — some older SDKs/drafts still use `/.well-known/agent.json`, which is legacy) | **the agent** (`server.mjs`) |
| Card registry | Explicitly undefined by the spec — cards are self-hosted at the well-known path; the spec prescribes no standard registry API | **nobody** — deliberately out of scope, see below |
| Server auth (§7.4) | The A2A server "MUST authenticate the request using one of the schemes declared" in its own card | **the agent** (`server.mjs`'s bearer check) |
| Card signing (§8.4) | **Optional**, uses the agent's own signing key — independent of the OAuth2 scheme in `securitySchemes` | **nobody** in this example; Authorizer/JWKS has no role in card signing |

**Authorizer's job is narrow and already done**: be the AS a card's
`securitySchemes[].oauth2SecurityScheme` points at. It does not host cards,
does not run a registry, and does not sign cards — none of those are asked for
by the spec.

For a **delegated** call — an agent acting on behalf of a specific user,
rather than authenticating as itself — mint the bearer with RFC 8693 token
exchange instead of `client_credentials`; see [`../with-agent-delegation`](../with-agent-delegation)
and [`../with-token-exchange-delegation`](../with-token-exchange-delegation).
This agent's bearer check doesn't care which grant produced the token, only
that it's a valid Authorizer-issued one.

## The Agent Card

Served live at `/.well-known/agent-card.json` (built from Authorizer's real
OIDC discovery, nothing hardcoded) — shape:

```json
{
  "name": "authorizer-demo-agent",
  "version": "1.0.0",
  "supportedInterfaces": [
    { "url": "http://localhost:4002/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }
  ],
  "skills": [{ "id": "echo", "name": "Echo", "tags": ["demo", "echo"] }],
  "securitySchemes": {
    "authorizer_m2m": {
      "oauth2SecurityScheme": {
        "flows": {
          "clientCredentials": {
            "tokenUrl": "http://localhost:8080/oauth/token",
            "scopes": { "openid": "OpenID Connect identity" }
          }
        }
      }
    }
  },
  "security": [{ "authorizer_m2m": ["openid"] }]
}
```

The endpoint URL and protocol version live in `supportedInterfaces[]`
(v1.0 removed the 0.x top-level `url`/`protocolVersion` card fields). The wire
call is JSON-RPC 2.0 `SendMessage` whose `params.message` is a `Message`
(`messageId` + `role: "ROLE_USER"` + `parts`); the echo replies with a
`Message` (`role: "ROLE_AGENT"`).

## Run it

```sh
# 1. Start Authorizer (from the authorizer repo root)
make dev

# 2. Start the demo A2A agent
npm install
npm start

# 3. In another terminal, run the client walkthrough
npm run client
```

Environment overrides: `AUTHORIZER_URL` (default `http://localhost:8080`),
`AGENT_URL`/`PORT` (default `http://localhost:4002`), `ADMIN_SECRET`
(default `admin`, matches `make dev`'s default admin secret).
