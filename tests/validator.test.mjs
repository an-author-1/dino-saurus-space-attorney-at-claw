/*
 * Validator fixture tests. Proves the validator PASSES the real case and CATCHES
 * each intentionally-broken fixture with the expected class of error.
 * Run by scripts/run-tests.mjs (and directly via `node tests/validator.test.mjs`).
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateFile } from "../scripts/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests", "fixtures");

let failures = 0;
function assert(cond, msg) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}

console.log("\n[validator] real case passes");
{
  const { errors } = validateFile(join(root, "cases", "case-0-0.yaml"));
  assert(errors.length === 0, `case-0-0.yaml has no errors (got ${errors.length}: ${errors[0] ?? ""})`);
}

console.log("\n[validator] broken fixtures are caught");
const expectations = [
  ["missing_evidence.yaml", /dangling evidence id "missing_log"/],
  ["unreachable_lie.yaml", /flag\(s\) \[never_set\] that are never set|never breakable/],
  ["orphan_statement.yaml", /hidden statement "s2" is never revealed/],
  ["over_budget.yaml", /over the 4-line budget/],
  ["replaced_still_required.yaml", /replace_statement retires "s2" whose lie was never broken/],
  ["dangling_guidance.yaml", /guidance\.CONTRADICTION: dangling dialogue id/],
  ["interruption_no_duration.yaml", /interruption statement is missing "duration_boxes"/],
];

for (const [file, pattern] of expectations) {
  const { errors } = validateFile(join(fixtures, file));
  const hit = errors.some((e) => pattern.test(e));
  assert(errors.length > 0, `${file} produces at least one error`);
  assert(hit, `${file} is caught by ${pattern}`);
  if (!hit) console.log(`       (errors were: ${JSON.stringify(errors)})`);
}

console.log(failures === 0 ? "\n=== VALIDATOR TESTS PASSED ===" : `\n=== VALIDATOR TESTS FAILED (${failures}) ===`);
if (failures > 0) process.exitCode = 1;
