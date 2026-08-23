"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSlots, PROVENANCE } = require("../lib/slots");

test("a slot carries a type, a value and where the value came from", () => {
  const slots = createSlots();
  slots.put("document.total", { type: "amount", value: 52381n, provenance: "document-asserted" });

  const slot = slots.get("document.total");
  assert.equal(slot.type, "amount");
  assert.equal(slot.value, 52381n);
  assert.equal(slot.provenance, "document-asserted");
});

test("provenance is required, because a value with no origin cannot be excluded by one", () => {
  const slots = createSlots();

  assert.throws(() => slots.put("x", { type: "amount", value: 1n }), /provenance/);
  assert.throws(() => slots.put("x", { type: "amount", value: 1n, provenance: "somewhere" }), /somewhere/);
  assert.deepEqual(PROVENANCE, ["document-asserted", "source-attested", "host-computed"]);
});

test("a slot is written once, because a trace cannot describe an overwrite", () => {
  const slots = createSlots();
  slots.put("record.amount", { type: "amount", value: 52381n, provenance: "source-attested" });

  assert.throws(
    () => slots.put("record.amount", { type: "amount", value: 999n, provenance: "source-attested" }),
    /already written/,
  );
  assert.equal(slots.get("record.amount").value, 52381n, "the second write took effect anyway");
});

test("keys come back in the order they were written", () => {
  const slots = createSlots();
  slots.put("b", { type: "amount", value: 1n, provenance: "host-computed" });
  slots.put("a", { type: "amount", value: 2n, provenance: "host-computed" });

  assert.deepEqual(slots.keys(), ["b", "a"], "sorting would make the rendering depend on the names");
});

test("an unknown key is a throw, not undefined", () => {
  const slots = createSlots();

  // A dereference that silently yields undefined puts a missing value into a host function,
  // which is the failure mode this whole design removes.
  assert.throws(() => slots.get("nothing.here"), /nothing\.here/);
});

function twoAmounts() {
  const slots = createSlots();
  slots.put("document.total", { type: "amount", value: 52381n, provenance: "document-asserted" });
  slots.put("record.amount", { type: "amount", value: 52281n, provenance: "source-attested" });
  slots.put("document.vendor", { type: "string", value: "Northwind", provenance: "document-asserted" });
  return slots;
}

test("a reference set excludes slots of the wrong type", () => {
  const refs = twoAmounts().referencesFor({ type: "amount" });

  assert.deepEqual(refs.sort(), ["document.total", "record.amount"]);
});

test("a reference set excludes slots of the wrong origin, which type alone cannot", () => {
  // The case this product is about: a variance is one document amount against one record
  // amount. Both are amounts. A set that admits both lets the model legally compute the
  // document's total against itself and report a variance of zero -- a clean trace, a
  // well-typed call, and a wrong answer.
  const slots = twoAmounts();

  assert.deepEqual(slots.referencesFor({ type: "amount", provenance: "source-attested" }),
    ["record.amount"]);
  assert.deepEqual(slots.referencesFor({ type: "amount", provenance: "document-asserted" }),
    ["document.total"]);
});

test("a reference set with nothing admissible is empty, not everything", () => {
  const refs = twoAmounts().referencesFor({ type: "date" });

  // An empty set is what makes an action illegal. Falling back to every slot would make an
  // action with no valid input look available.
  assert.deepEqual(refs, []);
});

const { formatMinor } = require("../lib/money");

test("the rendering shows every slot with its value and its origin", () => {
  const text = twoAmounts().render();

  assert.match(text, /document\.total/);
  assert.match(text, /523\.81/, "the model cannot reason about a value it is not shown");
  assert.match(text, /source-attested/);
});

test("an amount renders through the one formatter this repository has", () => {
  const slots = createSlots();
  slots.put("x", { type: "amount", value: 283140n, provenance: "host-computed" });

  assert.ok(slots.render().includes(formatMinor(283140n)),
    "a second money formatter here would drift from the one everything else uses");
});

test("the rendering is exactly this text, and nothing may be added to it", () => {
  // Comparing two renders taken microseconds apart does not catch a timestamp: both fall in
  // the same millisecond and agree. A later sprint replays a run and compares digests, so
  // the assertion has to be the text itself.
  assert.equal(twoAmounts().render(), [
    "document.total : amount (document-asserted) = 523.81",
    "record.amount : amount (source-attested) = 522.81",
    "document.vendor : string (document-asserted) = Northwind",
  ].join("\n"));
});

test("adding a slot changes the rendering, so the prompt tracks the state", () => {
  const slots = twoAmounts();
  const before = slots.render();
  slots.put("variance", { type: "amount", value: 100n, provenance: "host-computed" });

  assert.notEqual(slots.render(), before);
});
