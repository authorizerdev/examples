// Orders service (internal).
//
// Inbound: accepts only machine tokens carrying the orders:* scopes (in this
// topology that means the gateway — it is the only client whose
// allowed_scopes ceiling contains them).
// Outbound: charges the order through billing-service using its OWN
// client_credentials token (scope billing:charge). It cannot mint anything
// else: its allowed_scopes ceiling is exactly ["billing:charge"], so a
// compromised orders-service can never obtain e.g. billing:refund.
import express from "express";
import { requireAuth, MachineTokenClient } from "../lib/auth.js";

const PORT = Number(process.env.ORDERS_PORT || 4001);
const BILLING_URL = process.env.BILLING_URL || "http://localhost:4002";

const billingToken = new MachineTokenClient({
  clientId: process.env.ORDERS_CLIENT_ID,
  clientSecret: process.env.ORDERS_CLIENT_SECRET,
  scope: "billing:charge",
});

const orders = []; // ponytail: in-memory store, this is an auth demo not a shop

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "orders" }));

app.post("/orders", requireAuth({ machine: true, scope: "orders:write" }), async (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(400).json({ error: "X-User-Id header required" });

  const order = {
    id: `ord_${orders.length + 1}`,
    user_id: userId,
    item: req.body.item || "unknown",
    amount_cents: req.body.amount_cents ?? 0,
    status: "pending",
    // Which machine identity created this row — the verified `sub` of the
    // caller's token (the service account's internal id), for audit.
    created_by_client: req.auth.sub,
  };

  // Service-to-service hop: orders' own identity, not the gateway's.
  let token;
  try {
    token = await billingToken.get();
  } catch (err) {
    return res.status(502).json({ error: "billing token acquisition failed", detail: err.message });
  }
  const chargeRes = await fetch(`${BILLING_URL}/charges`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ order_id: order.id, user_id: userId, amount_cents: order.amount_cents }),
  });
  const charge = await chargeRes.json();
  if (!chargeRes.ok) {
    return res.status(502).json({ error: "charge failed", detail: charge });
  }

  order.status = "charged";
  order.charge_id = charge.id;
  orders.push(order);
  res.status(201).json(order);
});

app.get("/orders", requireAuth({ machine: true, scope: "orders:read" }), (req, res) => {
  const userId = req.query.user_id;
  res.json(orders.filter((o) => !userId || o.user_id === userId));
});

app.listen(PORT, () => console.log(`orders-service listening on :${PORT}`));
