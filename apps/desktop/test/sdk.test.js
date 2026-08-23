"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const probe = require("../lib/sdk");

test("the module is imported once, not once per call", async () => {
  // Node caches ESM namespaces, so identity alone cannot distinguish a cached
  // loader from an uncached one. Count entries into the loader instead.
  const original = probe.__importForTest();
  let entries = 0;

  probe.__setImportForTest(async () => { entries++; return { marker: true }; });
  probe.__resetCacheForTest();

  await probe.sdk();
  await probe.sdk();
  await probe.sdk();

  assert.equal(entries, 1);

  probe.__setImportForTest(original);
  probe.__resetCacheForTest();
});

test("the real SDK exposes the surface this application depends on", async () => {
  const { sdk } = require("../lib/sdk");
  const S = await sdk();

  for (const name of ["loadModel", "unloadModel", "completion", "ocr", "downloadAsset"]) {
    assert.equal(typeof S[name], "function", `@qvac/sdk is missing ${name}`);
  }
});
