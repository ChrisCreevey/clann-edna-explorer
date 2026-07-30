// Minimal zero-dependency test harness, matching the suite's "no external
// dependencies" convention. Usage in a test file:
//
//   const { test, report } = require('./harness');
//   test('does the thing', () => { assert.strictEqual(1 + 1, 2); });
//   report();

const assert = require('assert');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

function report() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

module.exports = { test, report, assert };
