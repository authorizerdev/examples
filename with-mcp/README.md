# Authorizer + MCP: OAuth-protected Model Context Protocol server

This example shows **Authorizer as the OAuth authorization server protecting an
MCP server**. A small Node MCP server (official `@modelcontextprotocol/sdk`,
streamable HTTP transport) exposes two demo tools and accepts only bearer
tokens that Authorizer minted **for this specific server**.

```
┌──────────┐  1. POST /mcp (no token)   ┌─────────────────┐
│          │ ─────────────────────────► │                 │
│  MCP     │  ◄── 401 + WWW-Authenticate│  MCP server     │
│  client  │  2. GET /.well-known/      │  (this example) │
│  (agent) │     oauth-protected-       │  :4001          │
│          │     resource               │                 │
│          │ ─────────────────────────► │                 │
└────┬─────┘                            └────────┬────────┘
     │ 3. token request                          │ validates JWT:
     │    (resource=http://localhost:4001/mcp)   │ JWKS + iss + aud
     ▼                                           ▼
┌─────────────────────────────────────────────────────────┐
│  Authorizer :8080                                       │
│  /.well-known/openid-configuration   (AS metadata)      │
│  /.well-known/jwks.json              (signing keys)     │
│  /oauth/token                        (token endpoint)   │
└─────────────────────────────────────────────────────────┘
```

## How MCP auth maps onto plain OAuth

The MCP authorization spec is not a new protocol — it is OAuth 2.1 plus two
RFCs, split across two parties:

| Spec | What it says | Who implements it here |
|---|---|---|
| OAuth 2.1 | Bearer tokens, token endpoint, client auth | **Authorizer** (`/oauth/token`, JWKS, OIDC discovery) |
| RFC 9728 (protected resource metadata) | The resource server publishes `/.well-known/oauth-protected-resource` naming its `resource` URI and its `authorization_servers`, and points clients at it from a `401` `WWW-Authenticate` header | **the MCP server** (`mcp-server.mjs`) |
| RFC 8707 (resource indicators) | The client passes `resource=<MCP server URI>` when requesting a token; the AS binds the token's `aud` to it, so the token is useless against any other API | **Authorizer** binds it, **the MCP server** enforces it (`audience` check in JWT validation) |
| RFC 8693 (token exchange) | How an *agent* gets a token that says "agent X acting for user Y", with attenuated scopes and a nested `act` chain | **Authorizer** (`grant_type=...token-exchange` on `/oauth/token`) |

**What Authorizer provides out of the box**

- AS metadata via OIDC discovery (`/.well-known/openid-configuration`) — MCP
  clients accept this form of AS discovery.
- JWKS (`/.well-known/jwks.json`) for RS256 verification.
- `client_credentials` grant for machine identity (agent service accounts,
  registered via the dashboard or the `_create_client` admin API).
- **RFC 8693 token exchange with RFC 8707 resource binding**: exactly one
  `resource` parameter is required; the delegated token's `aud` is set to it,
  scopes are attenuated (`subject ∩ agent ceiling ∩ requested`), and the
  nested `act` claim records the delegation chain.

**What the MCP server implements (this example, ~150 lines)**

- RFC 9728 metadata endpoint + `WWW-Authenticate: Bearer resource_metadata="..."`
  on 401.
- JWT validation via Authorizer's JWKS with `issuer` **and** `audience`
  (= its own resource URI) enforced.
- Two tools: `whoami` (echoes the token's subject, scopes and `act`
  delegation chain) and `add`.

> Note: plain `client_credentials` and `authorization_code` tokens carry
> `aud = <deployment client_id>`, not a resource URI — the resource-bound
> path in Authorizer today is the token-exchange grant. That is exactly the
> agent-acting-for-user shape MCP is built for.

## Run it

**1. Start Authorizer** (from the `authorizer` repo — dev config uses SQLite,
admin secret `admin`, port 8080):

```bash
make dev
```

**2. Start the MCP server:**

```bash
npm install
npm start          # http://localhost:4001/mcp
```

**3. Run the walkthrough client:**

```bash
npm run client
```

It prints every step of the `401 -> discovery -> token -> 200` sequence:

