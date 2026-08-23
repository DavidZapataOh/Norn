"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tally } = require("../bench/reconcile-report");

test("the table counts every pairing of expected against actual", () => {
  const out = tally([
    { name: "a.pdf", expected: "matched", actual: "matched" },
    { name: "b.pdf", expected: "mismatch", actual: "mismatch" },
    { name: "c.pdf", expected: "matched", actual: "indeterminate" },
  ]);

  assert.equal(out.total, 3);
  assert.equal(out.table.matched.matched, 1);
  assert.equal(out.table.matched.indeterminate, 1);
  assert.equal(out.table.mismatch.mismatch, 1);
});

test("a confident wrong verdict is counted apart from every other error", () => {
  const out = tally([
    { name: "a.pdf", expected: "mismatch", actual: "matched" },
    { name: "b.pdf", expected: "no-candidate", actual: "matched" },
    // Wrong, but not confidently: a reviewer sees this one.
    { name: "c.pdf", expected: "matched", actual: "mismatch" },
  ]);

  assert.equal(out.confidentlyWrong, 2,
    "a match that should not have matched is the only outcome that damages an operator");
  assert.deepEqual(out.byDocument.confidentlyWrong.sort(), ["a.pdf", "b.pdf"],
    "the report names them, since a count cannot be investigated");
});

test("the cost of abstention is counted, so caution is not free in the report", () => {
  const out = tally([
    { name: "a.pdf", expected: "matched", actual: "indeterminate" },
    { name: "b.pdf", expected: "matched", actual: "indeterminate" },
    // Indeterminate where indeterminate was expected is not a cost.
    { name: "c.pdf", expected: "indeterminate", actual: "indeterminate" },
  ]);

  assert.equal(out.costOfAbstention, 2);
  assert.deepEqual(out.byDocument.costOfAbstention.sort(), ["a.pdf", "b.pdf"]);
});

test("a perfect run reports zero in both cells rather than omitting them", () => {
  const out = tally([{ name: "a.pdf", expected: "matched", actual: "matched" }]);

  assert.equal(out.confidentlyWrong, 0);
  assert.equal(out.costOfAbstention, 0);
  // A report that omits a zero reads as a report that did not check.
  assert.deepEqual(out.byDocument.confidentlyWrong, []);
});

const fs = require("node:fs");
const path = require("node:path");
const RECORDS = path.join(__dirname, "..", "fixtures", "records");
const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");

test("every expected verdict names a document the corpus actually has", () => {
  const expected = JSON.parse(fs.readFileSync(path.join(RECORDS, "expected.json"), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));

  for (const name of Object.keys(expected)) {
    assert.ok(truth[name], `expected.json names ${name}, which is not in the corpus`);
    assert.ok(expected[name].why.length > 0, `${name} has no reason, so a failure cannot be read`);
  }
});

test("the record set covers all four verdicts", () => {
  const expected = JSON.parse(fs.readFileSync(path.join(RECORDS, "expected.json"), "utf8"));
  const verdicts = new Set(Object.values(expected).map((e) => e.verdict));

  for (const verdict of ["matched", "mismatch", "indeterminate", "no-candidate"]) {
    assert.ok(verdicts.has(verdict), `no document expects ${verdict}, so that branch is unmeasured`);
  }
});

test("the exact-match record carries the amount its document prints", () => {
  // Derived rather than typed twice: a change to the corpus must not silently turn an exact
  // match into a one-cent mismatch.
  const { parseAmount } = require("../lib/money");
  const { sniff, parseDelimited, proposeMapping, importRecords } = require("../lib/importer");
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));

  const bytes = fs.readFileSync(path.join(RECORDS, "reconcile.csv"));
  const { text, delimiter } = sniff(bytes);
  const rows = importRecords(bytes, { mapping: proposeMapping(parseDelimited(text, delimiter)[0]) }).rows;

  const printed = truth["digital-continental.pdf"].fields.find((f) => f.field === "total").text;
  const reference = truth["digital-continental.pdf"].fields.find((f) => f.field === "invoice_no").text;
  const record = rows.find((r) => r.reference === reference);

  assert.ok(record, "the exact-match record is not in the file");
  assert.equal(record.amountMinor, parseAmount(printed).minor);
});

test("the inactive-vendor case is marked in the store, not encoded in a name", () => {
  // A renamed vendor still matches by reference and is never actually inactive, so the
  // check under test would never run.
  const expected = JSON.parse(fs.readFileSync(path.join(RECORDS, "expected.json"), "utf8"));
  const inactive = Object.values(expected).find((e) => e.deactivateVendor);

  assert.ok(inactive, "no document asks for a vendor to be deactivated");
  assert.ok(!inactive.deactivateVendor.includes("inactive"),
    "the vendor name carries the deviation instead of the store");
});
