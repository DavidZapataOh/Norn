"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compile, DEFAULT_TEMPLATE, FIELD_TYPES } = require("../lib/schema");

test("a template compiles to a schema whose every field is nullable", () => {
  const { name, schema } = compile({
    name: "invoice",
    fields: [
      { key: "vendor", label: "Vendor", type: "string" },
      { key: "total", label: "Total", type: "amount" },
    ],
  });

  assert.equal(name, "invoice");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false, "an unlisted key must be unreachable");
  assert.deepEqual(schema.required, ["vendor", "total"], "strictness is not inherited");

  for (const key of ["vendor", "total"]) {
    const types = schema.properties[key].type;
    assert.ok(Array.isArray(types) && types.includes("null"),
      `${key} is not nullable, so the model must invent a value`);
  }
});

test("every field type in the closed set compiles", () => {
  const { schema } = compile({
    name: "everything",
    fields: FIELD_TYPES.map((type) => ({ key: type, label: type, type })),
  });

  for (const type of FIELD_TYPES) {
    assert.ok(schema.properties[type], `${type} did not compile`);
  }
});

test("an unknown field type is refused at compile time, not at decode time", () => {
  assert.throws(
    () => compile({ name: "bad", fields: [{ key: "x", label: "X", type: "currency" }] }),
    /unknown field type "currency"/,
  );
});

test("the shipped template is a valid template", () => {
  const { schema } = compile(DEFAULT_TEMPLATE);
  assert.ok(DEFAULT_TEMPLATE.fields.length >= 5);
  assert.equal(Object.keys(schema.properties).length, DEFAULT_TEMPLATE.fields.length);
});

const { coerce } = require("../lib/schema");

const template = {
  name: "t",
  fields: [
    { key: "vendor", label: "Vendor", type: "string" },
    { key: "total", label: "Total", type: "amount" },
    { key: "date", label: "Date", type: "date" },
    { key: "qty", label: "Qty", type: "integer" },
  ],
};

test("both decimal conventions coerce to the same integer", () => {
  const latin = coerce(template, { vendor: "A", total: "2.831,40", date: null, qty: null });
  const anglo = coerce(template, { vendor: "A", total: "2,831.40", date: null, qty: null });
  const plain = coerce(template, { vendor: "A", total: 2831.4, date: null, qty: null });

  assert.equal(latin.values.total.value, 283140n);
  assert.equal(anglo.values.total.value, 283140n);
  assert.equal(plain.values.total.value, 283140n, "a JSON number is the same answer");
});

test("null survives coercion as null, and is not a rejection", () => {
  const out = coerce(template, { vendor: null, total: null, date: null, qty: null });

  assert.equal(out.values.vendor.value, null);
  assert.deepEqual(out.rejected, [], "a declared absence is an answer, not a failure");
});

test("a value that is not the declared type is rejected with a reason", () => {
  const out = coerce(template, { vendor: "A", total: "Jund", date: "not a date", qty: "many" });

  assert.equal(out.values.total, undefined, "an uncoercible value must not reach the output");
  assert.equal(out.rejected.length, 3);
  assert.match(out.rejected.find((r) => r.key === "total").reason, /not an amount/);
  assert.match(out.rejected.find((r) => r.key === "date").reason, /not a date/);
  assert.match(out.rejected.find((r) => r.key === "qty").reason, /not an integer/);
});

test("a key the template never declared is rejected, not passed through", () => {
  const out = coerce(template, { vendor: "A", total: null, date: null, qty: null, bank: "ES00" });

  assert.equal(out.values.bank, undefined);
  assert.match(out.rejected.find((r) => r.key === "bank").reason, /not in the template/);
});

const { instruction, SYSTEM } = require("../lib/schema");

test("the instruction names every field in the template", () => {
  const text = instruction(template);

  for (const field of template.fields) {
    assert.ok(text.includes(field.label), `the prompt never mentions ${field.label}`);
  }
});

test("the instruction does not invite the model to return null", () => {
  // Measured on a 4B model: the sentence "if a field is not on the document, return null"
  // in the prompt cost four cells out of thirty, because it began returning null for the
  // total on every fixture. Nullability is expressed in the schema, which constrains
  // decoding, and not in prose, which suggests.
  const text = `${SYSTEM}\n${instruction(template)}`.toLowerCase();

  assert.ok(!text.includes("return null"), "the prompt invites the null it measured");
  assert.ok(!text.includes("if a field is not"), "the prompt invites the null it measured");
});

test("the system turn forbids invention", () => {
  assert.match(SYSTEM, /never invent/i);
});
