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

const OUTCOMES = ["correct", "step-omission", "result-substitution", "misreference",
                  "tool-error", "turn-cap", "other"];

// Clopper-Pearson upper bound at 95%, found by bisection rather than by a beta function, so
// this file keeps its only dependency: none.
//
// One-sided: the whole tail is spent upward, because the claim made from it is one-directional
// -- the failure rate is at most this. The two-sided limit puts alpha/2 in each tail and
// returns 0.3085 for zero in ten, which is a different quantity and 5 points looser. The
// closed form here is 1 - 0.05^(1/n), and 3/n is its approximation: the rule of three is an
// approximation to this bound, not an alternative to it.
function upperBound(failures, trials, confidence = 0.95) {
  if (trials === 0) return 1;
  const alpha = 1 - confidence;
  // P(X <= failures | p) for X ~ Binomial(trials, p): the bound is the p where this equals
  // alpha -- the largest rate that would still produce this few failures often enough.
  const atMost = (p) => {
    let sum = 0;
    for (let k = 0; k <= failures; k++) {
      let term = 1;
      for (let i = 0; i < k; i++) term = term * (trials - i) / (i + 1);
      sum += term * Math.pow(p, k) * Math.pow(1 - p, trials - k);
    }
    return sum;
  };

  let lo = failures / trials;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (atMost(mid) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function aggregate(classified) {
  const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const { outcome } of classified) {
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
  }
  const trials = classified.length;
  return { trials, byOutcome, correct: byOutcome.correct,
           rate: trials ? byOutcome.correct / trials : 0 };
}

const medianOf = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// The arms run in sequence on one machine and per-trial latency climbs across a run: measured,
// the drift within one arm was 1905 ms while the two medians were 308 ms apart, and the sign
// of that 308 ms reversed on a repeat run. A median difference smaller than the drift is a
// difference in when the trial ran, so the report says so rather than printing it.
function latencyVerdict(byArm) {
  const names = Object.keys(byArm);
  const medians = names.map((n) => medianOf(byArm[n]));
  const spread = Math.max(...names.map((n) => Math.max(...byArm[n]) - Math.min(...byArm[n])));
  const gap = Math.max(...medians) - Math.min(...medians);
  const faster = names[medians.indexOf(Math.min(...medians))];
  return { separable: gap > spread, gap, spread, faster,
           medians: Object.fromEntries(names.map((n, i) => [n, medians[i]])) };
}

module.exports = { classifyNaive, classifySlotBound, upperBound, aggregate, latencyVerdict,
                   OUTCOMES };
