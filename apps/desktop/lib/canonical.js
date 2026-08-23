"use strict";

// This is the interoperability surface. A verifier that is not this program has to produce the
// same bytes from the same document, or every signature written here is checkable only by the
// thing that wrote it. The rules are exported as prose beside the code because they have to be
// published, and a description kept in a separate file drifts.
const CANONICAL_RULES = [
  "Object keys are sorted by UTF-16 code unit, at every depth.",
  "Array order is preserved: an array's order is part of its content.",
  "Strings are Unicode NFC normalised, keys as well as values.",
  "BigInt is refused. Callers convert amounts to decimal strings explicitly, so that the " +
    "conversion appears in the schema and an amount cannot serialise as a label.",
  "NaN, Infinity and -Infinity are refused. JSON.stringify turns them into null silently.",
  "undefined is dropped from objects and refused inside arrays, where JSON.stringify would " +
    "turn it into null.",
  "Functions, symbols, Dates and class instances are refused.",
  "No whitespace, no indentation, no trailing newline.",
];

function encode(value, at) {
  const type = typeof value;

  if (value === null) return "null";
  if (type === "bigint") {
    throw new TypeError(`${at} is a BigInt; convert it to a decimal string before serialising`);
  }
  if (type === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${at} is not finite: ${value}`);
    return JSON.stringify(value);
  }
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return JSON.stringify(value.normalize("NFC"));
  if (type === "function" || type === "symbol") {
    throw new TypeError(`${at} is a ${type}, which has no serialisation`);
  }
  if (type === "undefined") throw new TypeError(`${at} is undefined`);

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => encode(item, `${at}[${i}]`)).join(",")}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    // A Date serialises to an ISO string that round-trips as a string and never again as a
    // Date; a Map serialises to {}. Both look reasonable and carry none of their content, so
    // the caller decides what the document should say rather than discovering it later.
    throw new TypeError(`${at} is not a plain object: ${value.constructor?.name ?? "unknown"}`);
  }

  const parts = [];
  // Normalised before sorting, so two spellings of one key sort as the one key they are.
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .map((key) => [key.normalize("NFC"), key])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [normalised, key] of keys) {
    parts.push(`${JSON.stringify(normalised)}:${encode(value[key], `${at}.${key}`)}`);
  }
  return `{${parts.join(",")}}`;
}

const canonical = (value) => encode(value, "$");

module.exports = { canonical, CANONICAL_RULES };
