"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { filesMatching, APP_DIR } = require("./helpers/sources");

const LIB = path.join(APP_DIR, "lib");

// Rasterisation genuinely needs a Chromium renderer. Every other lib/ module has to stay
// runnable under plain node, which is what keeps its tests fast and its logic inspectable
// without launching an application.
const REACHES_ELECTRON = /(?:require|import)\s*\(\s*["']electron["']\s*\)|from\s+["']electron["']/;

const libFilesUsingElectron = () => filesMatching(REACHES_ELECTRON, LIB);

test("only the rasteriser reaches Electron from lib/", () => {
  assert.deepEqual(libFilesUsingElectron(), ["lib/raster.js"]);
});

test("the scanner detects another lib module reaching Electron", () => {
  const intruder = path.join(LIB, "__electron_probe.js");
  fs.writeFileSync(intruder, '"use strict";\nconst { app } = require("electron");\n');
  try {
    const found = libFilesUsingElectron();
    assert.equal(found.length, 2, `scanner missed the intruder, saw: ${found.join(", ")}`);
    assert.ok(found.includes("lib/__electron_probe.js"));
  } finally {
    fs.rmSync(intruder, { force: true });
  }
});
