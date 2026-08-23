"use strict";

// Two cents. Tolerance exists for the rounding of a percentage and nothing else: one large
// enough to swallow a transposed digit is a tolerance that defeats the check. Stated in
// minor units rather than as a float epsilon, because every comparison here is BigInt.
const TOLERANCE_MINOR = 2n;

const abs = (x) => (x < 0n ? -x : x);
const present = (values, key) => values[key] && typeof values[key].value === "bigint";

function check(values, { lines = null, rate = null } = {}) {
  const identities = [];

  if (lines && lines.length && present(values, "subtotal")) {
    const summed = lines.reduce((total, line) => total + line.amount, 0n);
    const difference = summed - values.subtotal.value;
    identities.push({
      name: "line items sum to the subtotal",
      fields: ["subtotal"],
      ok: abs(difference) <= TOLERANCE_MINOR,
      detail: `line items - subtotal = ${difference} minor units`,
    });
  }

  if (present(values, "subtotal") && present(values, "tax") && present(values, "total")) {
    const difference = values.subtotal.value + values.tax.value - values.total.value;
    identities.push({
      name: "subtotal + tax = total",
      fields: ["subtotal", "tax", "total"],
      ok: abs(difference) <= TOLERANCE_MINOR,
      detail: `subtotal + tax - total = ${difference} minor units`,
    });
  }

  if (rate !== null && present(values, "subtotal") && present(values, "tax")) {
    // Basis points keep the multiplication in integers, so the only rounding left is the
    // one the document itself performed: 432,90 at 21% is 90,909 and prints as 90,91.
    const expected = (values.subtotal.value * rate) / 10000n;
    const difference = values.tax.value - expected;
    identities.push({
      name: "tax = subtotal x rate",
      fields: ["subtotal", "tax"],
      ok: abs(difference) <= TOLERANCE_MINOR,
      detail: `tax - subtotal x ${rate}bp = ${difference} minor units`,
    });
  }

  const byField = {};
  for (const identity of identities) {
    for (const field of identity.fields) {
      // A failure implicates every field in the identity. The code cannot tell whether the
      // subtotal or the total is wrong, and choosing one would be the confident guessing
      // this refuses to do.
      if (byField[field]?.ok === false) continue;
      byField[field] = identity.ok ? { ok: true } : { ok: false, identity: identity.name };
    }
  }

  return { identities, byField };
}

module.exports = { check, TOLERANCE_MINOR };
