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
