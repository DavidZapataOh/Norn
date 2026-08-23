"use strict";

// The same two cents the arithmetic cross-check uses, for the same reason: a tolerance large
// enough to swallow a transposed digit defeats the comparison it exists to permit.
const TOLERANCE_MINOR = 2n;

const abs = (x) => (x < 0n ? -x : x);
const loose = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A field the gate declined cannot be compared. Reporting that as a failure punishes the
// system for being honest; reporting it as a pass defeats the gate.
function value(fields, key) {
  const field = fields[key];
  if (!field) return { state: "missing" };
  if (!field.admitted) return { state: "withheld", by: field.check, value: field.value };
  return { state: "have", value: field.value };
}

function reconcile(fields, candidates, { alreadySeen = false } = {}) {
  const checks = [];
  const add = (name, outcome, detail) => checks.push({ name, outcome, detail });

  add("document is new", alreadySeen ? "fail" : "pass",
    alreadySeen ? "this document has already been reconciled" : "no earlier reconciliation for these bytes");

  if (candidates.length === 0) {
    add("one record matches", "fail", "no record matched by reference, or by vendor and amount");
    return { decision: "no-candidate", record: null, checks, variance: null };
  }

  const record = candidates[0];
  if (candidates.length > 1) {
    // Several records that match equally well cannot be told apart from the document. Taking
    // the first and calling it a match is a confident answer built on an arbitrary choice.
    add("one record matches", "indeterminate",
      `${candidates.length} records match equally well: ${candidates.map((c) => c.reference).join(", ")}`);
  } else {
    add("one record matches", "pass", `${record.reference} for ${record.vendorName}`);
  }

  add("vendor is active", record.active ? "pass" : "fail",
    record.active ? `${record.vendorName} is active` : `${record.vendorName} is marked inactive`);

  const currency = value(fields, "currency");
  let currencyAgrees = false;
  if (currency.state === "withheld") {
    add("currency agrees", "indeterminate", `the gate withheld the currency on ${currency.by}`);
  } else if (currency.state === "missing") {
    add("currency agrees", "indeterminate", "the document states no currency");
  } else if (loose(currency.value) === loose(record.currency)) {
    currencyAgrees = true;
    add("currency agrees", "pass", `both ${record.currency}`);
  } else {
    add("currency agrees", "fail",
      `document says ${currency.value}, record says ${record.currency}, and nothing here converts`);
  }

  const total = value(fields, "total");
  let variance = null;
  if (!currencyAgrees) {
    // Comparing amounts across two currencies produces a number that means nothing, so no
    // variance is reported rather than one that invites a conversion.
    add("amount agrees", "indeterminate", "the currency does not agree, so the amounts are not comparable");
  } else if (total.state === "withheld") {
    add("amount agrees", "indeterminate", `the gate withheld the amount on ${total.by}`);
  } else if (total.state === "missing") {
    add("amount agrees", "indeterminate", "the document states no total");
  } else {
    const difference = total.value - record.amountMinor;
    variance = {
      minor: difference,
      proportion: record.amountMinor === 0n ? null : Number(difference) / Number(record.amountMinor),
    };
    const within = abs(difference) <= TOLERANCE_MINOR;
    add("amount agrees", within ? "pass" : "fail",
      `document ${total.value} against record ${record.amountMinor}, variance ${difference} minor units`);
  }

  const failed = checks.some((c) => c.outcome === "fail");
  const unknown = checks.some((c) => c.outcome === "indeterminate");
  const decision = failed ? "mismatch" : unknown ? "indeterminate" : "matched";

  return { decision, record, checks, variance };
}

module.exports = { reconcile, TOLERANCE_MINOR };
