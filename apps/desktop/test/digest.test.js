"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { digestOf, shortDigest, digestFile } = require("../lib/digest");

const DOCS = path.join(__dirname, "..", "fixtures", "docs");

test("a digest is stable and sixty-four hex characters", () => {
  const bytes = Buffer.from("an invoice");

  assert.match(digestOf(bytes), /^[0-9a-f]{64}$/);
  assert.equal(digestOf(bytes), digestOf(Buffer.from("an invoice")));
  assert.notEqual(digestOf(bytes), digestOf(Buffer.from("an invoice ")));
});

test("the short form is a prefix of the long one, so the two cannot diverge", () => {
  const bytes = fs.readFileSync(path.join(DOCS, "invoice-digital.pdf"));

  assert.equal(shortDigest(bytes), digestOf(bytes).slice(0, 16));
});

test("the same file read twice has the same digest", () => {
  const file = path.join(DOCS, "invoice-digital.pdf");

  assert.equal(digestFile(file), digestFile(file));
  assert.equal(digestFile(file), digestOf(fs.readFileSync(file)));
});
