"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreDocument, aggregateExtraction } = require("../bench/extraction-report");

const truthFields = [
  { field: "total", text: "2.831,40" },
  { field: "vat", text: "90,91" },
  { field: "vendor", text: "Northwind Paper Supply SL" },
];

const admitted = (value, type = "amount") => ({ admitted: true, value, type });
const abstained = (check) => ({ admitted: false, check, reason: check });

test("an admitted value matching truth counts as right", () => {
  const out = scoreDocument(truthFields, {
    total: admitted(283140n),
    vat: admitted(9091n),
    vendor: admitted("Northwind Paper Supply SL", "string"),
  });

  assert.equal(out.admittedRight, 3);
  assert.equal(out.admittedWrong, 0);
});

test("an admitted value that disagrees with truth is the number that matters", () => {
  const out = scoreDocument(truthFields, {
    total: admitted(28314n),          // a magnitude error that got through
    vat: admitted(9091n),
    vendor: admitted("Northwind Paper Supply SL", "string"),
  });

  assert.equal(out.admittedWrong, 1);
  assert.equal(out.admittedRight, 2);
});

test("an abstention is scored against what it would have said", () => {
  const out = scoreDocument(truthFields, {
    total: { ...abstained("confidence"), value: 283140n, type: "amount" },
    vat: { ...abstained("binding"), value: 999n, type: "amount" },
    vendor: admitted("Northwind Paper Supply SL", "string"),
  });

  // The cost line: the gate declined a value it had right.
  assert.equal(out.abstainedWouldBeRight, 1);
  assert.equal(out.abstainedWouldBeWrong, 1);
  assert.deepEqual(out.byCheck, { confidence: 1, binding: 1 });
});

test("a field the gate never produced is counted, not skipped", () => {
  const out = scoreDocument(truthFields, { total: admitted(283140n) });

  assert.equal(out.admittedRight, 1);
  assert.equal(out.abstainedWouldBeWrong, 2, "a missing field is a silent abstention");
});

test("coverage and precision are reported together, never one alone", () => {
  const corpus = aggregateExtraction([
    { admittedRight: 8, admittedWrong: 1, abstainedWouldBeRight: 2, abstainedWouldBeWrong: 1, byCheck: { binding: 3 } },
    { admittedRight: 5, admittedWrong: 0, abstainedWouldBeRight: 1, abstainedWouldBeWrong: 0, byCheck: { confidence: 1 } },
  ]);

  assert.equal(corpus.fields, 18);
  assert.equal(corpus.admitted, 14);
  assert.equal(corpus.admittedWrong, 1);
  // 14 of 18 fields answered.
  assert.equal(corpus.coverage.toFixed(3), "0.778");
  // 13 of the 14 answered were right.
  assert.equal(corpus.precision.toFixed(3), "0.929");
  assert.deepEqual(corpus.byCheck, { binding: 3, confidence: 1 });
});

test("a date is scored through its parsed value, not its spelling", () => {
  // The gate holds the coerced ISO value because the schema coerces to it; ground truth is
  // what the page printed. Compared as strings every correct date scores as wrong, and the
  // wrongly-admitted count fills up with the scorer's own defect.
  const out = scoreDocument(
    [{ field: "date", text: "14 March 2026" }],
    { date: { admitted: true, value: "2026-03-14", type: "date" } },
  );

  assert.equal(out.admittedRight, 1);
  assert.equal(out.admittedWrong, 0);
});
