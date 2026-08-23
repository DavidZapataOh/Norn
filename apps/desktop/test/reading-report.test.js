"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreRegions, aggregate, covers } = require("../bench/reading-report");

const expected = [
  { field: "total", text: "ARS 2.831,40", bbox: [824, 591, 1022, 635] },
  { field: "po", text: "PO-2026-0912", bbox: [81, 657, 448, 699] },
];

test("a correct reading in the right place is correct", () => {
  const out = scoreRegions(expected, [
    { text: "ARS 2.831,40", bbox: [826, 592, 1020, 634], confidence: 1.0 },
    { text: "PO-2026-0912", bbox: [82, 658, 447, 698], confidence: 0.85 },
  ]);

  assert.equal(out.correct, 2);
  assert.equal(out.mislocated, 0);
  assert.equal(out.missed, 0);
});

test("the right text in the wrong place is mislocated, not correct", () => {
  const out = scoreRegions(expected, [
    { text: "ARS 2.831,40", bbox: [10, 10, 200, 40], confidence: 1.0 },
    { text: "PO-2026-0912", bbox: [82, 658, 447, 698], confidence: 0.85 },
  ]);

  assert.equal(out.correct, 1);
  assert.equal(out.mislocated, 1, "a value read at the wrong place is not a correct reading");
});

test("a value that never appears is missed", () => {
  const out = scoreRegions(expected, [
    { text: "PO-2026-0912", bbox: [82, 658, 447, 698], confidence: 0.85 },
  ]);

  assert.equal(out.missed, 1);
  assert.equal(out.correct, 1);
});

test("a value fused to its label is read, not missed", () => {
  // A recogniser returns "Invoice no. LF-2026-0771" as one region. The characters were
  // read; separating a value from its label is the extraction stage's job, so counting
  // this as a miss would blame the reader for something it did not get wrong.
  assert.equal(covers("Invoice no. LF-2026-0771", "LF-2026-0771"), true);
  assert.equal(covers("Issue date: 18 May 2026", "18 May 2026"), true);
});

test("a longer amount does not count as containing a shorter one", () => {
  // 523,14 appears inside 2.523,14 as characters but is a different value, and matching
  // it would report a wrong reading as correct.
  assert.equal(covers("2.523,14", "523,14"), false);
  assert.equal(covers("Total 1.014,30", "3.014,30"), false);
});

test("a value split across regions on one row is mislocated, not missed", () => {
  // Verbatim from a scan: the date came back as three regions on the same line. The
  // extraction stage is shown the row, not the regions, so the characters are available.
  // No single box corresponds to the value, which is a provenance loss, not a misread.
  const out = scoreRegions(
    [{ field: "date", text: "11 May 2026", bbox: [300, 250, 520, 280] }],
    [
      { text: "Issue date: 11", bbox: [120, 250, 360, 280], confidence: 0.866 },
      { text: "May", bbox: [372, 250, 425, 280], confidence: 1.0 },
      { text: "2026", bbox: [437, 250, 520, 280], confidence: 1.0 },
    ],
  );

  assert.equal(out.missed, 0, "the characters were read and are on one row");
  assert.equal(out.mislocated, 1, "no single box corresponds to the value");
  assert.equal(out.correct, 0);
});

test("aggregate reports confidence for correct and incorrect readings separately", () => {
  const corpus = aggregate([
    { correct: 1, mislocated: 0, missed: 1, found: 2,
      confidences: { correct: [0.629], incorrect: [0.899] } },
    { correct: 2, mislocated: 0, missed: 0, found: 2,
      confidences: { correct: [0.99, 0.95], incorrect: [] } },
  ]);

  assert.equal(corpus.correct, 3);
  assert.equal(corpus.missed, 1);
  // The uncomfortable number: the worst incorrect reading scored above the worst correct one.
  assert.equal(corpus.confidence.incorrect.max, 0.899);
  assert.equal(corpus.confidence.correct.min, 0.629);
  assert.equal(corpus.confidence.separable, false,
    "confidence should be reported as non-separable when the ranges overlap");
});

const fs = require("node:fs");
const path = require("node:path");
const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");

test("the corpus covers every class the report needs", () => {
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));
  const docs = Object.values(truth);

  assert.ok(docs.length >= 9, `expected at least 9 documents, found ${docs.length}`);

  const classes = new Set(docs.flatMap((d) => d.classes));
  for (const required of ["digital", "scan", "photo", "continental", "anglo",
                          "arithmetic-wrong", "fragmented", "absent-field"]) {
    assert.ok(classes.has(required), `corpus is missing the "${required}" class`);
  }

  for (const [name, doc] of Object.entries(truth)) {
    for (const field of doc.fields) {
      assert.ok(Array.isArray(field.bbox) && field.bbox.length === 4,
        `${name}.${field.field} has no ground-truth box`);
    }
  }
});

test("every corpus document states a currency, so asking for one is not asking it to invent", () => {
  // Measured on the previous corpus: asked for a field the page does not carry, the model
  // answers anyway. Nine documents stating no currency would have produced nine inventions.
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));

  for (const [name, doc] of Object.entries(truth)) {
    if (doc.mode === "skip") continue;
    assert.match(doc.page_text, /\b(EUR|GBP)\b/,
      `${name} prints no currency, so the model would have to invent one`);
  }
});
