"use strict";

// Amount parsing lives here for now and moves to lib/money.js when that module
// lands, at which point this file imports rather than duplicates it.
const CURRENCY = /\b(ARS|USD|USDT|EUR|BRL|CLP|COP|MXN|PEN|UYU|GBP)\b/i;

function parseAmount(raw) {
  if (typeof raw !== "string") return null;
  let body = raw.replace(CURRENCY, "").replace(/[$€£]/g, "").replace(/^\s*-/, "").replace(/\s/g, "");
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;

  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  if (lastDot === -1 && lastComma === -1) return Number(body);

  const sep = Math.max(lastDot, lastComma);
  const tail = body.slice(sep + 1);
  // A separator followed by exactly three digits, with no second separator, is a
  // thousands mark: 2.340 is two thousand three hundred forty, not 2.34.
  if (tail.length === 3 && (lastDot === -1 || lastComma === -1)) {
    return Number(body.replace(/[.,]/g, ""));
  }
  if (!/^\d{1,2}$/.test(tail)) return null;
  return Number(`${body.slice(0, sep).replace(/[.,]/g, "")}.${tail}`);
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
