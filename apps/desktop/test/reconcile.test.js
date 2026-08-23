"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reconcile, TOLERANCE_MINOR } = require("../lib/reconcile");

const admitted = (key, type, value) => ({ key, admitted: true, type, value });
const abstained = (key, type, value, check) => ({ key, admitted: false, type, value, check, reason: check });

const clean = {
  invoice_no: admitted("invoice_no", "string", "NW-2026-0117"),
  vendor: admitted("vendor", "string", "Northwind Paper Supply SL"),
  total: admitted("total", "amount", 52381n),
};

const record = {
  id: 1, reference: "NW-2026-0117", vendorName: "Northwind Paper Supply SL",
  currency: "EUR", amountMinor: 52381n, active: 1,
};

test("a clean match passes every check and names the record", () => {
  const out = reconcile({ ...clean, currency: admitted("currency", "string", "EUR") }, [record]);

  assert.equal(out.decision, "matched");
  assert.equal(out.record.id, 1);
  for (const check of out.checks) {
    assert.equal(check.outcome, "pass", `${check.name}: ${check.detail}`);
  }
});

test("every check records what it compared, not just whether it passed", () => {
  const out = reconcile({ ...clean, currency: admitted("currency", "string", "EUR") }, [record]);

  for (const check of out.checks) {
    assert.ok(check.detail && check.detail.length > 0,
      `${check.name} passed without saying what it compared`);
  }
});

test("a variance is exact in minor units and carries its sign", () => {
  const out = reconcile(
    { ...clean, total: admitted("total", "amount", 52481n), currency: admitted("currency", "string", "EUR") },
    [record],
  );

  assert.equal(out.decision, "mismatch");
  assert.equal(out.variance.minor, 100n, "the document is one euro over the record");
  assert.equal(typeof out.variance.minor, "bigint");
});

test("a rounding-sized difference is within tolerance and still matches", () => {
  assert.equal(TOLERANCE_MINOR, 2n);
  const out = reconcile(
    { ...clean, total: admitted("total", "amount", 52382n), currency: admitted("currency", "string", "EUR") },
    [record],
  );

  assert.equal(out.decision, "matched");
});

test("a currency mismatch is a hard stop and nothing is converted", () => {
  const out = reconcile({ ...clean, currency: admitted("currency", "string", "USD") }, [record]);

  assert.equal(out.decision, "mismatch");
  const currency = out.checks.find((c) => c.name === "currency agrees");
  assert.equal(currency.outcome, "fail");
  assert.match(currency.detail, /USD/);
  assert.match(currency.detail, /EUR/);
  // A converted amount would be wrong by a rate nobody recorded, and there is no rate here.
  assert.equal(out.variance, null, "an amount was compared across two currencies");
});

test("an abstained amount yields indeterminate, not a decision", () => {
  const out = reconcile(
    {
      ...clean,
      total: abstained("total", "amount", 52381n, "arithmetic"),
      currency: admitted("currency", "string", "EUR"),
    },
    [record],
  );

  assert.equal(out.decision, "indeterminate");
  const amount = out.checks.find((c) => c.name === "amount agrees");
  assert.equal(amount.outcome, "indeterminate");
  assert.match(amount.detail, /arithmetic/, "the reviewer cannot see which check withheld it");
});

test("no candidate is its own outcome, distinct from a mismatch", () => {
  const out = reconcile({ ...clean, currency: admitted("currency", "string", "EUR") }, []);

  assert.equal(out.decision, "no-candidate");
  assert.equal(out.record, null);
  assert.equal(out.variance, null);
});

test("an inactive vendor fails rather than matching quietly", () => {
  const out = reconcile(
    { ...clean, currency: admitted("currency", "string", "EUR") },
    [{ ...record, active: 0 }],
  );

  assert.equal(out.decision, "mismatch");
  assert.equal(out.checks.find((c) => c.name === "vendor is active").outcome, "fail");
});

test("a resubmitted document is caught before anything else is compared", () => {
  const out = reconcile(
    { ...clean, currency: admitted("currency", "string", "EUR") },
    [record],
    { alreadySeen: true },
  );

  assert.equal(out.decision, "mismatch");
  assert.equal(out.checks.find((c) => c.name === "document is new").outcome, "fail");
});

test("several records matching equally well is indeterminate, not a match", () => {
  // Measured on a synthetic ledger: the vendor-and-amount fallback returned four candidates
  // on average. Taking the first and calling it matched is a confident answer built on an
  // arbitrary choice, which is the failure this whole design exists to refuse. Which record
  // the document settles is not determinable from the document.
  const twin = { ...record, id: 2, reference: "NW-2026-0118" };
  const out = reconcile({ ...clean, currency: admitted("currency", "string", "EUR") }, [record, twin]);

  assert.equal(out.decision, "indeterminate");
  const which = out.checks.find((c) => c.name === "one record matches");
  assert.equal(which.outcome, "indeterminate");
  assert.match(which.detail, /2 records/);
});

test("a single candidate still matches, so ambiguity is the exception", () => {
  const out = reconcile({ ...clean, currency: admitted("currency", "string", "EUR") }, [record]);

  assert.equal(out.decision, "matched");
});
