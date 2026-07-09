#!/usr/bin/env node
// Admin one-time setup: register a machine client (service account) via the
// admin GraphQL API. Prints the client_id and the ONE-TIME client_secret.
//
// Usage:
//   AUTHORIZER_URL=http://localhost:8080 ADMIN_SECRET=admin node setup.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'admin';

const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Admin operations (the `_`-prefixed ones) authenticate with the admin secret.
    'x-authorizer-admin-secret': ADMIN_SECRET,
    // The server's CSRF guard requires an Origin (or Referer) on state-changing
    // requests; the server's own origin always passes.
    Origin: AUTHORIZER_URL,
  },
  body: JSON.stringify({
    query: `mutation ($params: CreateClientRequest!) {
      _create_client(params: $params) {
        client { id client_id name allowed_scopes is_active }
        client_secret
      }
    }`,
    variables: {
      params: {
        name: 'billing-worker',
        description: 'Nightly billing reconciliation job',
        // allowed_scopes is this client's authorization CEILING.
        // An empty list would be deny-all; at least one scope is required.
        allowed_scopes: ['read:invoices', 'write:reports'],
      },
    },
  }),
});

const { data, errors } = await res.json();
if (errors?.length) {
  console.error('GraphQL error:', errors[0].message);
  process.exit(1);
}

const { client, client_secret } = data._create_client;
console.log('Service account created.');
console.log('  client_id     :', client.client_id);
console.log('  allowed_scopes:', client.allowed_scopes.join(' '));
console.log('  client_secret :', client_secret);
console.log();
console.log('NOTE: the client_secret is shown ONCE — store it now.');
console.log('If lost, rotate it with the _rotate_client_secret mutation.');
console.log();
console.log('Run the worker with:');
console.log(`  CLIENT_ID=${client.client_id} CLIENT_SECRET=${client_secret} node worker.mjs`);
