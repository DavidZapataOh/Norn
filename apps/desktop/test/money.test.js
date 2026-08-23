"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseAmount, formatMinor } = require("../lib/money");

test("the two decimal conventions reach the same value", () => {
  const latin = parseAmount("2.831,40");
  const anglo = parseAmount("2,831.40");

  assert.equal(latin.minor, 283140n);
  assert.equal(anglo.minor, 283140n);
  assert.equal(latin.convention, "latin");
  assert.equal(anglo.convention, "anglo");
});

test("a currency is recognised from a code or a symbol", () => {
  assert.equal(parseAmount("ARS 2.831,40").currency, "ARS");
  assert.equal(parseAmount("$2,831.40").currency, "USD");
  assert.equal(parseAmount("2831.40").currency, null);
});

test("minor units format back to a plain decimal string", () => {
  assert.equal(formatMinor(283140n), "2831.40");
  assert.equal(formatMinor(5n), "0.05");
  assert.equal(formatMinor(-283140n), "-2831.40");
});

test("a bare thousands separator is not read as a decimal", () => {
  // 2.340 is two thousand three hundred forty, not 2.34. Reading it the other way is
  // the 1000x error this module exists to prevent.
  assert.equal(parseAmount("2.340").minor, 234000n);
  assert.equal(parseAmount("2,340").minor, 234000n);
  assert.equal(parseAmount("1.234.567").minor, 123456700n);
});

test("two digits after the last separator is still a decimal", () => {
  assert.equal(parseAmount("2.34").minor, 234n);
  assert.equal(parseAmount("2,34").minor, 234n);
});

test("real recogniser misreads produce nothing, not a number", () => {
  // Both verbatim from a pass over a photographed invoice.
  assert.equal(parseAmount(":%2 VAI"), null, "reversed tax row parsed as a number");
  assert.equal(parseAmount("Jund"), null, "a misread column header parsed as a number");
});

test("text that merely contains a number is not an amount", () => {
  assert.equal(parseAmount("Invoice 4471"), null);
  assert.equal(parseAmount("PO-2026-0912"), null);
  assert.equal(parseAmount("30-71234567-9"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
});

test("a currency code fused to its amount still parses", () => {
  assert.equal(parseAmount("ARS2.831,40").minor, 283140n);
  // A label fused to its value is not a clean amount, so the value has to come from the
  // extraction stage rather than from a substring guess here.
  assert.equal(parseAmount("Total:AUD 1,562.00"), null);
});
