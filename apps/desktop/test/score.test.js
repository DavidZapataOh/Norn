"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreDocument, scoreCorpus } = require("../bench/score");

const FIXTURE_DIR = path.join(__dirname, "..", "bench", "fixtures");

test("counts a fully correct extraction", () => {
  const expected = { invoice_number: "A-0004471", vendor: "ACME CORP S.A.", total: 2340.0 };
  const actual = { invoice_number: "A-0004471", vendor: "ACME CORP S.A.", total: 2340.0 };

  const result = scoreDocument(expected, actual);

  assert.equal(result.correct, 3);
  assert.equal(result.total, 3);
  assert.deepEqual(result.wrong, []);
});

test("a declined field and an invented zero are not the same answer", () => {
  const expected = { vat_number: null };

  const declined = scoreDocument(expected, { vat_number: null });
  const invented = scoreDocument(expected, { vat_number: 0 });
  const fabricated = scoreDocument(expected, { vat_number: "FR12345678901" });

  assert.equal(declined.correct, 1, "returning null when null is expected is correct");
  assert.equal(invented.correct, 0, "asserting zero where the model should decline is wrong");
  assert.equal(fabricated.correct, 0, "inventing a value is wrong");
});

test("omitting a field is not the same as declining it", () => {
  // `undefined == null` is true in JS, so a loose comparison would score a model
  // that dropped the key entirely as having correctly declined.
  const expected = { vat_number: null };

  assert.equal(scoreDocument(expected, { vat_number: null }).correct, 1);
  assert.equal(scoreDocument(expected, {}).correct, 0, "a missing key is not a decline");
});

test("an amount is compared by value, not by the string the model chose", () => {
  const expected = { total: 2340.0 };

  assert.equal(scoreDocument(expected, { total: 2340 }).correct, 1);
  assert.equal(scoreDocument(expected, { total: "2340.00" }).correct, 1);
  assert.equal(scoreDocument(expected, { total: "2.340,00" }).correct, 1);
  assert.equal(scoreDocument(expected, { total: 234000 }).correct, 0, "a magnitude error is wrong");
});

test("the fixture set covers the cases small models fail", () => {
  const fixtures = fs.readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")));

  assert.ok(fixtures.length >= 6, `expected at least 6 fixtures, found ${fixtures.length}`);

  const has = (predicate) => fixtures.some(predicate);
  assert.ok(has((f) => /\d\.\d{3},\d{2}/.test(f.text)), "no continental decimal fixture");
  assert.ok(has((f) => /\d,\d{3}\.\d{2}/.test(f.text)), "no anglo decimal fixture");
  assert.ok(has((f) => Object.values(f.expected).includes(null)), "no fixture with an absent field");
  assert.ok(has((f) => f.id.includes("arithmetic")), "no fixture with a wrong total");
});

test("scoreCorpus aggregates per field", () => {
  const results = [
    { expected: { a: 1, b: 2 }, actual: { a: 1, b: 9 } },
    { expected: { a: 1, b: 2 }, actual: { a: 5, b: 2 } },
  ].map((r) => ({ ...scoreDocument(r.expected, r.actual), expected: r.expected }));

  const corpus = scoreCorpus(results);

  assert.equal(corpus.correct, 2);
  assert.equal(corpus.total, 4);
  assert.equal(corpus.byField.a.correct, 1);
  assert.equal(corpus.byField.b.correct, 1);
});
