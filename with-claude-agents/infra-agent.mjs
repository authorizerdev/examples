// The infra agent: a resource server that ALSO happens to be a Claude agent.
//
// It is the one that actually decides whether the requested action is
// allowed — not the assistant, and not whichever agent asked nicest. It:
//   1. Validates the bearer token locally (JWKS, issuer, audience bound to
//      this server per RFC 8707) — same pattern as an MCP resource server.
//      This token's `sub` is the real user: RFC 8693 delegation keeps `sub`
//      fixed to the user throughout the chain, no matter which agent acted.
//   2. Asks Authorizer's check_permissions for that user, as itself. It
//      CANNOT simply forward the delegated token as its own bearer —
//      Authorizer's own API requires `aud` to be Authorizer's own client_id,
//      and this token's `aud` is deliberately THIS server (RFC 8707), so
//      Authorizer would reject it. Instead the infra agent authenticates to
//      Authorizer with its own admin/service credential and asks explicitly
//      "does user:<sub> have can_deploy on this environment?" — the same
//      shape any resource server backed by a shared authorization service
//      would use once it has already validated the caller's token itself.
//   3. Only on a passing check does it ask Claude to narrate an execution
//      plan and "run" the (simulated) action.
//
// Requirements: Authorizer running (`make dev`), ANTHROPIC_API_KEY set.

import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { query } from "@anthropic-ai/claude-agent-sdk";

const PORT = Number(process.env.PORT || 4041);
const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? "http://localhost:8080";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "admin";
// RFC 8707 resource identifier of THIS server. Delegated tokens must carry it as `aud`.
const RESOURCE = process.env.RESOURCE ?? `http://localhost:${PORT}/deploy`;

const oidc = await (await fetch(`${AUTHORIZER_URL}/.well-known/openid-configuration`)).json();
const jwks = createRemoteJWKSet(new URL(oidc.jwks_uri));
console.log(`[infra-agent] trusting issuer ${oidc.issuer}`);

const app = express();
app.use(express.json());

async function requireBearer(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "invalid_token", error_description: "Missing bearer token" });
  }
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: oidc.issuer, audience: RESOURCE });
    if (!payload.scope?.includes("infra:write")) {
      return res.status(403).json({ error: "insufficient_scope", error_description: "infra:write required" });
    }
    req.token = auth.slice(7);
    req.claims = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token", error_description: err.message });
  }
}

// Admin-authenticated check, with an explicit `user` naming the SUBJECT of
// the already-locally-validated delegated token — not the infra agent, not
// whichever agent called. Authorizer honors an explicit `user` override only
// for a super-admin caller (which the admin secret makes this), so the check
// stays keyed to the real human throughout, matching internal/service/fga.go.
async function canDeploy(userId, environment) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: AUTHORIZER_URL, "x-authorizer-admin-secret": ADMIN_SECRET },
    body: JSON.stringify({
      query: `query ($p: CheckPermissionsInput!) {
        check_permissions(params: $p) { results { relation object allowed } }
      }`,
      variables: { p: { user: `user:${userId}`, checks: [{ relation: "can_deploy", object: `environment:${environment}` }] } },
    }),
  });
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data.check_permissions.results[0].allowed;
}

app.post("/deploy", requireBearer, async (req, res) => {
  try {
    const { action, service, environment, replicas } = req.body ?? {};
    if (!action || !service || !environment) {
      return res.status(400).json({ error: "invalid_request", error_description: "action, service, environment are required" });
    }

    const allowed = await canDeploy(req.claims.sub, environment);
    console.log(
      `[infra-agent] user=${req.claims.sub} act=${req.claims.act?.sub ?? "-"} ` +
        `can_deploy(environment:${environment}) -> ${allowed}`
    );
    if (!allowed) {
      return res.status(403).json({
        error: "permission_denied",
        error_description: `user is not an admin of environment:${environment}`,
      });
    }

    // Only on a passing check: ask Claude to narrate the (simulated) action.
    let plan = "";
    for await (const message of query({
      prompt:
        `Write a short (2-3 sentence) execution plan for a DevOps action, as if you just ran it. ` +
        `action=${action} service=${service} environment=${environment}${replicas ? ` replicas=${replicas}` : ""}. ` +
        `This is simulated — do not claim to have touched any real infrastructure.`,
      options: { systemPrompt: "You narrate DevOps actions concisely for an audit log. No preamble." },
    })) {
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) {
        if (block.type === "text") plan += block.text;
      }
    }

    console.log(`[infra-agent] SIMULATED ${action} on ${service} (${environment}) — no real infrastructure touched.`);
    res.json({ status: "ok", simulated: true, action, service, environment, replicas, plan });
  } catch (err) {
    console.error(`[infra-agent] /deploy failed: ${err.message}`);
    res.status(502).json({ error: "server_error", error_description: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[infra-agent] listening on http://localhost:${PORT}/deploy`);
});
