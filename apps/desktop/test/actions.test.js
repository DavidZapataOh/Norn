"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSlots } = require("../lib/slots");
const { RECONCILE_ACTIONS, legalActions } = require("../lib/actions");

function started() {
  // What the host puts in the store before the model is asked anything: the document is
  // already read, which is the earlier stages' job.
  const slots = createSlots();
  slots.put("document.reference", { type: "string", value: "NW-2026-0117", provenance: "document-asserted" });
  slots.put("document.currency", { type: "string", value: "EUR", provenance: "document-asserted" });
  slots.put("document.total", { type: "amount", value: 52381n, provenance: "document-asserted" });
  return slots;
}

const names = (slots) => legalActions(RECONCILE_ACTIONS, slots).map((a) => a.name).sort();

test("an action whose inputs are not in the store is not offered", () => {
  // Nothing has been looked up yet, so there is no record amount to compare against.
  assert.deepEqual(names(started()), ["lookup_record"]);
});

test("the terminal action is withheld until the result it reports exists", () => {
  const slots = started();
  slots.put("record.amount", { type: "amount", value: 52281n, provenance: "source-attested" });

  // The comparison is now legal and the report still is not: there is no variance to report.
  assert.deepEqual(names(slots), ["compute_variance"]);

  slots.put("variance", { type: "amount", value: 100n, provenance: "host-computed" });
  assert.deepEqual(names(slots), ["report"]);
});

test("finishing early is not expressible, which is the point", () => {
  const slots = started();

  assert.ok(!names(slots).includes("report"));
  slots.put("record.amount", { type: "amount", value: 52281n, provenance: "source-attested" });
  assert.ok(!names(slots).includes("report"));
});

test("an action that has already produced its slot is not offered again", () => {
  const slots = started();
  slots.put("record.amount", { type: "amount", value: 52281n, provenance: "source-attested" });

  assert.ok(!names(slots).includes("lookup_record"),
    "a loop that can look up forever never terminates");
});

test("every action's host function is the only thing that computes anything", () => {
  for (const action of RECONCILE_ACTIONS) {
    assert.equal(typeof action.run, "function", `${action.name} has no host function`);
    assert.ok(action.describe.length > 0, `${action.name} has no description for the model`);
    for (const p of action.params) {
      assert.ok(p.type, `${action.name}.${p.name} has no type`);
    }
  }
});

const { actionGrammar, referenceGrammar } = require("../lib/actions");

test("the action grammar contains exactly the legal names", () => {
  const slots = started();
  const { name, schema } = actionGrammar(legalActions(RECONCILE_ACTIONS, slots));

  assert.equal(name, "action");
  assert.deepEqual(schema.properties.action.enum, ["lookup_record"]);
  assert.deepEqual(schema.required, ["action"]);
  assert.equal(schema.additionalProperties, false, "an unlisted key must be unreachable");
});

test("an illegal action has no token to emit it", () => {
  const slots = started();
  const { schema } = actionGrammar(legalActions(RECONCILE_ACTIONS, slots));

  assert.ok(!schema.properties.action.enum.includes("report"),
    "the model can express a step the host has not permitted");
});

test("a reference grammar offers only the slots admissible for each parameter", () => {
  const slots = started();
  slots.put("record.amount", { type: "amount", value: 52281n, provenance: "source-attested" });
  const compare = RECONCILE_ACTIONS.find((a) => a.name === "compute_variance");

  const { schema } = referenceGrammar(compare, slots);

  // The case this design exists for: both parameters are amounts, and each may reference
  // only the one whose origin is right. Admitting both would let the model legally compute
  // the document's total against itself.
  assert.deepEqual(schema.properties.documentAmount.enum, ["document.total"]);
  assert.deepEqual(schema.properties.recordAmount.enum, ["record.amount"]);
  assert.deepEqual(schema.required.sort(), ["documentAmount", "recordAmount"]);
});

test("the same state compiles to the same grammar, byte for byte", () => {
  const a = JSON.stringify(actionGrammar(legalActions(RECONCILE_ACTIONS, started())));
  const b = JSON.stringify(actionGrammar(legalActions(RECONCILE_ACTIONS, started())));

  assert.equal(a, b);
});

test("an action with no parameters compiles to a grammar with no properties", () => {
  const noParams = { name: "halt", describe: "Stop.", params: [], run: () => null };
  const { schema } = referenceGrammar(noParams, started());

  assert.deepEqual(schema.properties, {});
  assert.deepEqual(schema.required, []);
});
