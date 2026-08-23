"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTrace, verifyChain, GENESIS } = require("../lib/trace");

const step = (over = {}) => ({
  stage: "extract", action: "fromText",
  reads: ["document.bytes"], writes: "document.values",
  digest: "a".repeat(64), ...over,
});

test("the same steps in the same order produce the same root", () => {
  const a = createTrace(); a.append(step()); a.append(step({ stage: "bind" }));
  const b = createTrace(); b.append(step()); b.append(step({ stage: "bind" }));

  assert.equal(a.root(), b.root());
  assert.notEqual(a.root(), GENESIS);
});

test("altering one record changes the root", () => {
  const before = createTrace(); before.append(step()); before.append(step({ stage: "bind" }));
  const after = createTrace(); after.append(step()); after.append(step({ stage: "gate" }));

  assert.notEqual(after.root(), before.root());
});

test("reordering two records changes the root", () => {
  // Without chaining, a set of records has no order and a reordered trace tells a different
  // story with the same digest.
  const forward = createTrace();
  forward.append(step({ stage: "bind" })); forward.append(step({ stage: "gate" }));
  const backward = createTrace();
  backward.append(step({ stage: "gate" })); backward.append(step({ stage: "bind" }));

  assert.notEqual(forward.root(), backward.root());
});

test("a record cannot carry a value, because there is nowhere to put one", () => {
  // The rule is that the trace records decisions, not figures. A rule kept by convention is a
  // rule that ends. append refuses any key it does not know.
  const trace = createTrace();

  assert.throws(() => trace.append(step({ value: 52381 })), /value/);
  assert.throws(() => trace.append(step({ amountMinor: "52381" })), /amountMinor/);
});

test("a record missing a required key is refused, naming the key", () => {
  const trace = createTrace();
  const { digest, ...withoutDigest } = step();

  assert.throws(() => trace.append(withoutDigest), /digest/);
});

test("a chain recomputed from the records alone reaches the same root", () => {
  // The verifier holds records out of a certificate, not a live trace.
  const trace = createTrace();
  trace.append(step()); trace.append(step({ stage: "bind" })); trace.append(step({ stage: "gate" }));

  const out = verifyChain(trace.records());

  assert.equal(out.ok, true);
  assert.equal(out.root, trace.root());
  assert.equal(out.brokenAt, null);
});

test("a chain with one record edited names the record that broke it", () => {
  // "The chain is broken" is not actionable. "Record 1 does not follow record 0" is.
  const trace = createTrace();
  trace.append(step()); trace.append(step({ stage: "bind" })); trace.append(step({ stage: "gate" }));

  const tampered = trace.records().map((r, i) => (i === 1 ? { ...r, stage: "gate" } : r));
  const out = verifyChain(tampered);

  assert.equal(out.ok, false);
  assert.equal(out.brokenAt, 1);
});

test("a chain with two records swapped names the earlier of the two", () => {
  const trace = createTrace();
  trace.append(step({ stage: "bind" })); trace.append(step({ stage: "gate" }));

  const swapped = [trace.records()[1], trace.records()[0]];

  assert.equal(verifyChain(swapped).brokenAt, 0);
});

test("an empty trace has the genesis root, and it is not an empty string", () => {
  // A root that is falsy when nothing happened invites a verifier to skip the check.
  assert.equal(createTrace().root(), GENESIS);
  assert.equal(GENESIS.length, 64);
  assert.notEqual(GENESIS, "0".repeat(64));
});

test("records() hands out copies, so a caller cannot edit the trace it was given", () => {
  const trace = createTrace();
  trace.append(step());
  const rootBefore = trace.root();

  trace.records()[0].stage = "gate";

  assert.equal(trace.records()[0].stage, "extract");
  assert.equal(trace.root(), rootBefore);
});
