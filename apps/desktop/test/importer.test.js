"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sniff, parseDelimited } = require("../lib/importer");

const BOM = "﻿";

test("a semicolon file is not read as a comma file", () => {
  const text = "reference;vendor;amount\nPO-1;Northwind;1.234,50\nPO-2;Harborlight;99,00\n";

  assert.equal(sniff(Buffer.from(text, "utf-8")).delimiter, ";");
});

test("a quoted address outvotes the real delimiter unless the count ignores quotes", () => {
  // Two columns, so there are only two semicolons, and one quoted address carries three
  // commas. Counted naively the comma wins and every row collapses to a single column.
  const text = 'reference;vendor\nPO-1;"Calle Mayor 14, 28013, Madrid, ES"\n';

  assert.equal(sniff(Buffer.from(text, "utf-8")).delimiter, ";");
});

test("a byte order mark is stripped, so the first column keeps its name", () => {
  const text = `${BOM}reference,vendor,amount\nPO-1,Northwind,1234.50\n`;
  const out = sniff(Buffer.from(text, "utf-8"));

  assert.equal(out.hadBom, true);
  assert.equal(out.delimiter, ",");
  assert.ok(out.text.startsWith("reference"), "the mark survived into the header");
});

test("a file that is not valid UTF-8 is rejected with the byte offset", () => {
  // 0xFF is not a legal UTF-8 byte anywhere.
  const bytes = Buffer.concat([
    Buffer.from("reference,vendor\nPO-1,North"), Buffer.from([0xff]), Buffer.from("wind\n"),
  ]);

  assert.throws(() => sniff(bytes), /not valid UTF-8 at byte 27/);
});

test("a quoted field keeps its delimiter and its escaped quote", () => {
  const rows = parseDelimited('a,b\n"Northwind Paper, SL","he said ""yes"""\n', ",");

  assert.deepEqual(rows[1], ["Northwind Paper, SL", 'he said "yes"']);
});

test("a quoted field may span a newline", () => {
  const rows = parseDelimited('a,b\n"line one\nline two",x\n', ",");

  assert.equal(rows.length, 2, "the row was split on a newline inside quotes");
  assert.equal(rows[1][0], "line one\nline two");
});

const { proposeMapping, importRecords } = require("../lib/importer");

test("a mapping is proposed from the headers", () => {
  const mapping = proposeMapping(["Reference", "Supplier", "Net amount", "Ccy", "Issued"]);

  assert.equal(mapping.reference, 0);
  assert.equal(mapping.vendor, 1);
  assert.equal(mapping.amount, 2);
  assert.equal(mapping.currency, 3);
  assert.equal(mapping.issuedOn, 4);
});

test("a header the importer does not recognise proposes null rather than a guess", () => {
  const mapping = proposeMapping(["col_a", "col_b", "col_c"]);

  assert.deepEqual(mapping,
    { reference: null, vendor: null, amount: null, currency: null, issuedOn: null });
});

test("both delimiters and both decimal conventions import to the same integer", () => {
  const header = ["reference", "vendor", "amount", "currency"];
  const latin = Buffer.from("reference;vendor;amount;currency\nPO-1;Northwind;1.234,50;EUR\n", "utf-8");
  const anglo = Buffer.from("reference,vendor,amount,currency\nPO-1,Northwind,1234.50,EUR\n", "utf-8");

  const a = importRecords(latin, { mapping: proposeMapping(header) });
  const b = importRecords(anglo, { mapping: proposeMapping(header) });

  assert.deepEqual(a.rejected, []);
  assert.equal(a.rows[0].amountMinor, 123450n);
  assert.equal(b.rows[0].amountMinor, 123450n);
});

test("a malformed amount is rejected by line number, with the value that broke it", () => {
  const bytes = Buffer.from(
    "reference,vendor,amount,currency\n" +
    "PO-1,Northwind,1234.50,EUR\n" +
    "PO-2,Harborlight,not a number,EUR\n" +
    "PO-3,Solent,99.00,EUR\n", "utf-8");

  const out = importRecords(bytes,
    { mapping: proposeMapping(["reference", "vendor", "amount", "currency"]) });

  assert.equal(out.rows.length, 2, "a bad row took the good ones with it");
  assert.equal(out.rejected.length, 1);
  assert.equal(out.rejected[0].line, 3, "the reviewer cannot find the row without its line number");
  assert.match(out.rejected[0].reason, /amount/);
  assert.match(out.rejected[0].raw, /not a number/);
});

