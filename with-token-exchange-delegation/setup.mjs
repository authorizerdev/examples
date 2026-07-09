#!/usr/bin/env node
// Admin one-time setup: register the AGENT's service account. Its
// allowed_scopes is the agent's DELEGATION CEILING — a delegated token can
// never carry a scope outside this list, no matter who the user is.
//
// Usage:
//   AUTHORIZER_URL=http://localhost:8080 ADMIN_SECRET=admin node setup.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'admin';

const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-authorizer-admin-secret': ADMIN_SECRET,
    // CSRF guard: state-changing requests need an Origin (or Referer) header.
    Origin: AUTHORIZER_URL,
  },
  body: JSON.stringify({
    query: `mutation ($params: CreateClientRequest!) {
      _create_client(params: $params) {
        client { client_id name allowed_scopes }
        client_secret
      }
    }`,
    variables: {
      params: {
        name: 'calendar-agent',
        description: 'AI agent that reads calendars on behalf of users',
        // Ceiling: the agent may never act with more than these, even when
        // delegating for an admin. Empty allowed_scopes would be deny-all.
        allowed_scopes: ['calendar:read', 'email'],
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
console.log('Agent service account created.');
console.log('  client_id        :', client.client_id);
console.log('  delegation ceiling:', client.allowed_scopes.join(' '));
console.log('  client_secret    :', client_secret, '(shown ONCE — store it)');
console.log();
console.log('Run the delegation flow with:');
console.log(`  AGENT_CLIENT_ID=${client.client_id} AGENT_CLIENT_SECRET=${client_secret} node delegate.mjs`);
