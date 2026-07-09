// Shared auth helpers used by all three services.
//
// - verifier():        JWKS-based JWT verification (jose) with iss/aud checks.
// - requireAuth():     express middleware factory enforcing a verified Bearer
//                      token, optionally requiring service_account tokens with
//                      a given scope.
// - MachineTokenClient: fetches + caches a client_credentials token from
//                      POST /oauth/token (form-encoded, client_secret_post).
import { createRemoteJWKSet, jwtVerify } from "jose";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  // no .env yet (e.g. env passed via docker-compose) — that's fine
}

export const AUTHORIZER_URL = (process.env.AUTHORIZER_URL || "http://localhost:8080").replace(/\/$/, "");
export const AUTHORIZER_CLIENT_ID = process.env.AUTHORIZER_CLIENT_ID;
// Authorizer sets the token `iss` to the host the token request hit. When all
// parties reach Authorizer through the same URL this equals AUTHORIZER_URL;
// override EXPECTED_ISSUER if e.g. user tokens are minted via a different host
// (see README "issuer pitfall").
export const EXPECTED_ISSUER = process.env.EXPECTED_ISSUER || AUTHORIZER_URL;

// One remote JWKS per process; jose caches and re-fetches on unknown keys.
const JWKS = createRemoteJWKSet(new URL(`${AUTHORIZER_URL}/.well-known/jwks.json`));

// Verify signature + iss + aud. `aud` on every Authorizer-minted JWT (user or
// machine) is the instance's global client ID, NOT the per-service client_id.
export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: EXPECTED_ISSUER,
    audience: AUTHORIZER_CLIENT_ID,
  });
  return payload;
}

// Express middleware. opts:
//   machine: true  -> require a service_account (client_credentials) token
//   scope: "x:y"   -> require that scope. NOTE: Authorizer's `scope` claim is
//                     a JSON ARRAY of strings, not a space-delimited string.
export function requireAuth(opts = {}) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");
    if (type?.toLowerCase() !== "bearer" || !token) {
      return res.status(401).json({ error: "missing bearer token" });
    }
    let payload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      return res.status(401).json({ error: "invalid token", detail: err.code || err.message });
    }
    if (opts.machine && payload.login_method !== "service_account") {
      return res.status(403).json({ error: "machine (service_account) token required" });
    }
    if (opts.scope) {
      const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope || "").split(" ");
      if (!scopes.includes(opts.scope)) {
        return res.status(403).json({ error: `insufficient scope: '${opts.scope}' required`, granted: scopes });
      }
    }
    req.auth = payload;
    next();
  };
}

// client_credentials token fetcher with expiry-aware caching.
export class MachineTokenClient {
  constructor({ clientId, clientSecret, scope }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.scope = scope;
    this.token = null;
    this.expiresAt = 0;
  }

  async get() {
    // Refresh 30s before expiry.
    if (this.token && Date.now() < this.expiresAt - 30_000) return this.token;

    const res = await fetch(`${AUTHORIZER_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        // Request only the scope this call path needs — even below the
        // service's own ceiling (least privilege). Requesting anything
        // outside allowed_scopes fails with invalid_scope.
        scope: this.scope,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`token request failed: ${body.error}: ${body.error_description}`);
    }
    this.token = body.access_token;
    this.expiresAt = Date.now() + body.expires_in * 1000;
    return this.token;
  }
}
