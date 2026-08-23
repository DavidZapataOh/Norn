"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { judge, DEFAULT_THRESHOLDS } = require("../lib/gate");

const good = {
  key: "total",
  coerced: { type: "amount", value: 283140n, raw: "2.831,40" },
  binding: { status: "region", bbox: [820, 500, 1020, 530], confidence: 0.94, text: "2.831,40" },
  arithmetic: { ok: true },
};

test("a value with every signal agreeing is admitted, carrying its region", () => {
  const out = judge(good);

  assert.equal(out.admitted, true);
  assert.equal(out.value, 283140n);
  assert.deepEqual(out.bbox, [820, 500, 1020, 530]);
  assert.equal(out.confidence, 0.94);
  assert.equal(out.width, "region");
});

test("an unbound value abstains no matter how confident the model sounded", () => {
  const out = judge({ ...good, binding: { status: "unbound", reason: "value not found on the page" } });

  assert.equal(out.admitted, false);
  assert.equal(out.check, "binding");
  assert.match(out.reason, /not found on the page/);
});

test("a value below the confidence floor abstains even when bound and consistent", () => {
  const out = judge({ ...good, binding: { ...good.binding, confidence: 0.2 } });

  assert.equal(out.admitted, false);
  assert.equal(out.check, "confidence");
  assert.equal(out.confidence, 0.2, "the abstention still carries what was read");
  assert.deepEqual(out.bbox, [820, 500, 1020, 530], "and where it was read");
  assert.equal(out.value, 283140n, "and the value it declined, so the cost can be scored");
  assert.equal(out.type, "amount");
});

test("a value that breaks an identity the document asserts abstains", () => {
  const out = judge({ ...good, arithmetic: { ok: false, identity: "subtotal + tax = total" } });

  assert.equal(out.admitted, false);
  assert.equal(out.check, "arithmetic");
  assert.match(out.reason, /subtotal \+ tax = total/);
});

test("high confidence alone cannot admit an unbound value", () => {
  // The measurement this gate exists for: a wrong reading scored 0.983 while a correct one
  // scored 0.523, so no confidence is evidence on its own.
  const out = judge({
    ...good,
    binding: { status: "unbound", reason: "value not found on the page", confidence: 0.983 },
  });

  assert.equal(out.admitted, false);
});

test("a text-layer binding is exempt from the floor, and the record says so", () => {
  // The file states these characters rather than guessing them, so there is no confidence
  // to check. The exemption has to be visible, or an admission here reads like one that
  // cleared a floor.
  const out = judge({
    ...good,
    binding: { status: "region", bbox: [1, 1, 2, 2], text: "2.831,40", source: "text-layer" },
  });

  assert.equal(out.admitted, true);
  assert.equal(out.checks.confidence, "not applicable");
  assert.equal(out.source, "text-layer");
});

test("a recognised region with no confidence abstains rather than slipping through", () => {
  // Same missing field, different meaning: recognition reports a confidence, so its absence
  // is a failure upstream and not an exemption.
  const out = judge({
    ...good,
    binding: { status: "region", bbox: [1, 1, 2, 2], text: "2.831,40" },
  });

  assert.equal(out.admitted, false);
  assert.equal(out.check, "confidence");
  assert.match(out.reason, /no confidence was reported/);
});

test("every abstention names the check that failed", () => {
  const cases = [
    { ...good, binding: { status: "unbound", reason: "value not found on the page" } },
    { ...good, binding: { ...good.binding, confidence: 0.1 } },
    { ...good, arithmetic: { ok: false, identity: "line items sum to the subtotal" } },
  ];

  for (const input of cases) {
    const out = judge(input);
    assert.equal(out.admitted, false);
    assert.ok(out.check, "an abstention with no named check is indistinguishable from a shrug");
    assert.ok(out.reason.length > 0);
  }
});

test("a field the model reported as absent abstains under its own name", () => {
  // Distinct from a value that is missing from the page. The model answering "nothing here"
  // and the page not carrying what the model answered are different findings, and the
  // report splits abstentions by check.
  const out = judge({
    key: "tax",
    coerced: { type: "amount", value: null, raw: null },
    binding: { status: "unbound", reason: "declared absent by the model" },
    arithmetic: { ok: true },
  });

  assert.equal(out.admitted, false);
  assert.equal(out.check, "absent");
  assert.match(out.reason, /reported no value/);
});

