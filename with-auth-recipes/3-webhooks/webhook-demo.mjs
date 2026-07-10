// Webhooks, end to end:
// 1. start a local HTTP receiver (in-process, plain node:http)
// 2. admin `_add_webhook` for the `user.signup` event → receiver URL
// 3. trigger a signup (signup + verify_email fires `user.signup`)
// 4. print the delivered payload and verify the `X-Authorizer-Signature`
//    header: HMAC-SHA256(hex) of the raw body, keyed with the client secret
//
// SSRF NOTE: Authorizer refuses webhook endpoints that resolve to loopback or
// private ranges (127/8, 10/8, 172.16/12, 192.168/16, ...). To test delivery
// on one machine, alias a benchmarking-range IP (198.18.0.0/15 — routable per
// the filter, but reserved and local-only) onto the loopback interface:
//
//   sudo ifconfig lo0 alias 198.18.0.1 255.255.255.255   # macOS
//   sudo ip addr add 198.18.0.1/32 dev lo                # Linux
//
// then the default endpoint http://198.18.0.1:4567/webhook works.
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  gql,
  adminHeaders,
  clearMailbox,
  waitForEmail,
  extractVerificationToken,
  randomEmail,
  CLIENT_SECRET,
} from '../lib/common.mjs';

const PORT = Number(process.env.RECEIVER_PORT ?? 4567);
const ENDPOINT = process.env.WEBHOOK_ENDPOINT ?? `http://198.18.0.1:${PORT}/webhook`;

// 1. Receiver: capture one delivery, verify its signature.
let resolveDelivery;
const delivery = new Promise((r) => (resolveDelivery = r));
const server = http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"received":true}');
      resolveDelivery({ raw, signature: req.headers['x-authorizer-signature'] });
    });
  })
  .listen(PORT, '0.0.0.0');
console.log(`receiver listening on 0.0.0.0:${PORT}, webhook endpoint: ${ENDPOINT}`);

const cleanupWebhook = async () => {
  const { data } = await gql(
    `query { _webhooks(params: {}) { webhooks { id endpoint } } }`,
    {},
    adminHeaders
  );
  for (const w of data._webhooks.webhooks.filter((w) => w.endpoint === ENDPOINT)) {
    await gql(
      `mutation ($params: WebhookRequest!) { _delete_webhook(params: $params) { message } }`,
      { params: { id: w.id } },
      adminHeaders
    );
  }
};

try {
  // 2. Register the webhook (admin-only op — authenticated via the
  // x-authorizer-admin-secret header).
  try {
    const { data } = await gql(
      `mutation ($params: AddWebhookRequest!) {
        _add_webhook(params: $params) { message }
      }`,
      {
        params: {
          event_name: 'user.signup',
          endpoint: ENDPOINT,
          enabled: true,
          headers: { 'x-demo': 'with-auth-recipes' },
        },
      },
      adminHeaders
    );
    console.log('_add_webhook:', data._add_webhook.message);
  } catch (err) {
    if (String(err).includes('private/internal networks')) {
      console.error(
        `\nThe server rejected ${ENDPOINT} (SSRF protection: no loopback/private IPs).\n` +
          'Alias a local IP the filter allows, then re-run:\n' +
          '  sudo ifconfig lo0 alias 198.18.0.1 255.255.255.255   # macOS\n' +
          '  sudo ip addr add 198.18.0.1/32 dev lo                # Linux'
      );
      process.exit(1);
    }
    throw err;
  }

  // 3. Trigger: sign up + verify a fresh user. With email verification on,
  // `user.signup` fires when the email is verified (`user.created` fires at
  // signup time, before verification).
  const email = randomEmail('webhook');
  const password = 'Obviously-Fake-Passw0rd!';
  await clearMailbox();
  await gql(
    `mutation ($params: SignUpRequest!) { signup(params: $params) { message } }`,
    { params: { email, password, confirm_password: password } }
  );
  const token = extractVerificationToken(await waitForEmail(email));
  await gql(
    `mutation ($params: VerifyEmailRequest!) { verify_email(params: $params) { message } }`,
    { params: { token } }
  );
  console.log('signup + verify_email done for', email);

  // 4. Wait for the delivery and verify the signature.
  const { raw, signature } = await Promise.race([
    delivery,
    new Promise((_, rej) => setTimeout(() => rej(new Error('no webhook delivery within 20s')), 20000)),
  ]);
  const payload = JSON.parse(raw);
  console.log('\nwebhook delivered:');
  console.log(JSON.stringify(payload, null, 2));

  const expected = createHmac('sha256', CLIENT_SECRET).update(raw).digest('hex');
  const ok =
    signature?.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  console.log(`\nX-Authorizer-Signature: ${signature}`);
  console.log(`signature valid (HMAC-SHA256 of body, keyed with client secret): ${ok}`);

  if (!ok) throw new Error('signature verification failed');
  if (payload.event_name !== 'user.signup') throw new Error('unexpected event_name');
  if (payload.user.email !== email) throw new Error('unexpected user in payload');
  console.log('\nOK: webhook flow complete — payload received and signature verified.');
} finally {
  await cleanupWebhook().catch(() => {});
  server.close();
}
