"use strict";
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS } = require("./migrations");

const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

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

  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
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
    putRecord: db.prepare(`INSERT INTO records
      (vendor_id, reference, currency, amount_minor, issued_on, source_file)
      VALUES (?, ?, ?, ?, ?, ?)`),
    getRecord: money(`SELECT id, vendor_id AS vendorId, reference, currency,
      amount_minor AS amountMinor, issued_on AS issuedOn, source_file AS sourceFile
      FROM records WHERE id = ?`),

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

    putRecord: ({ vendorId, reference, currency, amountMinor, issuedOn = null, sourceFile = null }) =>
      Number(statements.putRecord.run(vendorId, reference, currency, amountMinor, issuedOn, sourceFile).lastInsertRowid),
    getRecord: (id) => statements.getRecord.get(id),

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
