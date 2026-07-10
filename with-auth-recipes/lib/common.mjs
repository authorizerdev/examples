// Shared helpers for the auth recipes. Node 18+ (built-in fetch), no deps.

export const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'admin';
// Same throwaway dev secret run-server.sh passes as --client-secret.
// Webhook payloads are HMAC-signed with it.
export const CLIENT_SECRET =
  process.env.CLIENT_SECRET ??
  '60Op4HFM0I8ajz0WdiStAbziZ-VFQttXuxixHHs2R7r7-CW8GR79l-mmLqMhc-Sa';

// POST /graphql. The server's CSRF middleware requires an allow-listed Origin
// header plus Content-Type: application/json on every mutation.
// Returns { data, setCookies } — setCookies matters for the MFA session cookie.
export async function gql(query, variables = {}, headers = {}) {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: AUTHORIZER_URL,
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return { data: body.data, setCookies: res.headers.getSetCookie() };
}

// Admin operations (the `_`-prefixed ones) authenticate with this header
// (alternative: the authorizer-admin cookie set by _admin_login).
export const adminHeaders = { 'x-authorizer-admin-secret': ADMIN_SECRET };

// Turn Set-Cookie response headers into a Cookie request header value.
export function cookieHeader(setCookies) {
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

// ---------- Mailpit ----------

export async function clearMailbox() {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

// Poll Mailpit until an email addressed to `to` arrives; return the full
// message ({ Subject, HTML, Text, ... }).
export async function waitForEmail(to, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`
    );
    const { messages } = await res.json();
    if (messages?.length) {
      const full = await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`);
      return full.json();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to} arrived within ${timeoutMs}ms — is Mailpit up and the server started with the --smtp-* flags?`);
}

// Extract the /verify_email?token=... link from a verification email and
// return the token.
export function extractVerificationToken(message) {
  const body = `${message.HTML ?? ''}\n${message.Text ?? ''}`;
  const match = body.match(/verify_email\?token=([A-Za-z0-9\-_.~%]+)/);
  if (!match) throw new Error('No verification link found in email body');
  return decodeURIComponent(match[1]);
}

export function randomEmail(prefix) {
  return `${prefix}-${Date.now()}@example.com`;
}
