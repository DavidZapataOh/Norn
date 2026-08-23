"use strict";
const { parseAmount } = require("./money");
const { coerceDate } = require("./schema");

const CANDIDATES = [",", ";", "\t"];
const BOM_BYTES = [0xef, 0xbb, 0xbf];

function decodeUtf8(bytes) {
  // fatal:true is the point. Without it an illegal byte becomes U+FFFD and a vendor's name
  // is silently changed rather than the file being refused.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // TextDecoder does not say where, so the offset is found by decoding prefixes.
    let lo = 0, hi = bytes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, mid)); lo = mid + 1; }
      catch { hi = mid; }
    }
    throw new Error(`file is not valid UTF-8 at byte ${Math.max(0, lo - 1)}`);
  }
}

// Counts delimiters outside quotes only. One quoted comma is enough to outvote a real
// semicolon on a short file, which produces one column per row and an error message about
// the columns rather than about the delimiter.
function countOutsideQuotes(line, delimiter) {
  let count = 0, inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

function sniff(bytes) {
  // TextDecoder removes the mark itself, per the WHATWG spec, so by the time there is a
  // string there is nothing left to detect. The bytes are the only place it exists.
  const hadBom = bytes.length >= 3 && BOM_BYTES.every((b, i) => bytes[i] === b);
  const text = decodeUtf8(bytes);
  const lines = text.split(/\r?\n/).filter((l) => l.length).slice(0, 5);

  let delimiter = ",", best = -1;
  for (const candidate of CANDIDATES) {
    const total = lines.reduce((sum, line) => sum + countOutsideQuotes(line, candidate), 0);
    if (total > best) { best = total; delimiter = candidate; }
  }

  return { encoding: "utf-8", delimiter, hadBom, text };
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  return rows;
}

// Proposed, never applied without confirmation. A silent guess reconciles against the wrong
// column and every row still imports, so the failure has no symptom.
const HEADERS = {
  reference: [/^ref/i, /^po\b/i, /number/i, /orden/i],
  vendor: [/^vendor/i, /^supplier/i, /^proveedor/i, /^name/i],
  amount: [/amount/i, /total/i, /^net/i, /importe/i],
  currency: [/^currency/i, /^ccy/i, /^moneda/i],
  issuedOn: [/date/i, /issued/i, /fecha/i],
};

function proposeMapping(header) {
  const mapping = { reference: null, vendor: null, amount: null, currency: null, issuedOn: null };
  const taken = new Set();

  for (const [field, patterns] of Object.entries(HEADERS)) {
    for (let i = 0; i < header.length; i++) {
      if (taken.has(i)) continue;
      if (patterns.some((p) => p.test(header[i].trim()))) {
        mapping[field] = i;
        taken.add(i);
        break;
      }
    }
  }
  return mapping;
}

function importRecords(bytes, { mapping }) {
  const { delimiter, text } = sniff(bytes);
  const grid = parseDelimited(text, delimiter);
  const width = grid.length ? grid[0].length : 0;
  const rows = [];
  const rejected = [];
  const seen = new Map();

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const line = i + 1;
    const at = (key) => (mapping[key] === null ? null : (cells[mapping[key]] ?? "").trim());
    const raw = cells.join(delimiter);
    const reject = (reason) => rejected.push({ line, reason, raw });

    // A row that lost its shape reads cleanly and wrongly. An unquoted continental amount
    // in a comma file splits in two, and the leftover "EUR 1.234" parses as 1.234,00 with
    // the cents gone. The cell count is the only place that is visible.
    if (cells.length !== width) {
      reject(`row has ${cells.length} cells and the header has ${width}`);
      continue;
    }

    const reference = at("reference");
    const vendor = at("vendor");
    if (!reference) { reject("no reference"); continue; }
    if (!vendor) { reject("no vendor"); continue; }

    const amountText = at("amount");
    const parsed = amountText === null ? null : parseAmount(amountText);
    if (parsed === null) { reject(`amount is not a number: ${JSON.stringify(amountText)}`); continue; }

    // From the column when there is one, from the amount when there is not, and never a
    // default: a default currency is an exchange rate nobody chose.
    const currency = at("currency") || parsed.currency;
    if (!currency) { reject("no currency in the row and none in the amount"); continue; }

    const issuedText = at("issuedOn");
    const issuedOn = issuedText ? coerceDate(issuedText) : null;
    if (issuedText && issuedOn === null) {
      reject(`date is not readable: ${JSON.stringify(issuedText)}`); continue;
    }

    const key = `${vendor} ${reference}`;
    if (seen.has(key)) { reject(`duplicate reference, first seen at line ${seen.get(key)}`); continue; }
    seen.set(key, line);

    rows.push({ reference, vendor, currency: currency.toUpperCase(), amountMinor: parsed.minor, issuedOn });
  }

  return { rows, rejected, mapping };
}

module.exports = { sniff, parseDelimited, proposeMapping, importRecords };
