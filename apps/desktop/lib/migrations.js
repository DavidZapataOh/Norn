"use strict";

// Forward-only, appended never edited. Editing a shipped migration means a database in the
// wild has a schema no code describes.
//
// Every table is STRICT. SQLite's default typing is advisory: an INTEGER column accepts the
// string "not a bigint" and stores it as text, and every later read of that ledger is wrong.
// STRICT is what makes the declared type mean something, and money is the reason.
const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE vendors (
        id      INTEGER PRIMARY KEY,
        name    TEXT NOT NULL,
        tax_id  TEXT,
        active  INTEGER NOT NULL DEFAULT 1
      ) STRICT;

      CREATE TABLE records (
        id            INTEGER PRIMARY KEY,
        vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
        reference     TEXT NOT NULL,
        currency      TEXT NOT NULL,
        amount_minor  INTEGER NOT NULL,
        issued_on     TEXT,
        source_file   TEXT,
        UNIQUE (vendor_id, reference)
      ) STRICT;

      CREATE TABLE documents (
        id       INTEGER PRIMARY KEY,
        digest   TEXT NOT NULL UNIQUE,
        path     TEXT NOT NULL,
        route    TEXT NOT NULL,
        read_at  TEXT NOT NULL
      ) STRICT;

      -- Fields are rows because the template is the user's. A column per field would put a
      -- schema migration behind every column somebody adds.
      CREATE TABLE document_fields (
        document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        key          TEXT NOT NULL,
        type         TEXT NOT NULL,
        value_text   TEXT,
        value_minor  INTEGER,
        bbox         TEXT,
        admitted     INTEGER NOT NULL,
        check_failed TEXT,
        confidence   REAL,
        width        TEXT,
        source       TEXT,
        PRIMARY KEY (document_id, key)
      ) STRICT;

      -- Reconciliation looks up by exactly these.
      CREATE INDEX records_amount    ON records (amount_minor);
      CREATE INDEX records_reference ON records (reference);
      CREATE INDEX records_vendor    ON records (vendor_id);
      CREATE INDEX fields_key        ON document_fields (key);
    `,
  },
];

module.exports = { MIGRATIONS };
