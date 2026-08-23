"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bindField, matches } = require("../lib/binding");

const amount = (minor) => ({ type: "amount", value: minor, raw: null });
const string = (value) => ({ type: "string", value, raw: value });

test("an amount binds through its value, not its spelling", () => {
  // The model may echo either convention; the page prints one of them.
  assert.equal(matches("2.831,40", amount(283140n)), true);
  assert.equal(matches("2,831.40", amount(283140n)), true);
  assert.equal(matches("ARS 2.831,40", amount(283140n)), true);
  assert.equal(matches("2.831,41", amount(283140n)), false, "a cent apart is a different value");
});

test("a string binds through a comparison that tolerates recogniser noise", () => {
  // Both left-hand sides are verbatim from a real pass over a photographed page.
  assert.equal(matches("Calle Mayor 14,28013 Madrid", string("Calle Mayor 14, 28013 Madrid")), true);
  assert.equal(matches("Northwind  Paper Supply SL", string("Northwind Paper Supply SL")), true);
  assert.equal(matches("Northwind Paper Supply", string("Northwind Paper Supply SL")), false);
});

test("a value carried by one region binds to that region", () => {
  const out = bindField(amount(283140n), [
    { text: "Subtotal", bbox: [80, 500, 200, 530], confidence: 0.99 },
    { text: "2.831,40", bbox: [820, 500, 1020, 530], confidence: 0.94 },
  ]);

  assert.equal(out.status, "region");
  assert.deepEqual(out.bbox, [820, 500, 1020, 530]);
  assert.equal(out.confidence, 0.94);
  assert.equal(out.text, "2.831,40");
});

test("a value the model invented comes back unbound, with no box", () => {
  const out = bindField(amount(999999n), [
    { text: "2.831,40", bbox: [820, 500, 1020, 530], confidence: 0.94 },
  ]);

  assert.equal(out.status, "unbound");
  assert.equal(out.bbox, undefined, "an unbound value must never be given a box");
  assert.match(out.reason, /not found on the page/);
});

test("a null value is not a binding failure", () => {
  const out = bindField({ type: "amount", value: null, raw: null }, []);

  assert.equal(out.status, "unbound");
  assert.match(out.reason, /declared absent/);
});

test("a value split across a row binds as a span, with the union of its boxes", () => {
  // Verbatim from a pass over a scan: the date came back as three regions on one line.
  const out = bindField(string("11 May 2026"), [
    { text: "Issue date: 11", bbox: [120, 250, 360, 280], confidence: 0.866 },
    { text: "May", bbox: [372, 250, 425, 280], confidence: 1.0 },
    { text: "2026", bbox: [437, 250, 520, 280], confidence: 1.0 },
  ]);

  assert.equal(out.status, "span");
  assert.deepEqual(out.bbox, [120, 250, 520, 280]);
  assert.equal(out.confidence, 0.866, "a span is only as trustworthy as its weakest region");
});

test("a value fused to its label binds to the region that carries it", () => {
  // Also verbatim: the recogniser returns the label and the value as one region.
  const out = bindField(string("RW-2026-3310"), [
    { text: "Invoice no. RW-2026-3310", bbox: [120, 200, 480, 232], confidence: 0.849 },
  ]);

  assert.equal(out.status, "span");
  assert.deepEqual(out.bbox, [120, 200, 480, 232]);
  assert.equal(out.confidence, 0.849);
});

test("a narrow binding is preferred over a wide one", () => {
  const out = bindField(amount(283140n), [
    { text: "Total due 2.831,40", bbox: [80, 500, 1020, 530], confidence: 0.8 },
    { text: "2.831,40", bbox: [820, 500, 1020, 530], confidence: 0.94 },
  ]);

  assert.equal(out.status, "region", "the exact region was available and a wider one was used");
  assert.deepEqual(out.bbox, [820, 500, 1020, 530]);
});

test("a span never crosses a row", () => {
  // The same digits on two different lines must not be glued into one box.
  const out = bindField(string("40 8"), [
    { text: "40", bbox: [500, 100, 540, 130], confidence: 0.9 },
    { text: "8", bbox: [500, 400, 520, 430], confidence: 0.9 },
  ]);

  assert.notEqual(out.status, "span");
  assert.equal(out.status, "unbound");
});

test("a value present in the row but in no single region binds across it", () => {
  const out = bindField(string("Acme Robotics GmbH"), [
    { text: "Bill to: Acme", bbox: [80, 300, 300, 330], confidence: 0.7 },
    { text: "Robotics", bbox: [310, 300, 420, 330], confidence: 0.6 },
    { text: "GmbH (fake)", bbox: [430, 300, 560, 330], confidence: 0.8 },
  ]);

  assert.equal(out.status, "span");
  assert.deepEqual(out.bbox, [80, 300, 560, 330]);
});

