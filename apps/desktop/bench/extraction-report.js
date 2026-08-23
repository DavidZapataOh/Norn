"use strict";
const { parseAmount } = require("../lib/money");
const { coerceDate } = require("../lib/schema");

// Ground truth is the printed string; the gate holds a coerced value. An amount compares
// through its minor units so the convention the page used is irrelevant, which is the same
// rule the reading report used.
function agrees(verdictValue, type, truthText) {
  if (verdictValue === null || verdictValue === undefined) return false;
  if (type === "amount") {
    const want = parseAmount(truthText);
    return want !== null && want.minor === verdictValue;
  }
  if (type === "date") {
    // The gate holds the coerced ISO value while truth is what the page printed. Compared
    // as strings every correct date scores as wrong, and the wrongly-admitted count fills
    // up with this scorer's own defect.
    return coerceDate(truthText) === verdictValue;
  }
  if (type === "integer") return Number(truthText) === verdictValue;
  const loose = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return loose(verdictValue) === loose(truthText);
}

function scoreDocument(truthFields, judged) {
  let admittedRight = 0, admittedWrong = 0;
  let abstainedWouldBeRight = 0, abstainedWouldBeWrong = 0;
  const byCheck = {};

  for (const want of truthFields) {
    const verdict = judged[want.field];

    if (!verdict) {
      // A field the gate never produced is a silent abstention, and silence is what this
      // product exists to remove. It is counted, never skipped.
      abstainedWouldBeWrong++;
      byCheck.missing = (byCheck.missing ?? 0) + 1;
      continue;
    }

    const right = agrees(verdict.value, verdict.type, want.text);
    if (verdict.admitted) {
      if (right) admittedRight++;
      else admittedWrong++;
      continue;
    }

    // The cost line. A gate that abstains on everything has a perfect wrongly-admitted
    // rate and is useless; only this number exposes that.
    if (right) abstainedWouldBeRight++;
    else abstainedWouldBeWrong++;
    byCheck[verdict.check] = (byCheck[verdict.check] ?? 0) + 1;
  }

  return { admittedRight, admittedWrong, abstainedWouldBeRight, abstainedWouldBeWrong, byCheck };
}

function aggregateExtraction(results) {
  const totals = {
    admittedRight: 0, admittedWrong: 0,
    abstainedWouldBeRight: 0, abstainedWouldBeWrong: 0,
  };
  const byCheck = {};

  for (const r of results) {
    for (const k of Object.keys(totals)) totals[k] += r[k] ?? 0;
    for (const [check, n] of Object.entries(r.byCheck ?? {})) {
      byCheck[check] = (byCheck[check] ?? 0) + n;
    }
  }

  const admitted = totals.admittedRight + totals.admittedWrong;
  const fields = admitted + totals.abstainedWouldBeRight + totals.abstainedWouldBeWrong;

  return {
    ...totals, byCheck, fields, admitted,
    coverage: fields ? admitted / fields : 0,
    precision: admitted ? totals.admittedRight / admitted : 0,
  };
}

module.exports = { scoreDocument, aggregateExtraction, agrees };
