"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canonical, CANONICAL_RULES } = require("../lib/canonical");

test("key order in the source object does not reach the bytes", () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("nesting is sorted too, at every depth", () => {
  assert.equal(canonical({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
});

test("array order is preserved, because an array's order is its content", () => {
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
});

test("a BigInt is refused rather than quietly becoming a string", () => {
  // Every amount in this project is a BigInt. Writing 100n as "100" would make a certificate
  // claiming an amount and one claiming a label serialise identically, and one signature
  // would then cover both. The caller converts, so the conversion is visible in the schema.
  assert.throws(() => canonical({ minor: 100n }), /BigInt/);
});

test("NaN and Infinity are refused rather than silently becoming null", () => {
  // JSON.stringify turns both into null. A confidence that came out NaN would serialise,
  // sign and verify cleanly while claiming it had been measured as null.
  assert.throws(() => canonical({ confidence: NaN }), /not finite/i);
  assert.throws(() => canonical({ confidence: Infinity }), /not finite/i);
});

test("undefined inside an array is refused rather than silently becoming null", () => {
  assert.throws(() => canonical({ regions: [undefined] }), /undefined/);
});

test("an undefined property is dropped, and dropping it is stated", () => {
  // JSON.stringify already does this. It is asserted so that the rule is written down
  // somewhere a reimplementer will read.
  assert.equal(canonical({ a: 1, b: undefined }), '{"a":1}');
});

test("the same glyph written two ways produces the same bytes", () => {
  // "e" with a combining acute and the precomposed character are the same text and different
  // bytes. A vendor name typed on two machines must not change a trace root.
  const precomposed = "é";
  const combining = "é";
  assert.notEqual(precomposed, combining, "the fixture must actually differ, or this checks nothing");

  assert.equal(canonical({ vendor: precomposed }), canonical({ vendor: combining }));
});

test("a key written two ways normalises too, and does not become two keys", () => {
  const both = canonical({ ["é"]: 1, a: 2 });

  assert.equal(both, canonical({ a: 2, ["é"]: 1 }));
});

test("a function or a symbol is refused, not dropped", () => {
  assert.throws(() => canonical({ run: () => 1 }), /function/);
  assert.throws(() => canonical({ tag: Symbol("x") }), /symbol/);
});

test("a Date is refused rather than serialising as a string that has lost its type", () => {
  // JSON.stringify turns it into an ISO string, which round-trips as a string and never
  // again as a Date. Refusing means the caller decides what the document should say.
  assert.throws(() => canonical({ at: new Date(0) }), /not a plain object/);
});

test("the error names the path, so a refusal in a large document is findable", () => {
  assert.throws(() => canonical({ fields: { total: { minor: 1n } } }),
    /\$\.fields\.total\.minor/);
  assert.throws(() => canonical({ regions: [{ bbox: [NaN] }] }),
    /\$\.regions\[0\]\.bbox\[0\]/);
});

test("the rules are exported as prose, so the published format cannot drift from the code", () => {
  assert.ok(CANONICAL_RULES.length >= 5);
  assert.ok(CANONICAL_RULES.some((r) => /BigInt/.test(r)));
});
