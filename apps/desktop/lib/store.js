"use strict";
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS } = require("./migrations");

const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// A recogniser that returned ES-XOOOOOOOX for ES-X0000000X will do the same to a reference,
// and a comparison demanding the exact string misses rows a reviewer can see match.
// Alphanumerics only is enough, and does not merge two genuinely different references.
const referenceKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// A flagged statement returns every INTEGER as a BigInt, so the ids and the active flag
// arrive alongside the money and have to come back down.
const plainRow = (row) => (row === undefined ? undefined : {
  ...row, id: Number(row.id), active: Number(row.active),
});

function openStore({ file }) {
  const db = new DatabaseSync(file);

  // Measured defaults for this driver: journal_mode "delete", busy_timeout 0, foreign_keys
  // already 1. The first two are wrong for an application that writes while the user reads,
  // where a read blocks behind a write and a concurrent access throws instead of waiting.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  // Redundant today and pinned anyway: node:sqlite is experimental, so its defaults are not
  // a contract, and a row referencing one that is gone is not a failure to discover later.
  db.exec("PRAGMA foreign_keys = ON");

  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL) STRICT");
  const current = db.prepare("SELECT version FROM schema_version").get();
  let version = current ? Number(current.version) : 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.up);
      db.exec("DELETE FROM schema_version");
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
      db.exec("COMMIT");
      version = migration.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${migration.version} failed: ${error.message}`);
    }
  }

  // Every statement that reads money. Without this a value beyond 2^53 throws on read rather
  // than returning, so a store could hold a number it could not give back.
  //
  // The flag is per statement, not per column: every INTEGER a flagged statement returns
  // comes back as a BigInt, so a boolean column reads as 1n and `=== 1` is false. Rows from
  // these statements go through `plain` before anything compares them.
  const money = (sql) => {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return statement;
  };

  const statements = {
    putVendor: db.prepare("INSERT INTO vendors (name, tax_id, active) VALUES (?, ?, ?)"),
    getVendor: db.prepare("SELECT id, name, tax_id AS taxId, active FROM vendors WHERE id = ?"),
    deactivateVendor: db.prepare("UPDATE vendors SET active = 0 WHERE name = ?"),
    putRecord: db.prepare(`INSERT INTO records
      (vendor_id, reference, reference_key, currency, amount_minor, issued_on, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    byReference: money(`SELECT r.id, r.reference, v.name AS vendorName, r.currency,
      r.amount_minor AS amountMinor, v.active
      FROM records r JOIN vendors v ON v.id = r.vendor_id
      WHERE r.reference_key = ?`),
    byVendorAmount: money(`SELECT r.id, r.reference, v.name AS vendorName, r.currency,
      r.amount_minor AS amountMinor, v.active
      FROM records r JOIN vendors v ON v.id = r.vendor_id
      WHERE v.name = ? AND r.currency = ? AND r.amount_minor = ?`),
    wasReconciled: db.prepare(`SELECT 1 AS found FROM reconciliations c
      JOIN documents d ON d.id = c.document_id WHERE d.digest = ?`),
    putReconciliation: db.prepare(`INSERT INTO reconciliations
      (document_id, record_id, decision, variance, computed_at) VALUES (?, ?, ?, ?, ?)`),
    putCheck: db.prepare(`INSERT INTO reconciliation_checks
      (reconciliation_id, name, outcome, detail) VALUES (?, ?, ?, ?)`),
    getReconciliation: money(`SELECT id, record_id AS recordId, decision, variance,
      computed_at AS computedAt FROM reconciliations WHERE document_id = ?
      ORDER BY id DESC LIMIT 1`),
    getChecks: db.prepare(`SELECT name, outcome, detail FROM reconciliation_checks
      WHERE reconciliation_id = ? ORDER BY rowid`),
    getRecord: money(`SELECT id, vendor_id AS vendorId, reference, currency,
      amount_minor AS amountMinor, issued_on AS issuedOn, source_file AS sourceFile
      FROM records WHERE id = ?`),

    findVendor: db.prepare("SELECT id FROM vendors WHERE name = ?"),
    findRecord: db.prepare("SELECT id FROM records WHERE vendor_id = ? AND reference = ?"),
    countRecords: db.prepare("SELECT COUNT(*) AS n FROM records"),
    countVendors: db.prepare("SELECT COUNT(*) AS n FROM vendors"),

    findDocument: db.prepare("SELECT id FROM documents WHERE digest = ?"),
    putDocument: db.prepare("INSERT INTO documents (digest, path, route, read_at) VALUES (?, ?, ?, ?)"),
    getDocument: db.prepare(`SELECT id, digest, path, route, read_at AS readAt
      FROM documents WHERE digest = ?`),
    putField: db.prepare(`INSERT INTO document_fields
      (document_id, key, type, value_text, value_minor, bbox, admitted, check_failed,
       confidence, width, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getFields: money(`SELECT key, type, value_text AS valueText, value_minor AS valueMinor,
      bbox, admitted, check_failed AS checkFailed, confidence, width, source
      FROM document_fields WHERE document_id = ?`),
  };

  return {
    get version() { return version; },
    close: () => db.close(),
    pragma: (name) => Object.values(db.prepare(`PRAGMA ${name}`).get())[0],

    putVendor: ({ name, taxId = null, active = 1 }) =>
      Number(statements.putVendor.run(name, taxId, active).lastInsertRowid),
    getVendor: (id) => statements.getVendor.get(id),
    // A supplier that stopped trading still has records in the ledger, and matching one is a
    // finding rather than a match.
    deactivateVendor: (name) => Number(statements.deactivateVendor.run(name).changes),

    putRecord: ({ vendorId, reference, currency, amountMinor, issuedOn = null, sourceFile = null }) =>
      Number(statements.putRecord.run(vendorId, reference, referenceKey(reference), currency, amountMinor, issuedOn, sourceFile).lastInsertRowid),
    getRecord: (id) => statements.getRecord.get(id),

    candidatesFor({ reference, vendor, currency, amountMinor }) {
      if (reference) {
        const found = statements.byReference.all(referenceKey(reference));
        if (found.length) return found.map(plainRow);
      }
      // Never on amount alone: a real ledger has many rows at the same amount, and picking
      // one at random is a confident wrong verdict. SQL already refuses, since nothing
      // equals NULL; this returns early so an absent field is an empty result rather than
      // "cannot be bound to SQLite parameter", which reads like a bug in the query.
      if (!vendor || !currency || amountMinor === null || amountMinor === undefined) return [];
      return statements.byVendorAmount.all(vendor, currency, amountMinor).map(plainRow);
    },

    wasReconciled: (digest) => statements.wasReconciled.get(digest) !== undefined,

    putReconciliation(documentId, verdict, now = new Date().toISOString()) {
      db.exec("BEGIN");
      try {
        const id = Number(statements.putReconciliation.run(
          documentId, verdict.record ? verdict.record.id : null, verdict.decision,
          verdict.variance ? verdict.variance.minor : null, now).lastInsertRowid);

        // The checks, not just the decision. A verdict a reviewer cannot open is a score
        // with more words, and the only question six months later is which check failed.
        for (const check of verdict.checks) {
          statements.putCheck.run(id, check.name, check.outcome, check.detail);
        }
        db.exec("COMMIT");
        return id;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getReconciliation(documentId) {
      const row = statements.getReconciliation.get(documentId);
      if (!row) return null;
      return {
        id: Number(row.id),
        recordId: row.recordId === null ? null : Number(row.recordId),
        decision: row.decision,
        variance: row.variance,
        computedAt: row.computedAt,
        checks: statements.getChecks.all(Number(row.id)),
      };
    },

    importRows(rows, { sourceFile }) {
      // One transaction. A file that fails on row 400 must leave nothing behind, because a
      // half-imported ledger reconciles against the rows that made it.
      db.exec("BEGIN");
      try {
        const vendorIds = new Map();
        const skipped = [];
        let records = 0;

        for (const row of rows) {
          let vendorId = vendorIds.get(row.vendor);
          if (vendorId === undefined) {
            const existing = statements.findVendor.get(row.vendor);
            vendorId = existing
              ? Number(existing.id)
              : Number(statements.putVendor.run(row.vendor, null, 1).lastInsertRowid);
            vendorIds.set(row.vendor, vendorId);
          }

          // The importer rejects a duplicate within one file; two files can still collide,
          // and this is the only place that sees both.
          if (statements.findRecord.get(vendorId, row.reference)) {
            skipped.push({ reference: row.reference, reason: "already in the ledger" });
            continue;
          }

          statements.putRecord.run(vendorId, row.reference, referenceKey(row.reference),
            row.currency, row.amountMinor, row.issuedOn, sourceFile);
          records++;
        }

        db.exec("COMMIT");
        return { vendors: vendorIds.size, records, skipped };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    countRecords: () => Number(statements.countRecords.get().n),
    countVendors: () => Number(statements.countVendors.get().n),

    putDocument({ digest, path: filePath, route, fields, now = new Date().toISOString() }) {
      const existing = statements.findDocument.get(digest);
      // Keyed on content, not path: the same invoice under two filenames is one document,
      // which is also what makes duplicate detection free rather than a feature.
      if (existing) return { id: Number(existing.id), inserted: false };

      db.exec("BEGIN");
      try {
        const id = Number(statements.putDocument.run(digest, filePath, route, now).lastInsertRowid);
        for (const [key, verdict] of Object.entries(fields)) {
          // An abstention is stored, not dropped. A store that kept only admitted values
          // would put back the silence the gate exists to remove.
          statements.putField.run(
            id, key, verdict.type,
            verdict.type === "amount" ? null : (verdict.value === null ? null : String(verdict.value)),
            verdict.type === "amount" ? verdict.value : null,
            verdict.bbox ? JSON.stringify(verdict.bbox) : null,
            verdict.admitted ? 1 : 0,
            verdict.admitted ? null : verdict.check,
            typeof verdict.confidence === "number" ? verdict.confidence : null,
            verdict.width ?? null,
            verdict.source ?? null,
          );
        }
        db.exec("COMMIT");
        return { id, inserted: true };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getDocument(digest) {
      const row = statements.getDocument.get(digest);
      if (!row) return null;
      const fields = {};
      for (const f of statements.getFields.all(Number(row.id))) {
        fields[f.key] = {
          type: f.type,
          value: f.type === "amount" ? f.valueMinor : f.valueText,
          bbox: f.bbox ? JSON.parse(f.bbox) : null,
          // Number() because this statement reads BigInts for the money column and the flag
          // arrives as 1n along with it.
          admitted: Number(f.admitted) === 1,
          check: f.checkFailed,
          confidence: f.confidence,
          width: f.width,
          source: f.source,
        };
      }
      return { ...row, id: Number(row.id), fields };
    },
  };
}

module.exports = { openStore, CURRENT_VERSION };
