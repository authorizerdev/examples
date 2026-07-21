// An A2A (Agent2Agent v1.0) agent that publishes a spec-shaped Agent Card and
// authenticates callers as an ordinary OAuth2 resource server — exactly what
// the A2A spec asks of it (§7.4 "Server Authentication Responsibilities").
//
// A2A does not define its own token format or a registry: the Agent Card's
// `securitySchemes` map holds A2A SecurityScheme objects (modeled on OpenAPI
// 3.x but encoded as a `oneof` — the scheme kind is the JSON key, e.g.
// `oauth2SecurityScheme`), and the server just validates whatever bearer token
// that scheme promises. Here
// that's Authorizer's client_credentials grant — an agent authenticating as
// itself. (A delegated "agent acting for a user" call would use the same
// bearer check against a token minted via RFC 8693 token exchange instead —
// see ../with-agent-delegation — the Agent Card and this server don't care
// which grant produced the token, only that it's a valid Authorizer-issued
// bearer.)
//
// Agent Card signing (A2A spec §8.4) is OPTIONAL and uses the agent's own
// key, independent of the OAuth2 scheme in securitySchemes — Authorizer has
// no role in it, so this example doesn't sign the card.

import express from "express";
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = Number(process.env.PORT || 4002);
const AUTHORIZER_URL = process.env.AUTHORIZER_URL || "http://localhost:8080";
const AGENT_URL = process.env.AGENT_URL || `http://localhost:${PORT}`;

const oidc = await (
  await fetch(`${AUTHORIZER_URL}/.well-known/openid-configuration`)
).json();
const jwks = createRemoteJWKSet(new URL(oidc.jwks_uri));
console.log(`[a2a-agent] trusting issuer ${oidc.issuer}, token endpoint ${oidc.token_endpoint}`);

// --- A2A v1.0 Agent Card ----------------------------------------------------
// https://a2a-protocol.org/latest/specification/ — well-known path is
// /.well-known/agent-card.json (older drafts/SDKs used /.well-known/agent.json;
// that path is legacy, don't build against it).
const A2A_ENDPOINT = `${AGENT_URL}/a2a`;

const agentCard = {
  name: "authorizer-demo-agent",
  description: "Demo A2A agent that echoes a message, protected by Authorizer",
  version: "1.0.0",
  // v1.0 moved the endpoint URL + protocol version off the card top level into
  // supportedInterfaces[] (AgentInterface). The 0.x top-level `url` and
  // `protocolVersion` fields were removed.
  supportedInterfaces: [
    { url: A2A_ENDPOINT, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  ],
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  },
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],
  skills: [
    {
      id: "echo",
      name: "Echo",
      description: "Echoes back the provided text",
      tags: ["demo", "echo"],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    },
  ],
  // securitySchemes / security reuse the OpenAPI 3.x Security Scheme Object —
  // A2A does not invent its own auth format.
  securitySchemes: {
    authorizer_m2m: {
      // v1.0 SecurityScheme is a `oneof scheme`: the kind is the JSON key
      // (oauth2SecurityScheme), not a `type` discriminator field.
      oauth2SecurityScheme: {
        description: "Agent authenticates as itself via OAuth2 client_credentials.",
        flows: {
          clientCredentials: {
            tokenUrl: oidc.token_endpoint,
            scopes: { openid: "OpenID Connect identity" },
          },
        },
      },
    },
  },
  security: [{ authorizer_m2m: ["openid"] }],
};

// Scopes the card's `security` requirement demands — enforced on every call.
const requiredScopes = [
  ...new Set(agentCard.security.flatMap((r) => Object.values(r).flat())),
];

const app = express();
app.use(express.json());

app.get("/.well-known/agent-card.json", (_req, res) => res.json(agentCard));

// --- Bearer validation (A2A §7.4: servers MUST authenticate using one of
// the schemes declared in the card) -----------------------------------------
async function requireBearer(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "invalid_token", error_description: "Missing bearer token" });
  }
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: oidc.issuer });
    // A2A doesn't require RFC 8707 audience binding (unlike MCP), but the card
    // declares a `security` scope requirement, so honour it: reject a token
    // that doesn't carry the scope(s) the card demands.
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : payload.scope ?? [];
    const missing = requiredScopes.filter((s) => !scopes.includes(s));
    if (missing.length) {
      return res.status(403).json({
        error: "insufficient_scope",
        error_description: `token missing required scope(s): ${missing.join(" ")}`,
        scope: requiredScopes.join(" "),
      });
    }
    req.claims = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: "invalid_token", error_description: err.message });
  }
}

// --- A2A wire protocol: JSON-RPC 2.0 -----------------------------------------
app.post("/a2a", requireBearer, (req, res) => {
  const { id, method, params } = req.body;
  // v1.0 JSON-RPC method names mirror the gRPC service (§9): PascalCase.
  if (method !== "SendMessage") {
    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
  // SendMessageRequest.message is REQUIRED and is a Message with parts.
  const incoming = params?.message;
  if (!incoming?.parts) {
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: "Invalid params: message.parts is required" },
    });
  }
  const text = incoming.parts.map((p) => p.text).filter(Boolean).join(" ");
  // Spec §9.4.1 (verbatim): "result" is a SendMessageResponse that wraps ONE
  // of "task" or "message" — never a raw Message under "result" directly. A
  // stateless echo returns the "message" branch. Demo-only identity fields
  // ride along in the Message's optional metadata.
  res.json({
    jsonrpc: "2.0",
    id,
    result: {
      message: {
        messageId: randomUUID(),
        role: "ROLE_AGENT",
        parts: [{ text }],
        metadata: { authenticatedAs: req.claims.sub, scope: req.claims.scope },
      },
    },
  });
});

app.listen(PORT, () => {
  console.log(`[a2a-agent] listening on ${AGENT_URL}`);
  console.log(`[a2a-agent] agent card: ${AGENT_URL}/.well-known/agent-card.json`);
});
