"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyNaive, classifySlotBound } = require("../bench/orchestration-report");

const expected = { variance: 100 };
const call = (name, args, returned) => ({ turn: 1, name, arguments: args, returned });

// Declared rather than inferred: a run that reached the right answer through the wrong slot
// is still a misreference, and only a declared expectation can say so.
const EXPECTED_REFERENCES = {
  lookup_record: { reference: "document.reference" },
  compute_variance: { documentAmount: "document.total", recordAmount: "record.amount" },
  report: { variance: "variance" },
};

test("a trial that called both tools with the returned value is correct", () => {
  const out = classifyNaive({
    calls: [
      call("lookup_record", { reference: "NW-1" }, { amount: 52281 }),
      call("compute_variance", { a: 52381, b: 52281 }, { variance: 100 }),
    ],
    errors: [], stopReason: "answered", answer: "The variance is 100.",
  }, { expected });

  assert.equal(out.outcome, "correct");
});

test("a trial that never called the second tool is a step omission, and it is loud", () => {
  const out = classifyNaive({
    calls: [call("lookup_record", { reference: "NW-1" }, { amount: 52281 })],
    errors: [], stopReason: "answered", answer: "The variance is 100.",
  }, { expected });

  assert.equal(out.outcome, "step-omission");
  assert.match(out.detail, /compute_variance/);
});

test("a second call carrying a value the first did not return is a substitution", () => {
  // Silent: well-typed, fluent, and wrong. Detected against the recorded return value.
  const out = classifyNaive({
    calls: [
      call("lookup_record", { reference: "NW-1" }, { amount: 52281 }),
      call("compute_variance", { a: 52381, b: 52000 }, { variance: 381 }),
    ],
    errors: [], stopReason: "answered", answer: "The variance is 381.",
  }, { expected });

  assert.equal(out.outcome, "result-substitution");
  assert.match(out.detail, /52000/);
  assert.match(out.detail, /52281/);
});

test("a substitution close enough to look right is still a substitution", () => {
  // The classification is mechanism-level. A near miss is not a working system.
  const out = classifyNaive({
    calls: [
      call("lookup_record", { reference: "NW-1" }, { amount: 52281 }),
      call("compute_variance", { a: 52381, b: 52280 }, { variance: 101 }),
    ],
    errors: [], stopReason: "answered", answer: "The variance is 100.",
  }, { expected });

  assert.equal(out.outcome, "result-substitution",
    "the answer read right and the mechanism was not");
});

test("omission outranks a wrong answer, because the mechanism is what is being classified", () => {
  const out = classifyNaive({
    calls: [call("lookup_record", { reference: "NW-1" }, { amount: 52281 })],
    errors: [], stopReason: "answered", answer: "The variance is 999.",
  }, { expected });

  // Classifying by symptom would move a loud failure into the silent bucket.
  assert.equal(out.outcome, "step-omission");
});

test("a tool error and a turn cap are their own outcomes", () => {
  assert.equal(classifyNaive({ calls: [], errors: [{ code: "PARSE_ERROR", message: "x" }],
    stopReason: "answered", answer: "" }, { expected }).outcome, "tool-error");

  assert.equal(classifyNaive({ calls: [], errors: [], stopReason: "turn-cap", answer: null },
    { expected }).outcome, "turn-cap");
});

test("anything unrecognised is quoted rather than bucketed", () => {
  const out = classifyNaive({
    calls: [call("compute_variance", { a: 1, b: 2 }, { variance: -1 })],
    errors: [], stopReason: "answered", answer: "?",
  }, { expected });

  assert.equal(out.outcome, "other");
  // A taxonomy that absorbs everything has stopped observing.
  assert.match(out.detail, /compute_variance/);
});

test("the slot-bound arm is classified against the same expectation", () => {
  const correct = classifySlotBound({
    stopReason: "terminal", answer: 100n,
    steps: [
      { action: "lookup_record", references: { reference: "document.reference" } },
      { action: "compute_variance", references: { documentAmount: "document.total", recordAmount: "record.amount" } },
      { action: "report", references: { variance: "variance" } },
    ],
  }, { expected, references: EXPECTED_REFERENCES });

  assert.equal(correct.outcome, "correct");
});

test("the same amount used twice is a misreference, and the report names the parameter", () => {
  const out = classifySlotBound({
    stopReason: "terminal", answer: 0n,
    steps: [
      { action: "lookup_record", references: { reference: "document.reference" } },
      { action: "compute_variance", references: { documentAmount: "document.total", recordAmount: "document.total" } },
      { action: "report", references: { variance: "variance" } },
    ],
  }, { expected, references: EXPECTED_REFERENCES });

  assert.equal(out.outcome, "misreference");
  assert.match(out.detail, /recordAmount referenced document\.total/);
});

test("a currency handed to a lookup is a misreference, and the report names the parameter", () => {
  // Reachable on the reference task: both are strings the document asserts, so the grammar
  // offers both and the model can legally pick the wrong one.
  const out = classifySlotBound({
    stopReason: "terminal", answer: 100n,
    steps: [
      { action: "lookup_record", references: { reference: "document.currency" } },
      { action: "compute_variance", references: { documentAmount: "document.total", recordAmount: "record.amount" } },
      { action: "report", references: { variance: "variance" } },
    ],
  }, { expected, references: EXPECTED_REFERENCES });

  assert.equal(out.outcome, "misreference");
  assert.match(out.detail, /lookup_record\.reference referenced document\.currency/,
    "a misreference nobody can locate is a misreference nobody can fix");
});
