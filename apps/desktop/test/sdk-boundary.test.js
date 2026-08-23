"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "test", "renderer", ".git"]);

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), found);
    } else if (entry.name.endsWith(".js")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

// Matches the ways a module can actually reach the package, rather than any mention
// of its name: a user-facing message that quotes the package is not a second door.
// A determined evasion (`const p = "@qvac/sdk"; await import(p)`) is out of scope; this
// guards against drift, not an adversary.
const REACHES_SDK = /(?:require|import)\s*\(\s*["']@qvac\/sdk["']\s*\)|from\s+["']@qvac\/sdk["']/;

function filesNamingTheSdk() {
  return sourceFiles(APP_DIR)
    .filter((file) => REACHES_SDK.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(APP_DIR, file));
}

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