test("a currency fused to the amount is read from it", () => {
  // Semicolon-delimited, because a continental decimal cannot sit unquoted in a
  // comma-delimited file: the decimal separator is the delimiter. That pairing is exactly
  // why European exports use semicolons.
  const bytes = Buffer.from("reference;vendor;amount\nPO-1;Northwind;EUR 1.234,50\n", "utf-8");
  const out = importRecords(bytes,
    { mapping: { reference: 0, vendor: 1, amount: 2, currency: null, issuedOn: null } });

  assert.deepEqual(out.rejected, []);
  assert.equal(out.rows[0].currency, "EUR");
  assert.equal(out.rows[0].amountMinor, 123450n);
});

test("a record with no currency anywhere is rejected, never defaulted", () => {
  const bytes = Buffer.from("reference,vendor,amount\nPO-1,Northwind,1234.50\n", "utf-8");
  const out = importRecords(bytes,
    { mapping: { reference: 0, vendor: 1, amount: 2, currency: null, issuedOn: null } });

  assert.equal(out.rows.length, 0);
  assert.match(out.rejected[0].reason, /currency/);
});

test("a duplicate reference for the same vendor is rejected, naming the first line", () => {
  const bytes = Buffer.from(
    "reference,vendor,amount,currency\n" +
    "PO-1,Northwind,10.00,EUR\n" +
    "PO-1,Northwind,20.00,EUR\n", "utf-8");

  const out = importRecords(bytes,
    { mapping: proposeMapping(["reference", "vendor", "amount", "currency"]) });

  assert.equal(out.rows.length, 1);
  assert.match(out.rejected[0].reason, /line 2/);
});

test("a row with more cells than the header is rejected, not parsed", () => {
  // A continental amount unquoted in a comma file splits into two cells, and the leftover
  // "EUR 1.234" parses cleanly as 123400 -- 1.234,50 read as 1.234,00, with the fifty cents
  // gone and nothing to show for it. The cell count is the only signal that this happened.
  const bytes = Buffer.from("reference,vendor,amount\nPO-1,Northwind,EUR 1.234,50\n", "utf-8");

  const out = importRecords(bytes,
    { mapping: { reference: 0, vendor: 1, amount: 2, currency: null, issuedOn: null } });

  assert.equal(out.rows.length, 0, "a row that lost its shape was imported anyway");
  assert.match(out.rejected[0].reason, /4 cells.*header has 3/);
});

test("a short row is rejected too, since a missing cell shifts every column after it", () => {
  const bytes = Buffer.from("reference,vendor,amount,currency\nPO-1,Northwind,10.00\n", "utf-8");

  const out = importRecords(bytes,
    { mapping: proposeMapping(["reference", "vendor", "amount", "currency"]) });

  assert.equal(out.rows.length, 0);
  assert.match(out.rejected[0].reason, /3 cells.*header has 4/);
});

const fs = require("node:fs");
const path = require("node:path");
const RECORDS = path.join(__dirname, "..", "fixtures", "records");

const read = (name) => {
  const bytes = fs.readFileSync(path.join(RECORDS, name));
  const { text, delimiter } = sniff(bytes);
  return importRecords(bytes, { mapping: proposeMapping(parseDelimited(text, delimiter)[0]) });
};

test("every well-formed fixture imports with no rejections", () => {
  for (const name of ["orders-comma.csv", "orders-semicolon.csv", "orders-bom.csv", "orders-quoted.csv"]) {
    const out = read(name);
    assert.deepEqual(out.rejected, [], `${name}: ${JSON.stringify(out.rejected)}`);
    assert.ok(out.rows.length >= 3, `${name} imported only ${out.rows.length} rows`);
  }
});

test("the two conventions describe the same ledger", () => {
  assert.deepEqual(
    read("orders-comma.csv").rows.map((r) => r.amountMinor),
    read("orders-semicolon.csv").rows.map((r) => r.amountMinor),
    "a semicolon export and a comma export of the same ledger disagree about the amounts");
});

test("the broken fixture rejects exactly its broken rows and keeps the rest", () => {
  const out = read("orders-broken.csv");

  assert.equal(out.rejected.length, 3);
  for (const r of out.rejected) {
    assert.ok(Number.isInteger(r.line) && r.line > 1, "a rejection with no line number cannot be found");
    assert.ok(r.reason.length > 0);
  }
  assert.ok(out.rows.length > 0, "one bad row emptied the file");
});

test("a file whose columns are unrecognisable maps to nothing rather than to a guess", () => {
  const bytes = fs.readFileSync(path.join(RECORDS, "orders-wrong-columns.csv"));
  const { text, delimiter } = sniff(bytes);
  const mapping = proposeMapping(parseDelimited(text, delimiter)[0]);

  assert.equal(mapping.amount, null, "an unrecognisable header was mapped to a column anyway");
  assert.equal(importRecords(bytes, { mapping }).rows.length, 0);
});

test("a file that is not valid UTF-8 is refused before any row is read", () => {
  assert.throws(() => sniff(fs.readFileSync(path.join(RECORDS, "orders-latin1.csv"))),
    /not valid UTF-8 at byte \d+/);
});
