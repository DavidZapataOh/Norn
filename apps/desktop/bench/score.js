"use strict";

const { parseAmount: parseMoney, formatMinor } = require("../lib/money");

// The scorer compares against fixture values written as JSON numbers, so it works in
// Number while the pipeline works in minor units. One parser decides what an amount is.
function parseAmount(raw) {
  const parsed = parseMoney(raw);
  return parsed === null ? null : Number(formatMinor(parsed.minor));
}

// A model may return an amount as a number or as a string in either decimal
// convention. All three are the same answer, and scoring them apart would report
// a correct model as failing.
function normalise(value) {
  if (typeof value !== "string") return value;
  const parsed = parseAmount(value);
  return parsed === null ? value : parsed;
}

function scoreDocument(expected, actual) {
  const wrong = [];
  const fields = Object.keys(expected);

  for (const field of fields) {
    const present = actual !== null && actual !== undefined && field in actual;
    if (!present || normalise(actual[field]) !== normalise(expected[field])) {
      wrong.push({ field, expected: expected[field], actual: present ? actual[field] : undefined });
    }
  }

  return { correct: fields.length - wrong.length, total: fields.length, wrong };
}

function scoreCorpus(results) {
  const byField = {};
  let correct = 0;
  let total = 0;

  for (const result of results) {
    correct += result.correct;
    total += result.total;
    for (const field of Object.keys(result.expected)) {
      byField[field] ??= { correct: 0, total: 0 };
      byField[field].total += 1;
      if (!result.wrong.some((w) => w.field === field)) byField[field].correct += 1;
    }
  }

  return { correct, total, byField };
}

module.exports = { scoreDocument, scoreCorpus, parseAmount };
