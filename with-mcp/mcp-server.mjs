// MCP server protected by Authorizer.
//
// Implements the resource-server half of the MCP authorization spec:
//   - RFC 9728 protected-resource metadata pointing at Authorizer (the AS)
//   - 401 + WWW-Authenticate: Bearer resource_metadata="..." for discovery
//   - Bearer JWT validation via Authorizer's JWKS (issuer + audience bound
//     to this resource per RFC 8707)
//
// Authorizer provides the authorization-server half: OIDC discovery, JWKS,
// and /oauth/token (client_credentials + RFC 8693 token exchange, which is
// where the RFC 8707 `resource` parameter binds `aud` to this server).

import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 4001);
const AUTHORIZER_URL = process.env.AUTHORIZER_URL || "http://localhost:8080";
// RFC 8707 resource identifier of THIS server. Tokens must carry it as `aud`.
const RESOURCE = process.env.RESOURCE || `http://localhost:${PORT}/mcp`;
const METADATA_URL = `http://localhost:${PORT}/.well-known/oauth-protected-resource`;

// Discover issuer + JWKS from Authorizer's OIDC metadata (no hardcoding).
const oidc = await (
  await fetch(`${AUTHORIZER_URL}/.well-known/openid-configuration`)
).json();
const jwks = createRemoteJWKSet(new URL(oidc.jwks_uri));
console.log(`[mcp-server] trusting issuer ${oidc.issuer}, jwks ${oidc.jwks_uri}`);

const app = express();
app.use(express.json());

// --- RFC 9728: protected resource metadata --------------------------------
const metadata = {
  resource: RESOURCE,
  authorization_servers: [oidc.issuer],
  bearer_methods_supported: ["header"],
  scopes_supported: ["openid", "email", "profile"],
};
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(metadata));
// Path-suffixed variant (RFC 9728 §3 for resource URIs with a path, e.g. /mcp).
app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(metadata));

// --- Bearer validation -----------------------------------------------------
function unauthorized(res, description) {
  res
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${METADATA_URL}", error="invalid_token", error_description="${description}"`
    )
    .status(401)
    .json({ error: "invalid_token", error_description: description });
}

async function requireBearer(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return unauthorized(res, "Missing bearer token");
  }
  try {
    // issuer: Authorizer signed it; audience: token is bound to THIS resource
    // (RFC 8707) — a token minted for another API is rejected here.
    const { payload } = await jwtVerify(auth.slice(7), jwks, {
      issuer: oidc.issuer,
      audience: RESOURCE,
    });
    req.claims = payload;
    next();
  } catch (err) {
    return unauthorized(res, err.message);
  }
}

// --- MCP server (streamable HTTP, stateless JSON mode) ---------------------
function buildServer(claims) {
  const server = new McpServer({ name: "authorizer-demo-mcp", version: "1.0.0" });

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Identity carried by the validated bearer token: subject, scopes, audience and the RFC 8693 delegation (act) chain.",
      inputSchema: {},
    },
    async () => {
      // Render the nested act chain agent > sub-agent > ...
      const chain = [];
      for (let a = claims.act; a; a = a.act) chain.push(a.sub);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sub: claims.sub,
                scope: claims.scope,
                aud: claims.aud,
                acting_agents: chain,
                issued_by: claims.iss,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "add",
    {
      title: "Add two numbers",
      description: "Demo tool: returns a + b.",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] })
  );

  return server;
}

app.post("/mcp", requireBearer, async (req, res) => {
  // Stateless: fresh server + transport per request, no session tracking.
  // ponytail: fine for a demo; use sessionIdGenerator + a session map for
  // long-lived stateful connections.
  const server = buildServer(req.claims);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // plain JSON responses -> curl-friendly
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Stateless server: no SSE stream to resume, no session to delete.
app.get("/mcp", (_req, res) => res.status(405).json({ error: "method not allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "method not allowed" }));

app.listen(PORT, () => {
  console.log(`[mcp-server] listening on http://localhost:${PORT}/mcp`);
  console.log(`[mcp-server] resource metadata at ${METADATA_URL}`);
});
