"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..");
const ALLOWED = new Set(["node:crypto", "node:fs", "node:path", "node:process", "node:util"]);

// Walks the require graph rather than reading one file's imports. A verifier that reaches the
// app through two hops is not independent, and a one-file check would not see it.
function closure(entry, seen = new Set()) {
  const source = fs.readFileSync(entry, "utf8");
  for (const [, spec] of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!spec.startsWith(".")) {
      if (!ALLOWED.has(spec)) seen.add(spec);
      continue;
    }
    const resolved = require.resolve(path.resolve(path.dirname(entry), spec));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    closure(resolved, seen);
  }
  return seen;
}

const relative = (entry) => [...closure(entry)]
  .map((p) => (p.startsWith("/") ? path.relative(APP, p) : p))
  .sort();

test("the verifier reaches nothing but Node builtins and the canonicaliser", () => {
  // A check that only runs inside the thing being checked is not much of a check, and
  // "separate" decays the first time someone reaches for a convenient helper.
  assert.deepEqual(relative(path.join(APP, "scripts", "verify-certificate.js")),
    ["lib/canonical.js"]);
});

test("the canonicaliser it shares reaches nothing at all", () => {
  // Sharing it is what makes the signature checkable rather than re-derived, and it is only
  // safe to share because it has no dependencies of its own.
  assert.deepEqual(relative(path.join(APP, "lib", "canonical.js")), []);
});

test("the boundary walker sees a dependency two hops away", () => {
  // The one-file version of this check passes while the verifier reaches the SDK through a
  // helper, so the walker is verified against exactly that case.
  const helper = path.join(APP, "lib", "__hop_probe.js");
  const entry = path.join(APP, "lib", "__entry_probe.js");
  fs.writeFileSync(helper, '"use strict";\nrequire("@qvac/sdk");\n');
  fs.writeFileSync(entry, '"use strict";\nrequire("./__hop_probe");\n');
  try {
    assert.ok([...closure(entry)].includes("@qvac/sdk"),
      "a dependency reached through a helper is still a dependency");
  } finally {
    fs.rmSync(helper, { force: true });
    fs.rmSync(entry, { force: true });
  }
});

const { parseArgs } = require("../scripts/verify-certificate");

test("a single certificate path is not eaten by the document flag's absence", () => {
  // The first version computed the document's index as -1 and then excluded index -1 + 1,
  // which is the first argument. Every invocation without --document printed usage. The
  // checks were tested and the entry point a third party actually types was not.
  assert.deepEqual(parseArgs(["a.json"]), { files: ["a.json"], documentPath: undefined });
});

test("the document flag takes its value out of the file list", () => {
  assert.deepEqual(parseArgs(["a.json", "--document", "inv.pdf"]),
    { files: ["a.json"], documentPath: "inv.pdf" });
});

test("the document flag is recognised before the files as well as after", () => {
  assert.deepEqual(parseArgs(["--document", "inv.pdf", "a.json", "b.json"]),
    { files: ["a.json", "b.json"], documentPath: "inv.pdf" });
});
