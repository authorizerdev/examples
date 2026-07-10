// Billing service (internal, most sensitive).
//
// Accepts charge requests ONLY from callers presenting a machine token whose
// verified `scope` claim contains billing:charge. Verification is local:
// JWKS signature check + iss + aud + login_method + scope — no network call
// to Authorizer on the hot path.
//
// Billing has its own registered identity (ceiling: billing:refund) even
// though it makes no outbound calls yet — identities are per-service, never
// shared, so future outbound calls don't inherit another service's blast
// radius.
import express from "express";
import { requireAuth } from "../lib/auth.js";

const PORT = Number(process.env.BILLING_PORT || 4002);

const charges = []; // ponytail: in-memory, demo only

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "billing" }));

app.post("/charges", requireAuth({ machine: true, scope: "billing:charge" }), (req, res) => {
  const { order_id, user_id, amount_cents } = req.body;
  if (!order_id || !user_id) {
    return res.status(400).json({ error: "order_id and user_id are required" });
  }
  const charge = {
    id: `ch_${charges.length + 1}`,
    order_id,
    user_id,
    amount_cents: amount_cents ?? 0,
    status: "succeeded",
    // Audit trail: the verified machine identity that requested the charge.
    charged_by_client: req.auth.sub,
    scopes_presented: req.auth.scope,
  };
  charges.push(charge);
  console.log(`charge ${charge.id} for ${order_id} by client ${req.auth.sub}`);
  res.status(201).json(charge);
});

app.listen(PORT, () => console.log(`billing-service listening on :${PORT}`));