test("a span binding is admitted, at a raised floor", () => {
  const span = {
    key: "date",
    coerced: { type: "date", value: "2026-05-11", raw: "11 May 2026" },
    binding: { status: "span", bbox: [120, 250, 520, 280], confidence: 0.866, text: "Issue date: 11 May 2026" },
    arithmetic: { ok: true },
  };

  const out = judge(span);
  assert.equal(out.admitted, true);
  assert.equal(out.width, "span");
});

test("the same span at a confidence a region would survive is refused", () => {
  const span = {
    key: "date",
    coerced: { type: "date", value: "2026-05-11", raw: "11 May 2026" },
    binding: { status: "span", bbox: [120, 250, 520, 280], confidence: 0.45, text: "Issue date: 11 May 2026" },
    arithmetic: { ok: true },
  };

  // 0.45 clears the 0.4 date floor for a region binding and not the raised floor for a span.
  assert.equal(judge({ ...span, binding: { ...span.binding, status: "region" } }).admitted, true);
  assert.equal(judge(span).admitted, false);
  assert.equal(judge(span).check, "confidence");
});

test("a contested admission carries the count so a reviewer can see it", () => {
  const out = judge({
    key: "total",
    coerced: { type: "amount", value: 10500n, raw: "105,00" },
    binding: { status: "region", bbox: [820, 600, 950, 630], confidence: 0.91, text: "105,00", contested: 2 },
    arithmetic: { ok: true },
  });

  assert.equal(out.admitted, true);
  assert.equal(out.contested, 2, "the reviewer cannot see the ambiguity if it is not recorded");
});

const { judgeAll } = require("../lib/gate");

test("a document reports its admissions and abstentions with the reason split", () => {
  const coerced = {
    vendor: { type: "string", value: "Northwind Paper Supply SL", raw: "Northwind Paper Supply SL" },
    total: { type: "amount", value: 283140n, raw: "2.831,40" },
    tax: { type: "amount", value: 9091n, raw: "90,91" },
    invoice_no: { type: "string", value: "NW-2026-0117", raw: "NW-2026-0117" },
  };
  const bindings = {
    vendor: { status: "region", bbox: [80, 100, 400, 130], confidence: 0.99, text: "Northwind Paper Supply SL" },
    total: { status: "region", bbox: [820, 500, 1020, 530], confidence: 0.94, text: "2.831,40" },
    tax: { status: "unbound", reason: "value not found on the page" },
    invoice_no: { status: "region", bbox: [120, 200, 400, 230], confidence: 0.12, text: "NW-2026-0117" },
  };

  const out = judgeAll(coerced, bindings);

  assert.equal(out.admitted, 2);
  assert.equal(out.abstained, 2);
  assert.deepEqual(out.byCheck, { binding: 1, confidence: 1 });
  assert.equal(Object.keys(out.fields).length, 4, "a field must never be dropped from the record");
});

test("an abstained field is present in the record, not omitted", () => {
  const out = judgeAll(
    { tax: { type: "amount", value: 9091n, raw: "90,91" } },
    { tax: { status: "unbound", reason: "value not found on the page" } },
  );

  // An omitted field is indistinguishable from a field the document does not have.
  assert.ok("tax" in out.fields);
  assert.equal(out.fields.tax.admitted, false);
});

test("an arithmetic failure implicates every field in the identity, not a chosen culprit", () => {
  const coerced = {
    subtotal: { type: "amount", value: 43290n, raw: "432,90" },
    tax: { type: "amount", value: 9091n, raw: "90,91" },
    total: { type: "amount", value: 61200n, raw: "612,00" },
  };
  const bound = (text) => ({ status: "region", bbox: [1, 1, 2, 2], confidence: 0.95, text });
  const bindings = { subtotal: bound("432,90"), tax: bound("90,91"), total: bound("612,00") };

  const out = judgeAll(coerced, bindings, {
    arithmetic: {
      subtotal: { ok: false, identity: "subtotal + tax = total" },
      tax: { ok: false, identity: "subtotal + tax = total" },
      total: { ok: false, identity: "subtotal + tax = total" },
    },
  });

  assert.equal(out.admitted, 0, "the code cannot tell which of the three is wrong");
  assert.equal(out.byCheck.arithmetic, 3);
});

test("a document read from a text layer reports that its floor never ran", () => {
  // On this path binding and arithmetic carry the whole gate. A summary that did not say so
  // would report the same coverage as a document that cleared a confidence floor.
  const out = judgeAll(
    { total: { type: "amount", value: 283140n, raw: "2.831,40" } },
    { total: { status: "region", bbox: [1, 1, 2, 2], text: "2.831,40", source: "text-layer" } },
  );

  assert.equal(out.admitted, 1);
  assert.equal(out.confidenceNotApplicable, 1);
});
