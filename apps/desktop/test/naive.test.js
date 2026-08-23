"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runNaive, NAIVE_TOOLS, NAIVE_SYSTEM } = require("../lib/naive");

const host = {
  lookup_record: () => ({ amount: 52281 }),
  compute_variance: ({ a, b }) => ({ variance: a - b }),
};

function scripted(turns) {
  let i = 0;
  return {
    auditCompletion: async () =>
      turns[i++] ?? { text: "done", toolCalls: [], toolErrors: [], stopReason: "eos" },
  };
}

test("the two tools are declared with flat parameters", () => {
  // Tool parameter schemas in this SDK are flat: a type, a description, an optional enum, and
  // no nested objects or array item types. That the shape as a whole is one the SDK accepts is
  // checked against the SDK's own schema, not restated here.
  assert.equal(NAIVE_TOOLS.length, 2);
  for (const tool of NAIVE_TOOLS) {
    for (const property of Object.values(tool.parameters.properties)) {
      assert.ok(["string", "number", "integer", "boolean"].includes(property.type),
        `${tool.name} declares a non-flat parameter`);
    }
  }
});

test("the prompt states the procedure and forbids the model computing", () => {
  // A baseline beaten by a prompt nobody wrote properly proves nothing.
  assert.match(NAIVE_SYSTEM, /lookup_record/);
  assert.match(NAIVE_SYSTEM, /compute_variance/);
  assert.match(NAIVE_SYSTEM, /never/i);
});

test("a trial records what each tool returned, not only what it was called with", async () => {
  const audit = scripted([
    { text: "", toolCalls: [{ id: "1", name: "lookup_record", arguments: { reference: "NW-1" } }],
      toolErrors: [], stopReason: "eos" },
    { text: "", toolCalls: [{ id: "2", name: "compute_variance", arguments: { a: 52381, b: 52281 } }],
      toolErrors: [], stopReason: "eos" },
  ]);

  const trial = await runNaive({ audit, modelId: "m", seed: 1, host });

  // Substitution is detected against what the first call actually returned in this trial, so
  // a trial that invents a number which happens to be right is still a substitution.
  assert.equal(trial.calls[0].returned.amount, 52281);
  assert.equal(trial.calls[1].arguments.b, 52281);
});

test("a tool error is recorded and never retried", async () => {
  const audit = scripted([
    { text: "", toolCalls: [], toolErrors: [{ code: "VALIDATION_ERROR", message: "bad" }],
      stopReason: "eos" },
  ]);

  const trial = await runNaive({ audit, modelId: "m", seed: 1, host });

  assert.equal(trial.errors.length, 1);
  assert.equal(trial.errors[0].code, "VALIDATION_ERROR");
  // A retry would hide the rate this arm exists to measure.
  assert.equal(trial.calls.length, 0);
});

test("an unknown tool name is recorded rather than executed", async () => {
  const audit = scripted([
    { text: "", toolCalls: [{ id: "1", name: "delete_everything", arguments: {} }],
      toolErrors: [], stopReason: "eos" },
  ]);

  const trial = await runNaive({ audit, modelId: "m", seed: 1, host });

  assert.equal(trial.calls[0].returned, null);
  assert.match(trial.calls[0].error, /delete_everything/);
});

test("a trial that never terminates reports the cap", async () => {
  const audit = { auditCompletion: async () => ({
    text: "", toolCalls: [{ id: "x", name: "lookup_record", arguments: { reference: "NW-1" } }],
    toolErrors: [], stopReason: "eos" }) };

  const trial = await runNaive({ audit, modelId: "m", seed: 1, host, maxTurns: 3 });

  assert.equal(trial.stopReason, "turn-cap");
  assert.equal(trial.turns, 3);
});

test("the arm runs at 0.7 unless a temperature is asked for", async () => {
  // 0.7 is what a tool-calling deployment actually runs at, and the default has to be that
  // rather than the value that flatters the arm. The override exists so the comparison can
  // answer what the choice is worth instead of footnoting it.
  const seen = [];
  const audit = {
    auditCompletion: async (params) => {
      seen.push(params.generationParams.temp);
      return { text: "done", toolCalls: [], toolErrors: [], stopReason: "eos" };
    },
  };

  await runNaive({ audit, modelId: "m", seed: 1, host });
  await runNaive({ audit, modelId: "m", seed: 1, host, temp: 0 });

  assert.deepEqual(seen, [0.7, 0]);
});
