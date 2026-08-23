"use strict";

// A floor, not a decision. Measured twice on two corpora: a wrong reading scored 0.983
// while a correct one scored 0.523, so no confidence value is evidence on its own. These
// numbers exist to reject the clearly unreadable, and every admission needs the other
// signals as well.
const DEFAULT_THRESHOLDS = {
  confidence: { string: 0.35, amount: 0.5, date: 0.4, integer: 0.5 },
};

// A wider binding is weaker evidence, so it raises the floor rather than disqualifying the
// value. Spans are 10 of 44 fields on the reference corpus: refusing them outright would
// abstain on a quarter of every scanned document for a reason that is not a reading failure.
const WIDTH_PENALTY = { region: 0, span: 0.15 };

function judge(field, thresholds = DEFAULT_THRESHOLDS) {
  const { key, coerced, binding, arithmetic } = field;
  const where = {
    // The declined value travels with the abstention. The report scores it against truth to
    // say how many abstentions would have been right, which is what stops caution looking
    // free.
    value: coerced.value,
    type: coerced.type,
    bbox: binding.bbox,
    confidence: binding.confidence,
    text: binding.text,
    ...(binding.source ? { source: binding.source } : {}),
  };
  const abstain = (check, reason) => ({ key, admitted: false, check, reason, ...where });

  if (coerced.value === null || coerced.value === undefined) {
    return abstain("absent", "the model reported no value for this field");
  }
  if (binding.status === "unbound") {
    return abstain("binding", binding.reason ?? "value not found on the page");
  }

  const floor = (thresholds.confidence[coerced.type] ?? 0.5) + (WIDTH_PENALTY[binding.status] ?? 0);
  let confidenceCheck;
  if (binding.source === "text-layer") {
    // The file states these characters rather than guessing them, so there is nothing to
    // measure. Recorded as an exemption, because an admission that skipped the floor must
    // not read like one that cleared it.
    confidenceCheck = "not applicable";
  } else if (typeof binding.confidence !== "number") {
    // Recognition always reports a confidence. Its absence is a failure upstream, not an
    // exemption, and admitting here would let a bug pass as a passed check.
    return abstain("confidence", "no confidence was reported for a recognised region");
  } else if (binding.confidence < floor) {
    return abstain("confidence",
      `read at ${binding.confidence.toFixed(3)}, below the ${floor.toFixed(2)} floor for a ` +
      `${coerced.type} bound at ${binding.status} width`);
  } else {
    confidenceCheck = "passed";
  }

  if (arithmetic && arithmetic.ok === false) {
    return abstain("arithmetic", `the document does not agree with itself: ${arithmetic.identity}`);
  }

  return {
    key,
    admitted: true,
    value: coerced.value,
    type: coerced.type,
    bbox: binding.bbox,
    confidence: binding.confidence,
    width: binding.status,
    ...(binding.source ? { source: binding.source } : {}),
    // Which signals actually ran. An admission on the text path is defended by binding and
    // arithmetic alone, and saying so is the difference between a weaker defence and a
    // hidden one.
    checks: {
      confidence: confidenceCheck,
      binding: binding.status,
      arithmetic: arithmetic ? (arithmetic.ok ? "passed" : "failed") : "not checked",
    },
    ...(binding.contested ? { contested: binding.contested } : {}),
  };
}

function judgeAll(coerced, bindings, { arithmetic = {}, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const fields = {};
  const byCheck = {};
  let admitted = 0, abstained = 0, confidenceNotApplicable = 0;

  for (const [key, value] of Object.entries(coerced)) {
    const verdict = judge({
      key,
      coerced: value,
      binding: bindings[key] ?? { status: "unbound", reason: "no binding was attempted" },
      arithmetic: arithmetic[key],
    }, thresholds);

    fields[key] = verdict;
    if (verdict.admitted) {
      admitted++;
      // Counted so a summary cannot report the same coverage for a document whose floor
      // never ran and one that cleared it.
      if (verdict.checks.confidence === "not applicable") confidenceNotApplicable++;
    } else {
      abstained++;
      // The split is what makes the gate improvable: all-binding abstentions mean the model
      // is producing values that are not on the page, all-confidence means the recogniser
      // is struggling. Without it both read as "the gate abstained a lot".
      byCheck[verdict.check] = (byCheck[verdict.check] ?? 0) + 1;
    }
  }

  return { fields, admitted, abstained, confidenceNotApplicable, byCheck };
}

module.exports = { judge, judgeAll, DEFAULT_THRESHOLDS };