```
[1] POST http://localhost:4001/mcp without a token -> HTTP 401
[1] WWW-Authenticate: Bearer resource_metadata="http://localhost:4001/.well-known/oauth-protected-resource", ...
[2] resource=http://localhost:4001/mcp authorization_servers=http://localhost:8080
[3] token_endpoint=http://localhost:8080/oauth/token
[4a] user mcp_demo_...@authorizer.dev signed up; subject_token acquired
[4b] agent service account registered: <client_id>
[4b] agent actor_token acquired via client_credentials
[4b] agent token (aud != MCP server) rejected -> HTTP 401
[4c] delegated token minted: aud=http://localhost:4001/mcp scope=[openid,email,profile] act.sub=<client_id>
[5] MCP connected. tools: whoami, add
[5] whoami -> { "sub": "<user id>", "scope": [...], "aud": "...", "acting_agents": ["<client_id>"] }
[5] add(20, 22) -> 42
Done: 401 -> discovery -> token -> 200.
```

Environment overrides: `AUTHORIZER_URL`, `PORT`, `RESOURCE` (server);
`MCP_URL`, `ADMIN_SECRET` (client).

## The same flow with curl

```bash
# 1. No token -> 401 with discovery pointer
curl -i -X POST http://localhost:4001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":0,"method":"ping"}'

# 2. Resource metadata -> who is the AS?
curl -s http://localhost:4001/.well-known/oauth-protected-resource

# 3. Token exchange: agent acts for the user, bound to the MCP server.
#    SUBJECT_TOKEN  = the user's access token (login/signup response)
#    AGENT_ID/SECRET= service-account credentials (dashboard -> Clients)
AGENT_TOKEN=$(curl -s -u "$AGENT_ID:$AGENT_SECRET" \
  -d grant_type=client_credentials \
  http://localhost:8080/oauth/token | jq -r .access_token)

ACCESS_TOKEN=$(curl -s -u "$AGENT_ID:$AGENT_SECRET" \
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token="$SUBJECT_TOKEN" \
  -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d actor_token="$AGENT_TOKEN" \
  -d actor_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d resource=http://localhost:4001/mcp \
  http://localhost:8080/oauth/token | jq -r .access_token)

# 4. Authenticated MCP call -> 200
curl -s -X POST http://localhost:4001/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

Swap the `resource` value for anything else and step 4 returns 401 —
that is RFC 8707 doing its job.

## Bonus: Authorizer's own built-in MCP server

Authorizer also *ships* an MCP server of its own, exposing a curated read-only
toolset — `meta`, `profile`, `check_permissions`, `list_permissions` — so an MCP
host can ask fine-grained authorization questions ("can this user view
document:1?") before acting.

Run it on the server you already run:

```sh
authorizer --url https://auth.example.com --mcp-enabled   # ...your other flags
```

`--url` is required with `--mcp-enabled`. It is what the audience of every token
presented at `/mcp` is checked against, and the server refuses to start without
it.

Then point a client at it — with a **static token**, which is the only path
verified to work today:

```sh
# Create a service account: dashboard → Identity → Clients
# Mint a token bound to the MCP resource (the `resource` param is the part
# people miss — without it the audience is the client id and /mcp rejects it)
ACCESS_TOKEN=$(curl -s -X POST https://auth.example.com/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=$CLIENT_ID -d client_secret=$CLIENT_SECRET \
  -d scope=openid -d resource=https://auth.example.com/mcp | jq -r .access_token)

claude mcp add --transport http authorizer https://auth.example.com/mcp \
  --header "Authorization: Bearer $ACCESS_TOKEN"
```

`claude mcp list` then reports **✔ Connected**.

> **The OAuth flow needs a self-registration flag turned on.** As of Claude Code
> 2.1.226 it refuses a server that advertises neither:
> *"Incompatible auth server: does not support dynamic client registration"* —
> and it does not fall back to a manually-supplied client id. Authorizer ships
> **both** mechanisms, off by default: Client ID Metadata Documents
> (`--enable-client-id-metadata-document`, preferred) and RFC 7591 DCR
> (`--enable-dynamic-client-registration`, for clients that predate CIMD —
> Claude Code reads `client_id_metadata_document_supported` and still requires a
> `registration_endpoint`). Enabling DCR does not downgrade anyone: the MCP
> spec's priority order is pre-registered → CIMD → DCR.

Note the static token identifies the **service account**, not a human, so
`profile` returns nothing useful and permission checks resolve to
`service_account:<client_id>`.

> The older `authorizer mcp` stdio subcommand still works but is **deprecated**
> and will be removed in 2.5.0. It ran a second copy of the whole server and
> served exactly one user per process, since its identity was a single
> `--mcp-bearer` flag.

See the [MCP Server docs](https://docs.authorizer.dev/core/mcp) for details.
So: **this example** = protecting *your* MCP tools with Authorizer-issued
tokens; **`--mcp-enabled`** = giving a model safe access to *Authorizer's*
identity/permission data.
