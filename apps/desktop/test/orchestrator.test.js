"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSlots } = require("../lib/slots");
const { RECONCILE_ACTIONS } = require("../lib/actions");
const { runLoop } = require("../lib/orchestrator");

function started() {
  const slots = createSlots();
  slots.put("document.reference", { type: "string", value: "NW-2026-0117", provenance: "document-asserted" });
  slots.put("document.currency", { type: "string", value: "EUR", provenance: "document-asserted" });
  slots.put("document.total", { type: "amount", value: 52381n, provenance: "document-asserted" });
  return slots;
}

// The host's only job here: answer a lookup. It is ordinary code.
const host = { lookup: () => 52281n };

// A selector that always takes the first option the grammar offers. A legal player, not a
// clever one, which is what the loop should be tested against.
const firstChoice = async ({ kind, grammar }) => {
  if (kind === "action") return { action: grammar.schema.properties.action.enum[0] };
  return Object.fromEntries(Object.entries(grammar.schema.properties)
    .map(([name, p]) => [name, p.enum[0]]));
};

test("the loop reaches a terminal state on the reference task", async () => {
  const slots = started();
  const run = await runLoop({ actions: RECONCILE_ACTIONS, slots, select: firstChoice, host });

  assert.equal(run.stopReason, "terminal");
  assert.deepEqual(run.steps.map((s) => s.action), ["lookup_record", "compute_variance", "report"]);
  assert.equal(run.answer, 100n, "52381 minus 52281 is not what the host computed");
});

test("a step records the key it referenced, never the value", async () => {
  const slots = started();
  const run = await runLoop({ actions: RECONCILE_ACTIONS, slots, select: firstChoice, host });

  const compare = run.steps.find((s) => s.action === "compute_variance");
  assert.deepEqual(compare.references, { documentAmount: "document.total", recordAmount: "record.amount" });
  // The residual failure of this design is a legal but wrong slot. Recording the key is what
  // lets a reviewer see which one was used; a recorded value shows a plausible number and
  // nothing else.
  for (const value of Object.values(compare.references)) {
    assert.equal(typeof value, "string");
  }
});

test("no host function receives a value that did not come from a slot", async () => {
  const seen = [];
  const watching = { lookup: (reference) => { seen.push(reference); return 52281n; } };

  await runLoop({ actions: RECONCILE_ACTIONS, slots: started(), select: firstChoice, host: watching });

  // The selector emitted the key "document.reference"; the host function received the value
  // the store holds under it. That substitution is the guarantee.
  assert.deepEqual(seen, ["NW-2026-0117"]);
});

test("the result of a step is written back under the key its action declares", async () => {
  const slots = started();
  await runLoop({ actions: RECONCILE_ACTIONS, slots, select: firstChoice, host });

  assert.equal(slots.get("record.amount").value, 52281n);
  assert.equal(slots.get("record.amount").provenance, "source-attested");
  assert.equal(slots.get("variance").value, 100n);
  assert.equal(slots.get("variance").provenance, "host-computed");
});

test("a selector that returns an action outside the grammar is refused", async () => {
  const cheating = async ({ kind }) =>
    kind === "action" ? { action: "report" } : { variance: "variance" };

  // The grammar makes this unreachable in production. The loop refuses it anyway, because a
  // loop that trusts its input has no way to notice when the grammar stops being applied.
  await assert.rejects(
    () => runLoop({ actions: RECONCILE_ACTIONS, slots: started(), select: cheating, host }),
    /report.*not legal/s,
  );
});

test("a loop that cannot converge reports the cap, not an answer", async () => {
  // An action set with no terminal step: legal forever, finished never.
  const endless = [{
    name: "spin", describe: "Do nothing useful.",
    params: [{ name: "any", type: "string", provenance: "document-asserted" }],
    run: () => null,
  }];

  const run = await runLoop({ actions: endless, slots: started(), select: firstChoice, host, maxTurns: 4 });

  assert.equal(run.stopReason, "turn-cap");
  assert.equal(run.answer, null);
  assert.equal(run.turns, 4);
  assert.equal(run.steps.length, 4, "a capped run must still show what it did");
});

test("a state with no legal move is distinguishable from a cap", async () => {
  const run = await runLoop({
    actions: RECONCILE_ACTIONS, slots: createSlots(), select: firstChoice, host,
  });

  assert.equal(run.stopReason, "no-legal-action");
  // A defect in the action set, not a failure of the model, and conflating the two sends
  // somebody looking in the wrong place.
  assert.equal(run.turns, 0);
  assert.deepEqual(run.steps, []);
});

test("the terminal answer is the host's return value", async () => {
  const run = await runLoop({ actions: RECONCILE_ACTIONS, slots: started(), select: firstChoice, host });

  assert.equal(run.stopReason, "terminal");
  assert.equal(typeof run.answer, "bigint");
});

const { createSelector, SYSTEM } = require("../lib/orchestrator");

test("the selector sends the grammar it was given and nothing else", async () => {
  const sent = [];
  const audit = {
    auditCompletion: async (params) => {
      sent.push(params);
      return { text: '{"action":"lookup_record"}', stats: {} };
    },
  };
  const select = createSelector({ audit, modelId: "m1", seed: 7 });

  const out = await select({
    kind: "action",
    grammar: { name: "action", schema: { type: "object", properties: { action: { enum: ["lookup_record"] } } } },
    prompt: "document.total : amount (document-asserted) = 523.81",
  });

  assert.deepEqual(out, { action: "lookup_record" });
  const params = sent[0];
  assert.equal(params.responseFormat.json_schema.name, "action");
  assert.equal(params.kvCache, false, "a shared cache bleeds the previous step into this one");
  assert.equal(params.generationParams.temp, 0);
  assert.equal(params.generationParams.seed, 7);
  assert.equal(params.tools, undefined, "responseFormat and tools cannot be sent together");
  assert.ok(params.history.at(-1).content.includes("523.81"),
    "the model cannot choose between values it was not shown");
});

test("the seed advances per call, so two calls in a step are not the same call", async () => {
  const seeds = [];
  const audit = {
    auditCompletion: async (params) => {
      seeds.push(params.generationParams.seed);
      return { text: '{"action":"lookup_record"}', stats: {} };
    },
  };
  const select = createSelector({ audit, modelId: "m1", seed: 100 });
  const grammar = { name: "action", schema: { type: "object", properties: {} } };

  await select({ kind: "action", grammar, prompt: "" });
  await select({ kind: "references", grammar, prompt: "" });

  assert.deepEqual(seeds, [100, 101]);
});

test("a response the grammar should have prevented fails loudly", async () => {
  const audit = { auditCompletion: async () => ({ text: "I think we should look it up.", stats: {} }) };
  const select = createSelector({ audit, modelId: "m1", seed: 1 });

  await assert.rejects(
    () => select({ kind: "action", grammar: { name: "action", schema: {} }, prompt: "" }),
    /not valid JSON/,
  );
});

test("the system turn forbids computing, since the host does that", () => {
  assert.match(SYSTEM, /never/i);
});
