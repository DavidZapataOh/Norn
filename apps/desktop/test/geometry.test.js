"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { union, vOverlap, hGap, joinSplitNumbers, rows, toText } = require("../lib/geometry");

test("union covers both boxes", () => {
  assert.deepEqual(union([10, 10, 20, 20], [15, 5, 30, 18]), [10, 5, 30, 20]);
});

test("vertical overlap is a fraction of the shorter box", () => {
  assert.equal(vOverlap([0, 0, 10, 20], [0, 0, 10, 20]), 1);
  assert.equal(vOverlap([0, 0, 10, 20], [0, 30, 10, 50]), 0);
  assert.equal(vOverlap([0, 0, 10, 20], [0, 10, 10, 30]), 0.5);
});

test("horizontal gap is measured in text heights and may be negative", () => {
  // Two boxes 10px high with a 5px gap: half a text height apart.
  assert.equal(hGap([0, 0, 10, 10], [15, 0, 25, 10]), 0.5);
  // Overlapping in x, which is what page skew produces.
  assert.equal(hGap([0, 0, 10, 10], [8, 0, 18, 10]), -0.2);
});

test("a real fragmented amount is rejoined, with a unioned box and the lower confidence", () => {
  // Verbatim from a pass over a photograph skewed 2.2 degrees. The boxes overlap in x.
  const out = joinSplitNumbers([
    { text: "491,", bbox: [843.6, 544.9, 902.4, 579.8], confidence: 0.982 },
    { text: "40", bbox: [892, 551, 924, 575], confidence: 1.0 },
  ]);

  assert.equal(out.length, 1);
  assert.equal(out[0].text, "491,40");
  assert.deepEqual(out[0].bbox, [843.6, 544.9, 924, 579.8]);
  assert.equal(out[0].confidence, 0.982, "a repair must not raise confidence");
});

test("adjacent table columns are not merged", () => {
  // Unit price and line total on the same row, from the same real pass.
  const out = joinSplitNumbers([
    { text: "120,00", bbox: [675, 324, 753, 355], confidence: 0.998 },
    { text: "1.200,00", bbox: [855, 331, 951, 362], confidence: 0.990 },
  ]);

  assert.equal(out.length, 2, "two separate columns were merged into one value");
});

test("a decimal tail followed by a long number is not a fragment", () => {
  const out = joinSplitNumbers([
    { text: "Subtotal,", bbox: [0, 0, 60, 10], confidence: 0.9 },
    { text: "2340", bbox: [62, 0, 100, 10], confidence: 0.9 },
  ]);

  assert.equal(out.length, 2, "four digits is a value, not a decimal fragment");
});

test("a region without a box is never merged and never dropped", () => {
  const out = joinSplitNumbers([
    { text: "491,", confidence: 0.9 },
    { text: "40", bbox: [892, 551, 924, 575], confidence: 1.0 },
  ]);

  assert.equal(out.length, 2, "merged without geometry to justify it");
});

test("a comma-ending description does not swallow the quantity column", () => {
  // The text patterns both match here -- a comma tail and two digits -- so only geometry
  // can reject this. The columns sit 3.8 text heights apart.
  const description = { text: "Servicio de consultoria,", bbox: [93, 301, 416, 341], confidence: 0.97 };
  const quantity = { text: "10", bbox: [567, 322, 598, 346], confidence: 0.99 };

  assert.ok(vOverlap(description.bbox, quantity.bbox) > 0.5, "same row, so overlap cannot reject it");
  assert.ok(hGap(description.bbox, quantity.bbox) > 3, "the gap is what must reject it");

  assert.equal(joinSplitNumbers([description, quantity]).length, 2,
    "a description was glued to the next column's quantity");
});

test("regions on the same line cluster into one row, ordered left to right", () => {
  // Deliberately supplied out of order, with the y-drift a skewed page produces.
  const clustered = rows([
    { text: "1.200,00", bbox: [855, 331, 951, 362] },
    { text: "Servicio de consultoria", bbox: [93, 301, 416, 341] },
    { text: "10", bbox: [567, 322, 598, 346] },
    { text: "Licencia software", bbox: [93, 348, 343, 382] },
  ]);

  assert.equal(clustered.length, 2);
  assert.deepEqual(clustered[0].map((r) => r.text), ["Servicio de consultoria", "10", "1.200,00"]);
  assert.deepEqual(clustered[1].map((r) => r.text), ["Licencia software"]);
});

test("reading order text is row-major", () => {
  const text = toText([
    { text: "b", bbox: [50, 0, 60, 10] },
    { text: "a", bbox: [0, 0, 10, 10] },
    { text: "c", bbox: [0, 40, 10, 50] },
  ]);

  assert.equal(text, "a  b\nc");
});

test("a real page clusters into the rows a reader would see", () => {
  // 38 regions captured from a recognition pass over the skewed photograph. The fixture
  // prints 16 non-blank lines, which is the ground truth this is checked against rather
  // than re-asserting the clustering rule the implementation already applied.
  const regions = require("../fixtures/regions/receipt-photo.json");
  const clustered = rows(regions);

  assert.equal(clustered.length, 16, "row count does not match the printed lines");

  const total = clustered.find((r) => r.some((x) => x.text.includes("Total due")));
  assert.ok(total, "the total line was not recognised at all");
  assert.ok(total.some((x) => x.text.includes("523.81")),
    `the total was separated from its amount: ${total.map((x) => x.text).join(" | ")}`);

  for (const row of clustered) {
    const xs = row.map((r) => r.bbox[0]);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), "a row is not ordered left to right");
  }
});

test("a fragment scattered in the region list is still rejoined", () => {
  // The recogniser does not return regions in reading order: on a real page the raw order
  // and the reading order first diverge at index 9. Adjacency in the list is therefore not
  // adjacency on the page, and a merge that trusts list order misses the case it exists for.
  const out = joinSplitNumbers([
    { text: "491,", bbox: [843.6, 544.9, 902.4, 579.8], confidence: 0.982 },
    { text: "INVOICE", bbox: [100, 60, 300, 100], confidence: 0.99 },
    { text: "40", bbox: [892, 551, 924, 575], confidence: 1.0 },
  ]);

  assert.equal(out.length, 2);
  assert.ok(out.some((r) => r.text === "491,40"), "the fragment was missed because of list order");
});
