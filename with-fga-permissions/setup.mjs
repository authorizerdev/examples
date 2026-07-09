#!/usr/bin/env node
// Admin one-time setup: install the FGA authorization model (OpenFGA DSL)
// via the admin GraphQL mutation _fga_write_model.
//
// Usage:
//   AUTHORIZER_URL=http://localhost:8080 ADMIN_SECRET=admin node setup.mjs

const AUTHORIZER_URL = process.env.AUTHORIZER_URL ?? 'http://localhost:8080';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'admin';

// Document sharing, the "hello world" of ReBAC. Roles are concentric:
// one `owner` tuple also grants editor and viewer.
const dsl = `model
  schema 1.1

type user

type document
  relations
    define owner: [user]
    define editor: [user] or owner
    define viewer: [user] or editor
    define can_view: viewer
    define can_edit: editor
    define can_delete: owner`;

const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-authorizer-admin-secret': ADMIN_SECRET,
    // CSRF guard: state-changing requests need an Origin (or Referer) header.
    Origin: AUTHORIZER_URL,
  },
  body: JSON.stringify({
    query: `mutation ($params: FgaWriteModelInput!) { _fga_write_model(params: $params) { id } }`,
    variables: { params: { dsl } },
  }),
});

const { data, errors } = await res.json();
if (errors?.length) {
  console.error('GraphQL error:', errors[0].message);
  process.exit(1);
}
console.log('Authorization model installed, id:', data._fga_write_model.id);
console.log('Now run: node demo.mjs');
