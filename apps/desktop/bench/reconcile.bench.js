"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { createExtractor } = require("../lib/extractor");
const { createPipeline } = require("../lib/pipeline");
const { openStore } = require("../lib/store");
const { importRecords, sniff, parseDelimited, proposeMapping } = require("../lib/importer");
const { reconcile } = require("../lib/reconcile");
const { digestFile } = require("../lib/digest");
const { DEFAULT_TEMPLATE } = require("../lib/schema");
const { tally, VERDICTS } = require("./reconcile-report");
const { launchApp, callInMain } = require("../test/helpers/launch");

const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");
const RECORDS = path.join(__dirname, "..", "fixtures", "records");
const ONLY = process.argv.find((a) => a.startsWith("--only="));

// The value the gate admitted, or the value it declined, so reconcile can distinguish
// "the document says nothing" from "the gate withheld it".
const lookup = (fields, key) => fields[key];

function seedStore(store) {
  const bytes = fs.readFileSync(path.join(RECORDS, "reconcile.csv"));
  const { text, delimiter } = sniff(bytes);
  const { rows, rejected } = importRecords(bytes,
    { mapping: proposeMapping(parseDelimited(text, delimiter)[0]) });
  if (rejected.length) throw new Error(`the record set does not import: ${JSON.stringify(rejected)}`);
  store.importRows(rows, { sourceFile: "reconcile.csv" });

  const expected = JSON.parse(fs.readFileSync(path.join(RECORDS, "expected.json"), "utf8"));
  for (const entry of Object.values(expected)) {
    if (entry.deactivateVendor) store.deactivateVendor(entry.deactivateVendor);
  }
  return expected;
}

async function main() {
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));
  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-reconcile", "inference.jsonl") });
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-reconcile-db-"));
  const store = openStore({ file: path.join(dbDir, "norn.db") });
  const expected = seedStore(store);

  const extractor = createExtractor({ audit, template: DEFAULT_TEMPLATE });
  const session = await launchApp();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-reconcile-"));
  const pipeline = createPipeline({
    extractor, audit, template: DEFAULT_TEMPLATE, outDir,
    raster: {
      renderFirstPage: (file, opts) => callInMain(session, "raster.js", "renderFirstPage", [file, opts]),
      readTextGeometry: (file) => callInMain(session, "raster.js", "readTextGeometry", [file]),
    },
  });

  const results = [];
  const rows = [];
  let duplicateMs = null;

  try {
    for (const name of Object.keys(expected).sort()) {
      if (ONLY && !ONLY.slice(7).split(",").includes(name)) continue;
      const file = path.join(CORPUS, name);
      const started = performance.now();

      const digest = digestFile(file);
      const alreadySeen = store.wasReconciled(digest);
      const out = await pipeline.run(file);
      if (out.skipped) continue;

      const stored = store.putDocument({ digest, path: file, route: out.route, fields: out.fields });
      const candidates = store.candidatesFor({
        reference: lookup(out.fields, "invoice_no")?.value ?? null,
        vendor: lookup(out.fields, "vendor")?.value ?? null,
        currency: lookup(out.fields, "currency")?.value ?? null,
        amountMinor: lookup(out.fields, "total")?.value ?? null,
      });

      const verdict = reconcile(out.fields, candidates, { alreadySeen });
      store.putReconciliation(stored.id, verdict);

      const ms = Math.round(performance.now() - started);
      results.push({ name, expected: expected[name].verdict, actual: verdict.decision });
      rows.push({ name, route: out.route, decision: verdict.decision,
                  want: expected[name].verdict, variance: verdict.variance?.minor ?? null, ms });
    }

    // A resubmission must be caught before a model loads. That is the cheapest path through
    // the whole product and the one a user meets every time a folder is rerun.
    // The first document actually processed, not the first in the set: with a filter the
    // two differ and the check asks about a document that was never read.
    const first = rows[0].name;
    const t = performance.now();
    const seen = store.wasReconciled(digestFile(path.join(CORPUS, first)));
    duplicateMs = Math.round((performance.now() - t) * 1000) / 1000;
    if (!seen) throw new Error("a document reconciled moments ago is not known as reconciled");
  } finally {
    await extractor.unload();
    await session.close();
    store.close();
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }

  report(rows, results, duplicateMs);
}

function report(rows, results, duplicateMs) {
  const t = tally(results);

  console.log(`\nCONFIDENTLY WRONG: ${t.confidentlyWrong}` +
    (t.confidentlyWrong ? ` -- ${t.byDocument.confidentlyWrong.join(", ")}` : ""));
  if (t.confidentlyWrong === 0) {
    console.log(`  Zero on ${t.total} documents reports the size of this record set, not the`);
    console.log(`  quality of the reconciliation: it cannot distinguish one that catches`);
    console.log(`  errors from a set with none for it to miss.`);
  }

  console.log("\nDOCUMENT                  ROUTE             WANT           GOT            VARIANCE   MS");
  for (const r of rows) {
    const mark = r.decision === r.want ? " " : "*";
    console.log(`${mark}${r.name.padEnd(24)} ${r.route.padEnd(17)} ${r.want.padEnd(14)} ` +
      `${r.decision.padEnd(14)} ${String(r.variance ?? "-").padEnd(10)} ${r.ms}`);
  }

  console.log("\nexpected \\ actual   " + VERDICTS.map((v) => v.slice(0, 12).padEnd(13)).join(""));
  for (const want of VERDICTS) {
    console.log(`${want.padEnd(20)}` +
      VERDICTS.map((got) => String(t.table[want][got]).padEnd(13)).join(""));
  }

  console.log(`\nCOST OF ABSTENTION: ${t.costOfAbstention}` +
    (t.costOfAbstention ? ` -- ${t.byDocument.costOfAbstention.join(", ")}` : ""));
  console.log(`duplicate check, before any model loads: ${duplicateMs} ms`);
  console.log(`\n${t.total} documents and ${t.total} records is enough to show a direction ` +
    `and not enough to state a rate.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