const { bindAll } = require("../lib/binding");

test("a value appearing twice is resolved by label proximity and marked contested", () => {
  const regions = [
    { text: "Card stock A3", bbox: [80, 400, 300, 430], confidence: 0.9 },
    { text: "105,00", bbox: [820, 400, 950, 430], confidence: 0.95 },
    { text: "Total due", bbox: [80, 600, 240, 630], confidence: 0.99 },
    { text: "105,00", bbox: [820, 600, 950, 630], confidence: 0.91 },
  ];

  const out = bindAll({ total: amount(10500n) }, regions, { labels: { total: "Total due" } });

  assert.equal(out.total.status, "region");
  assert.deepEqual(out.total.bbox, [820, 600, 950, 630], "the total bound to the line item's amount");
  assert.equal(out.total.contested, 2);
});

test("an uncontested binding does not carry a contest count", () => {
  const out = bindAll({ total: amount(283140n) },
    [{ text: "2.831,40", bbox: [820, 500, 1020, 530], confidence: 0.94 }], {});

  assert.equal(out.total.status, "region");
  assert.equal(out.total.contested, undefined);
});

test("with no regions at all, every value is unbound and says why", () => {
  // The vision path produces values and no geometry unless recognition also ran.
  const out = bindAll({ total: amount(283140n), vendor: string("Northwind") }, [], {});

  for (const key of ["total", "vendor"]) {
    assert.equal(out[key].status, "unbound");
    assert.match(out[key].reason, /no regions/);
  }
});

test("a date binds through its parsed value, not its spelling", () => {
  // The model answers in ISO because the schema coerces to it; the page prints the
  // spelled form. Comparing the two as strings never matches, and the field that is on
  // the page in plain sight comes back unbound.
  const date = { type: "date", value: "2026-05-18", raw: "18 May 2026" };

  assert.equal(matches("18 May 2026", date), true);
  assert.equal(matches("2026-05-18", date), true);
  assert.equal(matches("19 May 2026", date), false, "a day apart is a different date");
});

test("a date fused to its label binds as a span", () => {
  // Verbatim from a pass over a photographed page: the recogniser returns the label and
  // the date as one region, and a date parser anchored to the whole string sees nothing.
  const out = bindField(
    { type: "date", value: "2026-05-18", raw: "18 May 2026" },
    [{ text: "Issue date: 18 May 2026", bbox: [90, 250, 470, 285], confidence: 0.93 }],
  );

  assert.equal(out.status, "span");
  assert.deepEqual(out.bbox, [90, 250, 470, 285]);
});

test("a binding carries the source of the region it came from", () => {
  // The gate has to tell a text-layer region, which has no confidence to report, from a
  // recognised one that failed to report its own.
  const fromText = bindField(amount(283140n), [
    { text: "2.831,40", bbox: [820, 500, 1020, 530], source: "text-layer" },
  ]);
  assert.equal(fromText.source, "text-layer");
  assert.equal(fromText.confidence, undefined);

  const fromOcr = bindField(amount(283140n), [
    { text: "2.831,40", bbox: [820, 500, 1020, 530], confidence: 0.94 },
  ]);
  assert.equal(fromOcr.source, undefined);
  assert.equal(fromOcr.confidence, 0.94);
});

test("a span inherits the source of its members", () => {
  const out = bindField(string("RW-2026-3310"), [
    { text: "Invoice no. RW-2026-3310", bbox: [120, 200, 480, 232], source: "text-layer" },
  ]);

  assert.equal(out.status, "span");
  assert.equal(out.source, "text-layer");
  assert.equal(out.confidence, undefined, "a span of text-layer items has no confidence either");
});

test("an integer binds to the number the page prints with its unit", () => {
  // The page prints "VAT 21%" and the field is the integer 21. Requiring digits alone
  // leaves a rate that is plainly on the page unbound, and the identity that needs it
  // never runs.
  const rate = { type: "integer", value: 21, raw: 21 };

  assert.equal(matches("21%", rate), true);
  assert.equal(matches("21", rate), true);
  assert.equal(matches("219", rate), false, "a longer number is a different number");
  assert.equal(matches("2.100", rate), false);
});

test("a rate fused into its row binds as a span", () => {
  // Verbatim shape from the corpus: the recogniser and the text layer both return the
  // label, the rate and the amount as one line.
  const out = bindField({ type: "integer", value: 21, raw: 21 }, [
    { text: "VAT 21%", bbox: [80, 600, 240, 630], confidence: 0.97 },
    { text: "90,91", bbox: [820, 600, 950, 630], confidence: 0.95 },
  ]);

  assert.equal(out.status, "span");
  assert.deepEqual(out.bbox, [80, 600, 240, 630]);
});
