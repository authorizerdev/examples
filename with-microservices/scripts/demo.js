// End-to-end demo:
//   1. signup/login a demo user via Authorizer GraphQL -> user access token
//   2. POST /api/orders at the gateway with the USER token
//   3. gateway -> orders (gateway machine token) -> billing (orders machine token)
//   4. GET /api/orders back through the gateway
//   5. negative checks: no token, and a machine token used outside its scope
import { MachineTokenClient } from "../lib/auth.js";

const AUTHORIZER_URL = (process.env.AUTHORIZER_URL || "http://localhost:8080").replace(/\/$/, "");
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:4000";
const BILLING_URL = process.env.BILLING_URL || "http://localhost:4002";

const EMAIL = process.env.DEMO_EMAIL || `demo.user+${Date.now()}@example.com`;
const PASSWORD = "Demo_password_123!"; // obviously-fake demo credential

async function graphql(query, variables) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    // CSRF middleware requires an allow-listed Origin + JSON content type.
    headers: { "Content-Type": "application/json", Origin: AUTHORIZER_URL },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

// 1. user token
console.log(`1) signing up demo user ${EMAIL}`);
const signup = await graphql(
  `mutation ($params: SignUpRequest!) {
     signup(params: $params) { access_token user { id email } }
   }`,
  { params: { email: EMAIL, password: PASSWORD, confirm_password: PASSWORD } },
);
const userToken = signup.signup.access_token;
console.log(`   user ${signup.signup.user.id} — got user access token`);

// 2. create an order through the gateway
console.log("2) POST /api/orders (user token)");
let res = await fetch(`${GATEWAY_URL}/api/orders`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
  body: JSON.stringify({ item: "mechanical keyboard", amount_cents: 12900 }),
});
const order = await res.json();
console.log(`   ${res.status}`, order);
if (res.status !== 201) throw new Error("order creation failed");

// 3. list orders
console.log("3) GET /api/orders (user token)");
res = await fetch(`${GATEWAY_URL}/api/orders`, {
  headers: { Authorization: `Bearer ${userToken}` },
});
console.log(`   ${res.status}`, await res.json());

// 4. negative: no token at the edge
res = await fetch(`${GATEWAY_URL}/api/orders`);
console.log(`4) GET /api/orders without token -> ${res.status} (expect 401)`);
if (res.status !== 401) throw new Error("expected 401");

// 5. negative: gateway's machine token (orders:* scopes) must NOT be able to
//    charge billing directly — billing requires billing:charge.
const gatewayToken = new MachineTokenClient({
  clientId: process.env.GATEWAY_CLIENT_ID,
  clientSecret: process.env.GATEWAY_CLIENT_SECRET,
  scope: "orders:read",
});
res = await fetch(`${BILLING_URL}/charges`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await gatewayToken.get()}`,
  },
  body: JSON.stringify({ order_id: "ord_x", user_id: "u_x", amount_cents: 1 }),
});
console.log(`5) gateway token vs billing /charges -> ${res.status} (expect 403)`, await res.json());
if (res.status !== 403) throw new Error("expected 403");

// 6. negative: orders' identity cannot even MINT a token outside its ceiling.
const overreach = await fetch(`${AUTHORIZER_URL}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.ORDERS_CLIENT_ID,
    client_secret: process.env.ORDERS_CLIENT_SECRET,
    scope: "billing:refund", // outside orders' allowed_scopes
  }),
});
const overreachBody = await overreach.json();
console.log(`6) orders requests billing:refund -> ${overreach.status} ${overreachBody.error} (expect 400 invalid_scope)`);
if (overreachBody.error !== "invalid_scope") throw new Error("expected invalid_scope");

console.log("\nAll checks passed.");
