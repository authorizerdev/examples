// A third-party Relying Party (RP) using Authorizer purely as a
// standards-compliant OpenID Connect provider — nothing Authorizer-specific,
// only what any certified OP exposes:
//
//   1. Discovery:      GET  /.well-known/openid-configuration
//   2. Authorization:  GET  /authorize   (code flow + PKCE S256 + nonce + state)
//   3. Token:          POST /oauth/token (code exchange; ID-token validated)
//   4. UserInfo:       GET  /userinfo
//   5. RP-initiated logout: GET /logout  (end_session_endpoint + id_token_hint)
//
// Built on openid-client v6, which performs the OIDC Core §3.1.3.7 ID-token
// validation (iss, aud, exp, signature via jwks_uri, nonce) for us.
import { randomBytes } from "node:crypto";
import express from "express";
import * as oidc from "openid-client";

try {
  process.loadEnvFile(new URL("./.env", import.meta.url).pathname);
} catch {
  // no .env — rely on real env vars / defaults below
}

const ISSUER = process.env.ISSUER || "http://localhost:8080";
const CLIENT_ID = process.env.CLIENT_ID || "kbyuFDidLLm280LIwVFiazOqjO3ty8KH";
const CLIENT_SECRET =
  process.env.CLIENT_SECRET ||
  "60Op4HFM0I8ajz0WdiStAbziZ-VFQttXuxixHHs2R7r7-CW8GR79l-mmLqMhc-Sa"; // make-dev default, demo only
const RP_PORT = Number(process.env.RP_PORT || 8090);
const RP_BASE_URL = process.env.RP_BASE_URL || `http://localhost:${RP_PORT}`;
const REDIRECT_URI = `${RP_BASE_URL}/callback`;

// --- 1. Discovery -----------------------------------------------------------
// Fetches /.well-known/openid-configuration and pins issuer + endpoints.
// allowInsecureRequests is required because this demo talks plain http to
// localhost; never use it against a production (https) issuer.
const config = await oidc.discovery(new URL(ISSUER), CLIENT_ID, CLIENT_SECRET, undefined, {
  execute: [oidc.allowInsecureRequests],
});
const meta = config.serverMetadata();
console.log("discovered OP:", {
  issuer: meta.issuer,
  authorization_endpoint: meta.authorization_endpoint,
  token_endpoint: meta.token_endpoint,
  userinfo_endpoint: meta.userinfo_endpoint,
  jwks_uri: meta.jwks_uri,
  end_session_endpoint: meta.end_session_endpoint,
  code_challenge_methods_supported: meta.code_challenge_methods_supported,
});

// --- tiny cookie session (demo only) ----------------------------------------
// ponytail: in-memory Map keyed by a random sid cookie; use a real session
// store for anything beyond a demo.
const sessions = new Map();
function session(req, res) {
  let sid = (req.headers.cookie || "").match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  if (!sid || !sessions.has(sid)) {
    sid = randomBytes(16).toString("hex");
    sessions.set(sid, {});
    res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  }
  return sessions.get(sid);
}

const app = express();

app.get("/", (req, res) => {
  const s = session(req, res);
  if (!s.claims) {
    return res.send(`<h1>OIDC RP demo</h1><p>Not logged in.</p><a href="/login">Log in with Authorizer</a>`);
  }
  res.send(
    `<h1>Hello ${s.claims.email || s.claims.sub}</h1>
     <h2>ID-token claims</h2><pre>${JSON.stringify(s.claims, null, 2)}</pre>
     <h2>/userinfo response</h2><pre>${JSON.stringify(s.userinfo, null, 2)}</pre>
     <a href="/logout">Log out (RP-initiated)</a>`,
  );
});

// --- 2. Authorization request ------------------------------------------------
app.get("/login", async (req, res) => {
  const s = session(req, res);

  // Fresh single-use values per attempt (OIDC Core §3.1.2.1 / RFC 7636).
  s.code_verifier = oidc.randomPKCECodeVerifier();
  s.state = oidc.randomState();
  s.nonce = oidc.randomNonce();
  const code_challenge = await oidc.calculatePKCECodeChallenge(s.code_verifier);

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    state: s.state,
    nonce: s.nonce,
    code_challenge,
    // ALWAYS send the method explicitly. RFC 7636 §4.2 says an omitted
    // code_challenge_method means `plain`, and Authorizer follows the RFC —
    // omitting this line silently downgrades your PKCE to plain.
    code_challenge_method: "S256",
  });
  res.redirect(url.href);
});

// --- 3. Callback: code -> tokens, ID token validated -------------------------
app.get("/callback", async (req, res) => {
  const s = session(req, res);
  try {
    const currentUrl = new URL(req.originalUrl, RP_BASE_URL);
    // Verifies state, exchanges the code (PKCE verifier + client_secret),
    // then validates the ID token: signature against jwks_uri, iss, aud,
    // exp, and the nonce we sent at /login.
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: s.code_verifier,
      expectedState: s.state,
      expectedNonce: s.nonce,
    });
    s.claims = tokens.claims();
    s.id_token = tokens.id_token;

    // --- 4. UserInfo ---------------------------------------------------------
    // openid-client checks the returned `sub` against the ID token's sub
    // (OIDC Core §5.3.2 — MUST verify).
    s.userinfo = await oidc.fetchUserInfo(config, tokens.access_token, s.claims.sub);

    delete s.code_verifier;
    delete s.state;
    delete s.nonce;
    res.redirect("/");
  } catch (err) {
    console.error("callback failed:", err);
    res.status(500).send(`<pre>Login failed: ${err.message}</pre><a href="/login">retry</a>`);
  }
});

// --- 5. RP-initiated logout (OIDC RP-Initiated Logout 1.0) -------------------
// Authorizer advertises end_session_endpoint (= /logout) in discovery.
// id_token_hint proves which session to end; post_logout_redirect_uri must be
// an allowed origin on the OP or it is ignored.
app.get("/logout", (req, res) => {
  const s = session(req, res);
  const idToken = s.id_token;
  for (const k of Object.keys(s)) delete s[k];
  if (!idToken || !meta.end_session_endpoint) return res.redirect("/");
  const url = oidc.buildEndSessionUrl(config, {
    id_token_hint: idToken,
    post_logout_redirect_uri: RP_BASE_URL,
  });
  res.redirect(url.href);
});

app.listen(RP_PORT, () => {
  console.log(`RP listening on ${RP_BASE_URL} — open ${RP_BASE_URL}/ and click "Log in"`);
});
