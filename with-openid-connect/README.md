# Authorizer as a standards-compliant OIDC provider

This example treats [Authorizer](https://authorizer.dev) as **just another OpenID
Provider**: a small Express app built on the certified
[`openid-client`](https://github.com/panva/openid-client) library (v6, pinned)
consumes it exactly the way it would consume Auth0, Okta, or Keycloak. No
Authorizer SDK, no Authorizer-specific endpoints.

## What "OIDC compliance" means here

The RP relies only on standard behavior, all of which Authorizer implements
(server source: `internal/http_handlers/{openid_config,authorize,token,userinfo,jwks,logout}.go`):

1. **Discovery** (OIDC Discovery 1.0) — `GET /.well-known/openid-configuration`
   publishes issuer + all endpoints; the RP hardcodes nothing but the issuer URL.
2. **Authorization Code + PKCE** (OIDC Core §3.1, RFC 7636) — `response_type=code`
   with `code_challenge_method=S256`, `state`, and `nonce`.
3. **Token endpoint** (RFC 6749 §4.1.3) — form-encoded code exchange;
   `openid-client` then validates the **ID token**: RS256 signature against
   `jwks_uri`, `iss`, `aud`, `exp`, and the `nonce` round-trip (OIDC Core §3.1.3.7).
   `at_hash` is present and checked too.
4. **UserInfo** (OIDC Core §5.3) — bearer `GET /userinfo`; the returned `sub` is
   verified against the ID token's `sub` (§5.3.2, a MUST).
5. **RP-initiated logout** (OIDC RP-Initiated Logout 1.0) — discovery advertises
   `end_session_endpoint`; the RP redirects there with `id_token_hint` +
   `post_logout_redirect_uri`. With a valid `id_token_hint` Authorizer logs the
   session out and 302s straight back — no confirmation page.

## Discovery values to expect

From a stock instance (`make dev`, `http://localhost:8080`):

| Field | Value |
|---|---|
| `issuer` | the URL the request hit (see pitfall #3) |
| `authorization_endpoint` | `{issuer}/authorize` |
| `token_endpoint` | `{issuer}/oauth/token` |
| `userinfo_endpoint` | `{issuer}/userinfo` |
| `jwks_uri` | `{issuer}/.well-known/jwks.json` |
| `end_session_endpoint` | `{issuer}/logout` |
| `code_challenge_methods_supported` | `["S256", "plain"]` |
| `id_token_signing_alg_values_supported` | configured `--jwt-type`, always incl. `RS256` |
| `token_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, `none` (public + PKCE), `private_key_jwt` |
| `response_modes_supported` | `query`, `fragment`, `form_post`, `web_message` |
| `scopes_supported` | `openid`, `email`, `profile`, `offline_access` |

## Run it

Prereqs: Node ≥ 20, an Authorizer server from `main`:

```bash
# in the authorizer server repo
make dev        # :8080, client-id/secret + allowed-origins preconfigured for :8090
```

Then:

```bash
npm install
cp .env.example .env   # make-dev defaults already filled in
npm start
# open http://localhost:8090 and click "Log in with Authorizer"
```

You'll land on Authorizer's hosted login page; after signup/login you're
redirected back and the page renders the validated ID-token claims and the
`/userinfo` response. "Log out (RP-initiated)" ends the session on both sides.

The RP client here is the instance's boot-seeded interactive client
(`--client-id`/`--client-secret`). The `.env.example` values are the public
`make dev` development defaults — replace them for any real deployment.

## Common pitfalls

1. **PKCE downgrades to `plain` when the method is omitted.** Per RFC 7636 §4.2
   an authorization request carrying `code_challenge` but no
   `code_challenge_method` means the `plain` method, and Authorizer follows the
   RFC (it exists for clients that can't compute SHA-256 — Auth0 sometimes omits
   the method, for example). If you hand-roll requests, **always send
   `code_challenge_method=S256` explicitly**; this example does
   (see `buildAuthorizationUrl` in [`server.js`](./server.js)).

2. **`form_post` breaks behind CSP-injecting proxies.** With
   `response_mode=form_post` Authorizer serves an auto-submitting HTML form with
   a purpose-built `Content-Security-Policy` (nonce-based `script-src`, relaxed
   `form-action`) so the browser may POST to your `redirect_uri`. A reverse
   proxy that injects its own CSP header on top will silently break the form
   submission. This example uses the default `query` response mode, which has no
   such failure mode.

3. **`issuer` follows the request host.** Authorizer derives `iss` (and all
   discovery URLs) from the host the request hit. Do discovery through the same
   URL end users use, or ID-token `iss` validation will fail — relevant behind
   proxies and inside docker networks.

4. **`redirect_uri` must be an allowed origin.** Authorizer validates
   `redirect_uri` against `--allowed-origins`; an unknown origin gets
   `invalid redirect_uri` at `/authorize`. `make dev` already allows
   `localhost:8090`; add your RP's host otherwise. The same list gates
   `post_logout_redirect_uri` — an invalid one is ignored (per the RP-Initiated
   Logout spec), not an error.

5. **Plain-HTTP issuers need an explicit opt-in.** `openid-client` v6 refuses
   `http://` by default; the demo passes `allowInsecureRequests` for
   localhost. Never do that against a production issuer.

## Files

```
server.js       the whole RP: discovery, /login, /callback, /logout (~150 lines)
.env.example    make-dev defaults (fake/dev credentials only)
```
