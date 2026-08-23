"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { check, TOLERANCE_MINOR } = require("../lib/arithmetic");

const amount = (minor) => ({ type: "amount", value: minor });

test("a document that adds up passes every identity it can state", () => {
  const out = check({ subtotal: amount(43290n), tax: amount(9091n), total: amount(52381n) });

  const identity = out.identities.find((i) => i.name === "subtotal + tax = total");
  assert.equal(identity.ok, true);
  assert.equal(out.byField.total.ok, true);
});

test("a document that does not add up fails, and implicates all three fields", () => {
  // The values in the corpus fixture built to be wrong: 432,90 + 90,91 is not 612,00.
  const out = check({ subtotal: amount(43290n), tax: amount(9091n), total: amount(61200n) });

  const identity = out.identities.find((i) => i.name === "subtotal + tax = total");
  assert.equal(identity.ok, false);
  assert.deepEqual(identity.fields.sort(), ["subtotal", "tax", "total"]);

  for (const key of ["subtotal", "tax", "total"]) {
    assert.equal(out.byField[key].ok, false, `${key} was not implicated`);
    assert.equal(out.byField[key].identity, "subtotal + tax = total");
  }
});

test("the detail names the difference in minor units, not as a float", () => {
  const out = check({ subtotal: amount(43290n), tax: amount(9091n), total: amount(61200n) });
  const identity = out.identities.find((i) => i.name === "subtotal + tax = total");

  assert.match(identity.detail, /8819/, "the reviewer cannot see the size of the error");
  assert.ok(!identity.detail.includes("."), "money must not be rendered through a float here");
});

test("a rounding-sized difference is tolerated and a magnitude error is not", () => {
  assert.equal(TOLERANCE_MINOR, 2n);

  const rounding = check({ subtotal: amount(43290n), tax: amount(9091n), total: amount(52382n) });
  assert.equal(rounding.identities.find((i) => i.name === "subtotal + tax = total").ok, true);

  // A 10x error, which is the failure the amount parser exists to prevent upstream and
  // this check exists to catch if it gets through.
  const magnitude = check({ subtotal: amount(43290n), tax: amount(9091n), total: amount(523810n) });
  assert.equal(magnitude.identities.find((i) => i.name === "subtotal + tax = total").ok, false);
});

test("a total copied into the tax field is caught", () => {
  // Plausible in isolation and wrong: both fields read as the same number.
  const out = check({ subtotal: amount(43290n), tax: amount(52381n), total: amount(52381n) });

  assert.equal(out.identities.find((i) => i.name === "subtotal + tax = total").ok, false);
});

test("line items sum to the subtotal", () => {
  const out = check({ subtotal: amount(43290n) }, {
    lines: [{ amount: 32790n }, { amount: 10500n }],
  });

  const identity = out.identities.find((i) => i.name === "line items sum to the subtotal");
  assert.equal(identity.ok, true);
});

test("a line item read at the wrong magnitude breaks the sum", () => {
  const out = check({ subtotal: amount(43290n) }, {
    lines: [{ amount: 327900n }, { amount: 10500n }],
  });

  assert.equal(out.identities.find((i) => i.name === "line items sum to the subtotal").ok, false);
  assert.equal(out.byField.subtotal.ok, false);
});

test("tax equals the subtotal times the stated rate, with rounding tolerated", () => {
  // 432,90 at 21% is 90,909, and the document prints 90,91.
  const out = check({ subtotal: amount(43290n), tax: amount(9091n) }, { rate: 2100n });

  const identity = out.identities.find((i) => i.name === "tax = subtotal x rate");
  assert.equal(identity.ok, true, `rounding was not tolerated: ${identity.detail}`);
});

test("a tax at the wrong rate is not tolerated", () => {
  // 432,90 at 21% is not 43,29, which is what a 10% reading would give.
  const out = check({ subtotal: amount(43290n), tax: amount(4329n) }, { rate: 2100n });

  assert.equal(out.identities.find((i) => i.name === "tax = subtotal x rate").ok, false);
});

test("a document with no line items and no rate is not penalised", () => {
  const out = check({ total: amount(1250n) });

  assert.deepEqual(out.identities, [], "a receipt states fewer identities, and that is not a failure");
  assert.equal(out.byField.total, undefined, "a field in no identity is neither passed nor failed");
});

test("one failing identity is not cleared by another that passes", () => {
  // The subtotal is in both identities: it fails the line sum and passes the total.
  const out = check({ subtotal: amount(43290n), tax: amount(9091n), total: amount(52381n) }, {
    lines: [{ amount: 1n }],
  });

  assert.equal(out.byField.subtotal.ok, false, "a passing identity cleared a failing one");
  assert.equal(out.byField.total.ok, true);
});
