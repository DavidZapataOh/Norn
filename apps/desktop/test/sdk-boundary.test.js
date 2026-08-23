"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { filesMatching, APP_DIR } = require("./helpers/sources");

// Matches the ways a module can actually reach the package, rather than any mention
// of its name: a user-facing message that quotes the package is not a second door.
// A determined evasion (`const p = "@qvac/sdk"; await import(p)`) is out of scope; this
// guards against drift, not an adversary.
const REACHES_SDK = /(?:require|import)\s*\(\s*["']@qvac\/sdk["']\s*\)|from\s+["']@qvac\/sdk["']/;

const filesNamingTheSdk = () => filesMatching(REACHES_SDK);

test("exactly one module reaches the SDK", () => {
  assert.deepEqual(filesNamingTheSdk(), ["lib/sdk.js"]);
});

module.exports = { filesNamingTheSdk, APP_DIR };

test("the scanner detects a second module reaching the SDK", () => {
  const intruder = path.join(APP_DIR, "lib", "__boundary_probe.js");
  fs.writeFileSync(intruder, '"use strict";\n// require("@qvac/sdk")\n');
  try {
    const found = filesNamingTheSdk();
    assert.equal(found.length, 2, `scanner missed the intruder, saw: ${found.join(", ")}`);
    assert.ok(found.includes("lib/__boundary_probe.js"));
  } finally {
    fs.rmSync(intruder, { force: true });
  }
});
