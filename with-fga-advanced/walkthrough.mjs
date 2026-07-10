// The story: Acme Inc runs project Phoenix. Each check below is a live
// check_permissions call made with the PERSONA'S OWN access token (the server
// pins the subject to the caller's token — no way to lie about who you are).
// The two CI-bot checks run as super-admin with an explicit subject.
//
// Every check asserts its expected result: the script exits non-zero if the
// authorization model ever answers differently.
import { loginOrSignup, check, adminCheck, PERSONAS, BASE } from "./api.mjs";

console.log(`Authorizer: ${BASE}\n`);

const tokens = {};
for (const name of PERSONAS) tokens[name] = (await loginOrSignup(name)).access_token;

let failures = 0;
async function expect(expected, persona, relation, object, why) {
  const allowed =
    persona === "ci-bot"
      ? await adminCheck("service_account:ci-bot", relation, object)
      : await check(tokens[persona], relation, object);
  const ok = allowed === expected;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${persona.padEnd(6)} ${relation.padEnd(10)} ${object.padEnd(24)} -> ${
      allowed ? "ALLOWED" : "denied "
    }  (${why})`
  );
}

console.log("1. Inherited access — org -> team -> project -> document");
await expect(true, "bob", "can_view", "document:spec", "team member -> project viewer -> doc viewer");
await expect(false, "bob", "can_edit", "document:spec", "membership grants viewing, not editing");
await expect(true, "sam", "can_edit", "document:spec", "team lead -> project editor -> doc editor");
await expect(true, "alice", "can_view", "document:spec", "org admin -> team member via 'admin from org'");

console.log("\n2. Ownership");
await expect(true, "sam", "can_delete", "document:spec", "owner (direct tuple)");
await expect(false, "bob", "can_delete", "document:spec", "inherited access never reaches can_delete");

console.log("\n3. Role grant — role:auditor#assignee flows to the whole org");
await expect(true, "erin", "can_view", "project:phoenix", "role assignee -> org auditor -> project viewer");
await expect(true, "erin", "can_view", "document:spec", "…and on into every project document");
await expect(false, "erin", "can_edit", "document:spec", "auditors read, never write");

console.log("\n4. User-specific override — carol is an outside contractor");
await expect(true, "carol", "can_view", "document:spec", "direct viewer tuple on ONE document");
await expect(false, "carol", "can_view", "document:salary-report", "override does not generalize");

console.log("\n5. Exclusion — 'but not blocked' beats every grant path");
await expect(false, "dave", "can_view", "document:salary-report", "team member, but blocked wins");
await expect(true, "bob", "can_view", "document:salary-report", "same team, not blocked — proves it's the block");

console.log("\n6. Service account — machine identity as an FGA subject");
await expect(true, "ci-bot", "can_view", "document:runbook", "service_account:ci-bot viewer tuple");
await expect(false, "ci-bot", "can_edit", "document:runbook", "read-only grant");

if (failures > 0) {
  console.error(`\n${failures} check(s) did not match the expected result`);
  process.exit(1);
}
console.log("\nAll checks matched. Run: node list-permissions.mjs");
