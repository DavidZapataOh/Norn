"use strict";
const { parseAmount } = require("./money");

// A closed set, because each type carries its own coercion and its own arithmetic role.
// An open set would mean a field the cross-check cannot reason about.
const FIELD_TYPES = ["string", "amount", "date", "integer"];

// Every field is nullable. A US supplier has no VAT number, and a schema that forces a
// string produces a fabricated one rather than an empty cell.
const JSON_TYPE = {
  string: ["string", "null"],
  amount: ["string", "number", "null"],
  date: ["string", "null"],
  integer: ["integer", "null"],
};

const DEFAULT_TEMPLATE = {
  name: "invoice",
  fields: [
    { key: "vendor", label: "Vendor", type: "string", hint: "the company issuing the invoice" },
    { key: "invoice_no", label: "Invoice number", type: "string" },
    { key: "date", label: "Issue date", type: "date" },
    { key: "subtotal", label: "Subtotal", type: "amount" },
    { key: "tax", label: "Tax", type: "amount" },
    { key: "total", label: "Total", type: "amount" },
  ],
};

function compile(template) {
  const properties = {};
  for (const field of template.fields) {
    if (!FIELD_TYPES.includes(field.type)) {
      throw new Error(`unknown field type "${field.type}" for field "${field.key}"`);
    }
    properties[field.key] = {
      type: JSON_TYPE[field.type],
      description: field.hint ? `${field.label}: ${field.hint}` : field.label,
    };
  }

  return {
    name: template.name,
    schema: {
      type: "object",
      properties,
      // strict: true is accepted for OpenAI compatibility but applies none of OpenAI's
      // auto-tightening, so both of these have to be written out.
      required: template.fields.map((f) => f.key),
      additionalProperties: false,
    },
  };
}

// Accepts the forms a document actually prints. A bare "14/03/2026" is refused on purpose:
// it is 14 March or 3 December depending on where it was written, and choosing one is the
// confident guessing this pipeline exists to refuse.
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december"];

function coerceDate(raw) {
  const text = String(raw).trim();
  const iso = text.match(ISO);
  if (iso) {
    const [, y, m, d] = iso;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`;
    return null;
  }
  const spelled = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (spelled) {
    const month = MONTHS.indexOf(spelled[2].toLowerCase());
    if (month >= 0) {
      return `${spelled[3]}-${String(month + 1).padStart(2, "0")}-${spelled[1].padStart(2, "0")}`;
    }
  }
  return null;
}

const COERCE = {
  string: (raw) => (typeof raw === "string" && raw.trim() ? raw.trim() : null),
  // Through the one parser this repository has. Two copies were measured diverging on
  // four of fourteen cases before the second was deleted.
  amount: (raw) => {
    const parsed = parseAmount(typeof raw === "number" ? raw.toFixed(2) : String(raw));
    return parsed === null ? null : parsed.minor;
  },
  date: coerceDate,
  integer: (raw) => (Number.isInteger(raw) ? raw : /^-?\d+$/.test(String(raw).trim()) ? Number(raw) : null),
};

const ARTICLE = { string: "a string", amount: "an amount", date: "a date", integer: "an integer" };

function coerce(template, raw) {
  const values = {};
  const rejected = [];
  const declared = new Set(template.fields.map((f) => f.key));

  for (const key of Object.keys(raw ?? {})) {
    if (!declared.has(key)) {
      rejected.push({ key, raw: raw[key], reason: `"${key}" is not in the template` });
    }
  }

  for (const field of template.fields) {
    const input = raw?.[field.key];
    if (input === null || input === undefined) {
      values[field.key] = { type: field.type, raw: input ?? null, value: null };
      continue;
    }
    const value = COERCE[field.type](input);
    if (value === null) {
      rejected.push({
        key: field.key, raw: input,
        reason: `not ${ARTICLE[field.type]}: ${JSON.stringify(input)}`,
      });
      continue;
    }
    values[field.key] = { type: field.type, raw: input, value };
  }

  return { values, rejected };
}

// Measured: adding "if a field is not on the document, return null" to this prompt moved a
// 4B model from 28/30 cells to 24/30, because it began returning null for the total on
// every fixture. The schema makes null reachable; the prompt must not advertise it.
const SYSTEM =
  "You are a bookkeeping assistant. You read invoices and receipts and report their " +
  "fields exactly as printed. You never invent values. /no_think";

function instruction(template) {
  const lines = template.fields.map((f) =>
    `- ${f.key} (${f.label}${f.hint ? `, ${f.hint}` : ""})`);
  return `Read this ${template.name} and report these fields exactly as printed:\n${lines.join("\n")}`;
}

module.exports = { FIELD_TYPES, DEFAULT_TEMPLATE, SYSTEM, compile, coerce, instruction };
