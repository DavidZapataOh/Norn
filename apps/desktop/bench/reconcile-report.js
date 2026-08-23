"use strict";

const VERDICTS = ["matched", "mismatch", "indeterminate", "no-candidate"];

function tally(results) {
  const table = {};
  for (const expected of VERDICTS) {
    table[expected] = Object.fromEntries(VERDICTS.map((actual) => [actual, 0]));
  }

  const byDocument = { confidentlyWrong: [], costOfAbstention: [] };

  for (const { name, expected, actual } of results) {
    table[expected][actual] += 1;

    // The only outcome that damages an operator. A mismatch shown to a reviewer costs a
    // minute; a match that should have been a mismatch costs the invoice.
    if (actual === "matched" && expected !== "matched") byDocument.confidentlyWrong.push(name);

    // Reporting abstention without its cost makes caution look free.
    if (actual === "indeterminate" && expected === "matched") byDocument.costOfAbstention.push(name);
  }

  return {
    table,
    total: results.length,
    confidentlyWrong: byDocument.confidentlyWrong.length,
    costOfAbstention: byDocument.costOfAbstention.length,
    byDocument,
  };
}

module.exports = { tally, VERDICTS };
