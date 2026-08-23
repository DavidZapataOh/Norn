"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openStore, CURRENT_VERSION } = require("../lib/store");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-store-"));
  const file = path.join(dir, "norn.db");
  return { store: openStore({ file }), dir, file };
}

test("migrations run from empty and report the current version", () => {
  const { store, dir } = tempStore();
  try {
    assert.equal(store.version, CURRENT_VERSION);
    assert.ok(CURRENT_VERSION >= 1);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("opening an already-migrated database changes nothing", () => {
  const { store, dir, file } = tempStore();
  try {
    const vendorId = store.putVendor({ name: "Northwind Paper Supply SL", taxId: "ES-X0000000X", active: 1 });
    store.close();

    const reopened = openStore({ file });
    assert.equal(reopened.version, CURRENT_VERSION, "a second open re-ran a migration");
    assert.equal(reopened.getVendor(vendorId).name, "Northwind Paper Supply SL",
      "committed rows did not survive the reopen");
    reopened.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("money round-trips as a BigInt, at a magnitude a float would lose", () => {
  const { store, dir } = tempStore();
  try {
    const vendorId = store.putVendor({ name: "Ledger Test SL", taxId: null, active: 1 });
    // Beyond Number.MAX_SAFE_INTEGER: a ledger total in minor units reaches this, and a
    // store that returns it as a float has silently changed the number.
    const big = 9007199254740993n;
    const id = store.putRecord({
      vendorId, reference: "PO-BIG", currency: "EUR",
      amountMinor: big, issuedOn: "2026-03-14", sourceFile: "seed",
    });

    const row = store.getRecord(id);
    assert.equal(typeof row.amountMinor, "bigint", "money came back as a Number");
    assert.equal(row.amountMinor, big);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("foreign keys are enforced, so a record cannot reference a vendor that is gone", () => {
  const { store, dir } = tempStore();
  try {
    assert.throws(() => store.putRecord({
      vendorId: 9999, reference: "PO-ORPHAN", currency: "EUR",
      amountMinor: 100n, issuedOn: "2026-03-14", sourceFile: "seed",
    }), /FOREIGN KEY/i);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the pragmas an application needs are set, not left at their defaults", () => {
  // Measured on this driver: journal_mode defaults to "delete" and busy_timeout to 0. A read
  // that blocks behind a write, and a concurrent access that throws instead of waiting, are
  // both invisible until two windows are open.
  const { store, dir } = tempStore();
  try {
    assert.equal(store.pragma("journal_mode"), "wal");
    assert.equal(store.pragma("busy_timeout"), 5000);
    assert.equal(store.pragma("foreign_keys"), 1);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const { judgeAll } = require("../lib/gate");

const judged = () => judgeAll(
  {
    total: { type: "amount", value: 52381n, raw: "523,81" },
    vendor: { type: "string", value: "Northwind Paper Supply SL", raw: "Northwind Paper Supply SL" },
    tax: { type: "amount", value: 9091n, raw: "90,91" },
  },
  {
    total: { status: "region", bbox: [820, 500, 1020, 530], confidence: 0.94, text: "523,81" },
    vendor: { status: "span", bbox: [80, 100, 400, 130], text: "Northwind Paper Supply SL", source: "text-layer" },
    tax: { status: "unbound", reason: "value not found on the page" },
  },
);

test("a document stores every field the gate judged, admitted or not", () => {
  const { store, dir } = tempStore();
  try {
    const { id, inserted } = store.putDocument({
      digest: "a".repeat(64), path: "/docs/invoice.pdf", route: "text", fields: judged().fields,
    });
    assert.equal(inserted, true);

    const back = store.getDocument("a".repeat(64));
    assert.equal(back.id, id);
    assert.equal(Object.keys(back.fields).length, 3, "an abstained field was dropped");

    assert.equal(back.fields.total.admitted, true);
    assert.equal(back.fields.total.value, 52381n, "money came back as something other than a BigInt");
    assert.deepEqual(back.fields.total.bbox, [820, 500, 1020, 530]);

    assert.equal(back.fields.tax.admitted, false);
    assert.equal(back.fields.tax.check, "binding", "the abstention lost the check that produced it");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the same document under a second filename is one document", () => {
  const { store, dir } = tempStore();
  try {
    const first = store.putDocument({
      digest: "b".repeat(64), path: "/inbox/march.pdf", route: "text", fields: judged().fields,
    });
    const second = store.putDocument({
      digest: "b".repeat(64), path: "/archive/NW-2026-0117.pdf", route: "text", fields: judged().fields,
    });

    assert.equal(second.inserted, false, "the same bytes were stored twice");
    assert.equal(second.id, first.id);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a text-layer field keeps its source, so the missing confidence stays explained", () => {
  const { store, dir } = tempStore();
  try {
    store.putDocument({
      digest: "c".repeat(64), path: "/docs/x.pdf", route: "text", fields: judged().fields,
    });
    const back = store.getDocument("c".repeat(64));

    assert.equal(back.fields.vendor.source, "text-layer");
    assert.equal(back.fields.vendor.confidence, null,
      "a fabricated confidence would make a stored field look checked");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const importable = [
  { reference: "PO-1", vendor: "Northwind Paper Supply SL", currency: "EUR", amountMinor: 123450n, issuedOn: "2026-03-14" },
  { reference: "PO-2", vendor: "Northwind Paper Supply SL", currency: "EUR", amountMinor: 9900n, issuedOn: "2026-03-15" },
  { reference: "PO-3", vendor: "Harborlight Trading Ltd", currency: "GBP", amountMinor: 500000n, issuedOn: "2026-03-16" },
];

test("a supplier named on many rows becomes one vendor", () => {
  const { store, dir } = tempStore();
  try {
    const out = store.importRows(importable, { sourceFile: "orders.csv" });

    assert.equal(out.vendors, 2, "the same supplier was created more than once");
    assert.equal(out.records, 3);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing row leaves no partial state", () => {
  const { store, dir } = tempStore();
  try {
    const poisoned = [...importable,
      { reference: "PO-4", vendor: "Solent", currency: "EUR", amountMinor: "not a bigint", issuedOn: null }];

    assert.throws(() => store.importRows(poisoned, { sourceFile: "orders.csv" }));
    // Half an imported ledger is worse than none: reconciliation would run against the rows
    // that made it and report matches for a file the user believes failed.
    assert.equal(store.countRecords(), 0, "a failed import left rows behind");
    assert.equal(store.countVendors(), 0, "a failed import left vendors behind");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the same reference imported twice is skipped, not duplicated", () => {
  const { store, dir } = tempStore();
  try {
    store.importRows(importable, { sourceFile: "march.csv" });
    const second = store.importRows(importable, { sourceFile: "march-again.csv" });

    assert.equal(second.records, 0);
    assert.equal(second.skipped.length, 3);
    assert.equal(store.countRecords(), 3, "a second import of the same file doubled the ledger");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a money column refuses a value that is not an integer", () => {
  // SQLite's default typing is advisory: an INTEGER column accepts the string "not a
  // bigint" and stores it as text, and every later read of that ledger is wrong. STRICT
  // tables are what make the declared type mean something.
  const { store, dir } = tempStore();
  try {
    const vendorId = store.putVendor({ name: "Solent", active: 1 });

    assert.throws(() => store.putRecord({
      vendorId, reference: "PO-BAD", currency: "EUR",
      amountMinor: "not a bigint", issuedOn: null, sourceFile: "x",
    }), /INTEGER/i);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a reference match is found first, even through recogniser noise", () => {
  const { store, dir } = tempStore();
  try {
    store.importRows([
      { reference: "NW-2026-0117", vendor: "Northwind Paper Supply SL", currency: "EUR", amountMinor: 52381n, issuedOn: null },
      { reference: "HL-2026-4471", vendor: "Harborlight Trading Ltd", currency: "EUR", amountMinor: 52381n, issuedOn: null },
    ], { sourceFile: "orders.csv" });

    const exact = store.candidatesFor({ reference: "NW-2026-0117", vendor: null, currency: "EUR", amountMinor: 52381n });
    assert.equal(exact[0].reference, "NW-2026-0117");

    // A recogniser that returns ES-XOOOOOOOX for ES-X0000000X will do this to a reference.
    const noisy = store.candidatesFor({ reference: "NW 2026 0117", vendor: null, currency: "EUR", amountMinor: 52381n });
    assert.equal(noisy[0].reference, "NW-2026-0117", "punctuation noise lost a reference the reviewer can see");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("with no reference, vendor and amount and currency must all agree", () => {
  const { store, dir } = tempStore();
  try {
    store.importRows([
      { reference: "PO-1", vendor: "Northwind Paper Supply SL", currency: "EUR", amountMinor: 52381n, issuedOn: null },
      { reference: "PO-2", vendor: "Harborlight Trading Ltd", currency: "EUR", amountMinor: 52381n, issuedOn: null },
      { reference: "PO-3", vendor: "Northwind Paper Supply SL", currency: "USD", amountMinor: 52381n, issuedOn: null },
    ], { sourceFile: "orders.csv" });

    const found = store.candidatesFor({
      reference: null, vendor: "Northwind Paper Supply SL", currency: "EUR", amountMinor: 52381n,
    });

    assert.equal(found.length, 1, "the vendor or the currency was ignored");
    assert.equal(found[0].reference, "PO-1");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an amount alone never matches anything", () => {
  const { store, dir } = tempStore();
  try {
    store.importRows([
      { reference: "PO-1", vendor: "Northwind Paper Supply SL", currency: "EUR", amountMinor: 52381n, issuedOn: null },
    ], { sourceFile: "orders.csv" });

    // A real ledger has many rows at the same amount, and picking one at random is the worst
    // outcome this product can produce: a confident wrong verdict. SQL refuses a NULL
    // comparison on its own, so the early return is what turns an absent field into an
    // empty result instead of a binding error.
    assert.deepEqual(
      store.candidatesFor({ reference: null, vendor: null, currency: null, amountMinor: 52381n }), []);
    assert.deepEqual(
      store.candidatesFor({ reference: null, vendor: "Northwind Paper Supply SL", currency: "EUR" }), [],
      "an absent amount threw instead of returning nothing");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a document with no verdict is not known as reconciled", () => {
  const { store, dir } = tempStore();
  try {
    assert.equal(store.wasReconciled("d".repeat(64)), false);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const { reconcile } = require("../lib/reconcile");

test("a verdict is stored with every check it was made of", () => {
  const { store, dir } = tempStore();
  try {
    const { id } = store.putDocument({
      digest: "e".repeat(64), path: "/docs/x.pdf", route: "text", fields: judged().fields,
    });
    store.importRows([{ reference: "NW-2026-0117", vendor: "Northwind Paper Supply SL",
      currency: "EUR", amountMinor: 52381n, issuedOn: null }], { sourceFile: "o.csv" });

    const candidates = store.candidatesFor({ reference: "NW-2026-0117", vendor: null, currency: "EUR", amountMinor: 52381n });
    const verdict = reconcile({
      invoice_no: { key: "invoice_no", admitted: true, type: "string", value: "NW-2026-0117" },
      currency: { key: "currency", admitted: true, type: "string", value: "EUR" },
      total: { key: "total", admitted: true, type: "amount", value: 52381n },
    }, candidates);

    const reconciliationId = store.putReconciliation(id, verdict);
    const back = store.getReconciliation(id);

    assert.equal(back.id, reconciliationId);
    assert.equal(back.decision, verdict.decision);
    assert.equal(back.checks.length, verdict.checks.length, "a check was lost on the way to disk");
    for (const check of back.checks) {
      assert.ok(check.detail.length > 0, "a stored check forgot what it compared");
    }
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a stored verdict makes the document known as reconciled", () => {
  const { store, dir } = tempStore();
  try {
    const { id } = store.putDocument({
      digest: "f".repeat(64), path: "/docs/y.pdf", route: "text", fields: judged().fields,
    });
    assert.equal(store.wasReconciled("f".repeat(64)), false);

    store.putReconciliation(id, reconcile({}, []));

    assert.equal(store.wasReconciled("f".repeat(64)), true,
      "the duplicate check cannot see a verdict that was written");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a verdict about a document that does not exist is refused", () => {
  const { store, dir } = tempStore();
  try {
    assert.throws(() => store.putReconciliation(9999, reconcile({}, [])), /FOREIGN KEY/i);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a vendor can be deactivated, and its records report it", () => {
  const { store, dir } = tempStore();
  try {
    store.importRows([{ reference: "PO-1", vendor: "Ridgeway Supplies Inc", currency: "GBP",
      amountMinor: 143264n, issuedOn: null }], { sourceFile: "o.csv" });

    assert.equal(store.candidatesFor({ reference: "PO-1" })[0].active, 1);

    assert.equal(store.deactivateVendor("Ridgeway Supplies Inc"), 1);
    assert.equal(store.candidatesFor({ reference: "PO-1" })[0].active, 0,
      "the reconciliation cannot see a vendor the store deactivated");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
