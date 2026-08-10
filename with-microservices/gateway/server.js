// Public API gateway.
//
// Trust boundary: this is the ONLY service exposed to end users. It verifies
// the USER's JWT (issued by Authorizer via login) against the JWKS endpoint,
// then calls orders-service using its OWN machine identity — the user token
// never crosses into the internal network. User context travels as an
// X-User-* header pair that orders-service accepts only alongside a valid
// gateway machine token.
import express from "express";
import { requireAuth, MachineTokenClient } from "../lib/auth.js";

const PORT = Number(process.env.GATEWAY_PORT || 4000);
const ORDERS_URL = process.env.ORDERS_URL || "http://localhost:4001";

const ordersToken = new MachineTokenClient({
  clientId: process.env.GATEWAY_CLIENT_ID,
  clientSecret: process.env.GATEWAY_CLIENT_SECRET,
  scope: "orders:read orders:write", // ⊆ gateway's allowed_scopes ceiling
});

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "gateway" }));

// End-user endpoints: require a verified USER token (any Authorizer login —
// GraphQL login/signup, OAuth code flow, magic link...).
app.post("/api/orders", requireAuth(), async (req, res) => {
  const token = await ordersToken.get();
  const upstream = await fetch(`${ORDERS_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // User context, asserted by the gateway after verifying the user JWT.
      //
      // `sub` is the only identity claim an access token is required to
      // carry — profile claims like email live in the ID token and at
      // /userinfo, and Authorizer does not put them here. Downstream
      // services should key on the id; fetch the profile from /userinfo if
      // they genuinely need one, rather than trusting a header that only
      // sometimes has a value.
      "X-User-Id": req.auth.sub,
    },
    body: JSON.stringify(req.body),
  });
  res.status(upstream.status).json(await upstream.json());
});

app.get("/api/orders", requireAuth(), async (req, res) => {
  const token = await ordersToken.get();
  const upstream = await fetch(`${ORDERS_URL}/orders?user_id=${encodeURIComponent(req.auth.sub)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  res.status(upstream.status).json(await upstream.json());
});

app.listen(PORT, () => console.log(`gateway listening on :${PORT}`));
