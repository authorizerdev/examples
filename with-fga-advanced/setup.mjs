// Installs the authorization model and seeds the demo org. Idempotent: it
// resets the FGA store first (model + ALL tuples — do not run against a store
// you care about), then writes everything fresh.
import { readFileSync, writeFileSync } from "node:fs";
import { adminGql, loginOrSignup, PERSONAS, emailFor, BASE } from "./api.mjs";

console.log(`Authorizer: ${BASE}\n`);

// 1. Reset the FGA store so re-runs start clean. _fga_reset is deliberately
// guarded — it refuses while any tuples exist (so live grants can't be
// silently dropped) — so drain all tuples first.
let drained = 0;
for (;;) {
  // read the first page, delete it, repeat until the store is empty
  const d = await adminGql(
    `query ($p: FgaReadTuplesInput!) {
      _fga_read_tuples(params: $p) { tuples { user relation object } }
    }`,
    { p: { page_size: 100 } }
  );
  const { tuples } = d._fga_read_tuples;
  if (tuples.length === 0) break;
  await adminGql(
    `mutation ($p: FgaWriteTuplesInput!) { _fga_delete_tuples(params: $p) { message } }`,
    { p: { tuples } }
  );
  drained += tuples.length;
}
await adminGql(`mutation { _fga_reset { message } }`);
console.log(`FGA store reset (${drained} old tuples removed)`);

// 2. Install the model.
const dsl = readFileSync(new URL("./model.fga", import.meta.url), "utf8");
const m = await adminGql(
  `mutation ($p: FgaWriteModelInput!) { _fga_write_model(params: $p) { id } }`,
  { p: { dsl } }
);
console.log(`Model installed: ${m._fga_write_model.id}`);

// 3. Create (or reuse) the persona users so checks can run with THEIR tokens.
const ids = {};
for (const name of PERSONAS) {
  const { user } = await loginOrSignup(name);
  ids[name] = user.id;
  console.log(`  ${name}: ${emailFor(name)} -> user:${user.id}`);
}
writeFileSync(new URL("./.state.json", import.meta.url), JSON.stringify(ids, null, 2));

// 4. Seed the demo org: Acme, one engineering team, one project, three docs.
const u = (name) => `user:${ids[name]}`;
const tuples = [
  // -- org hierarchy: org -> team -> project -> documents -----------------
  { user: u("alice"), relation: "admin", object: "organization:acme" },
  { user: "organization:acme", relation: "org", object: "team:eng" },
  { user: u("bob"), relation: "member", object: "team:eng" },
  { user: u("dave"), relation: "member", object: "team:eng" },
  { user: u("sam"), relation: "lead", object: "team:eng" },
  { user: "team:eng", relation: "team", object: "project:phoenix" },
  { user: "organization:acme", relation: "org", object: "project:phoenix" },
  // the whole team can view the project (userset subject)
  { user: "team:eng#member", relation: "viewer", object: "project:phoenix" },
  { user: "project:phoenix", relation: "project", object: "document:spec" },
  { user: "project:phoenix", relation: "project", object: "document:salary-report" },
  { user: u("sam"), relation: "owner", object: "document:spec" },

  // -- role grant (role#assignee userset): auditors of the whole org ------
  { user: "role:auditor#assignee", relation: "auditor", object: "organization:acme" },
  { user: u("erin"), relation: "assignee", object: "role:auditor" },

  // -- user-specific override: carol is an external contractor ------------
  { user: u("carol"), relation: "viewer", object: "document:spec" },

  // -- exclusion: dave is on the team but must not see the salary report --
  { user: u("dave"), relation: "blocked", object: "document:salary-report" },

  // -- service_account subject: the CI bot may read the runbook -----------
  // In production this id is the service account's client_id (the same value
  // that appears as `sub` in its machine tokens / `act.sub` in delegations).
  { user: "service_account:ci-bot", relation: "viewer", object: "document:runbook" },
];

await adminGql(
  `mutation ($p: FgaWriteTuplesInput!) { _fga_write_tuples(params: $p) { message } }`,
  { p: { tuples } }
);
console.log(`\n${tuples.length} tuples written. Run: node walkthrough.mjs`);
