"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyNaive, classifySlotBound, upperBound, aggregate, latencyVerdict } =
  require("../bench/orchestration-report");

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

test("zero failures in ten trials bounds the rate at about a quarter, not at zero", () => {
  // The most over-read number in software. Computed rather than quoted, so the sentence in
  // the report is checkable and moves when the trial count does.
  const bound = upperBound(0, 10);

  // Tight enough to tell the one-sided bound from the two-sided one, which is 0.3085. A range
  // spanning both would pass whichever was implemented and check nothing.
  assert.ok(bound > 0.255 && bound < 0.262, `expected roughly 0.259, got ${bound}`);
});

test("the rule of three is an approximation to this bound, not a different answer", () => {
  // 3/n is the large-n limit of 1 - 0.05^(1/n). At n=10 the approximation is still 4 points
  // loose, which is the reason the report computes the bound instead of quoting 3/n.
  for (const n of [10, 100, 1000]) {
    assert.ok(upperBound(0, n) < 3 / n, `the exact bound at n=${n} should be under 3/n`);
  }
  assert.ok(Math.abs(upperBound(0, 1000) - 3 / 1000) < 0.0002, "they should converge");
});

test("the bound tightens as trials grow", () => {
  assert.ok(upperBound(0, 100) < upperBound(0, 10));
  assert.ok(upperBound(0, 1000) < upperBound(0, 100));
});

test("a bound with failures in it is above the observed rate", () => {
  // Two failures in ten is an observed 20%, and the interval must not claim to know that
  // exactly.
  const bound = upperBound(2, 10);

  assert.ok(bound > 0.2, "an upper bound below the observed rate is not an upper bound");
  assert.ok(bound < 0.6);
});

test("the aggregate keeps every outcome class, including the empty ones", () => {
  const out = aggregate([
    { outcome: "correct" }, { outcome: "correct" },
    { outcome: "result-substitution" },
  ]);

  assert.equal(out.trials, 3);
  assert.equal(out.correct, 2);
  assert.equal(out.byOutcome["result-substitution"], 1);
  // A report that omits a zero reads as a report that did not check for it.
  assert.equal(out.byOutcome["step-omission"], 0);
  assert.equal(out.byOutcome["misreference"], 0);
});

test("a latency difference smaller than the spread within either arm is not separable", () => {
  // The arms run in sequence on one machine and per-trial latency climbs across a run, so a
  // median difference smaller than that drift says nothing about the architectures.
  const naive = [6780, 7074, 7267, 7369, 7476, 7676, 8078, 8185, 8283, 8685];
  const slot = [7575, 7886, 7876, 7990, 7978, 8085, 7879, 7876, 7882, 7982];

  const out = latencyVerdict({ naive, "slot-bound": slot });

  assert.equal(out.separable, false, "308 ms apart with a 1905 ms spread is not a difference");
  assert.equal(out.spread, 1905);
});

test("a latency difference larger than both spreads is separable", () => {
  const out = latencyVerdict({ fast: [100, 110, 120], slow: [900, 910, 920] });

  assert.equal(out.separable, true);
  assert.equal(out.faster, "fast");
});
