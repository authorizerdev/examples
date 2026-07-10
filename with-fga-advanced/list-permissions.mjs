// "What can each persona access?" — list_permissions per persona, called with
// their own token (subject pinned server-side); ci-bot via super-admin with an
// explicit subject. Filtered to documents they can view, then everything.
import { gql, adminGql, loginOrSignup, PERSONAS, BASE, ADMIN_SECRET } from "./api.mjs";

console.log(`Authorizer: ${BASE}\n`);

const LIST = `query ($p: ListPermissionsInput!) {
  list_permissions(params: $p) { permissions { relation object } truncated }
}`;

async function show(persona, params, headers) {
  const d = await gql(LIST, { p: params }, headers);
  const byObject = {};
  for (const { relation, object } of d.list_permissions.permissions) {
    (byObject[object] ??= []).push(relation);
  }
  console.log(`${persona}:`);
  const objects = Object.keys(byObject).sort();
  if (objects.length === 0) console.log("  (nothing)");
  for (const o of objects) console.log(`  ${o.padEnd(26)} ${byObject[o].sort().join(", ")}`);
  if (d.list_permissions.truncated) console.log("  …truncated");
  console.log();
}

console.log('== "Which documents can you view?" (relation + object_type filter) ==\n');
for (const name of PERSONAS) {
  const { access_token } = await loginOrSignup(name);
  await show(name, { relation: "can_view", object_type: "document" }, { Authorization: `Bearer ${access_token}` });
}
await show(
  "ci-bot",
  { user: "service_account:ci-bot", relation: "can_view", object_type: "document" },
  { "x-authorizer-admin-secret": ADMIN_SECRET }
);

console.log("== Everything a persona holds (no filter) — bob and erin ==\n");
for (const name of ["bob", "erin"]) {
  const { access_token } = await loginOrSignup(name);
  await show(name, {}, { Authorization: `Bearer ${access_token}` });
}
