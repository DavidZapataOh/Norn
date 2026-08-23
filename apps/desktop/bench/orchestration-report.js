"use strict";

const called = (trial, name) => trial.calls.filter((c) => c.name === name);

// The order is the classification. A trial that both omitted a step and answered wrongly is a
// step omission, because that is the mechanism; classifying by symptom would move a loud
// failure into the silent bucket and understate the thing that matters.
function classifyNaive(trial, { expected }) {
  if (trial.stopReason === "turn-cap") {
    return { outcome: "turn-cap", detail: `${trial.turns} turns without an answer` };
  }
  if (trial.errors.length) {
    return { outcome: "tool-error", detail: trial.errors.map((e) => `${e.code}: ${e.message}`).join("; ") };
  }

  const lookups = called(trial, "lookup_record");
  const variances = called(trial, "compute_variance");

  if (lookups.length === 0) {
    return { outcome: "other", detail: `no lookup_record: ${JSON.stringify(trial.calls)}` };
  }
  if (variances.length === 0) {
    // Loud: the answer is visibly incomplete and a reviewer notices in a second.
    return { outcome: "step-omission", detail: "compute_variance was never called" };
  }

  const returned = lookups[0].returned?.amount;
  const supplied = variances[0].arguments?.b;
  if (returned === undefined || supplied === undefined) {
    return { outcome: "other", detail: `unreadable call shape: ${JSON.stringify(trial.calls)}` };
  }
  if (supplied !== returned) {
    // Silent: well-typed, fluent, and wrong. Detected against what the tool actually returned
    // in this trial, so a lucky guess is still a substitution.
    return { outcome: "result-substitution",
             detail: `compute_variance received b=${supplied} where lookup_record returned ${returned}` };
  }

  const answer = variances[0].returned?.variance;
  if (answer !== expected.variance) {
    return { outcome: "other", detail: `variance ${answer} against expected ${expected.variance}` };
  }
  return { outcome: "correct", detail: `b=${supplied} came from the tool` };
}

function classifySlotBound(run, { expected, references = {} }) {
  if (run.stopReason === "turn-cap") {
    return { outcome: "turn-cap", detail: `${run.turns} turns without terminating` };
  }
  if (run.stopReason !== "terminal") {
    return { outcome: "other", detail: `stopped as ${run.stopReason}` };
  }

  if (!run.steps.some((s) => s.action === "compute_variance")) {
    return { outcome: "step-omission", detail: "compute_variance was never selected" };
  }

  // A misreference is any parameter given a slot that is admissible and wrong, and the report
  // has to name which one: a currency handed to a lookup and the same amount used twice are
  // different mistakes. Expected references are declared, not inferred, because inferring
  // them from the answer would classify a lucky choice as correct.
  for (const step of run.steps) {
    const want = references[step.action];
    if (!want) continue;
    for (const [param, key] of Object.entries(want)) {
      if (step.references[param] !== key) {
        return { outcome: "misreference",
                 detail: `${step.action}.${param} referenced ${step.references[param]} where ${key} belongs` };
      }
    }
  }

  if (run.answer !== BigInt(expected.variance)) {
    return { outcome: "other", detail: `answer ${run.answer} against expected ${expected.variance}` };
  }
  return { outcome: "correct", detail: "every reference was the one that belonged" };
}

module.exports = { classifyNaive, classifySlotBound };
