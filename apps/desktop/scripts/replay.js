"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { createExtractor, modelForRoute } = require("../lib/extractor");
const { createPipeline } = require("../lib/pipeline");
const { certifyRun } = require("../lib/certificate");
const { compare, comparability } = require("../lib/replay");
const { digestFile } = require("../lib/digest");
const { sdkVersion } = require("../lib/sdk");
const { DEFAULT_TEMPLATE } = require("../lib/schema");
const { launchApp, callInMain } = require("../test/helpers/launch");

// Everything comes from the descriptor and nothing from ambient state. The descriptor being
// sufficient on its own is the property under test: if replay needs something the certificate
// does not carry, the descriptor is incomplete and that is the defect, not the mismatch.
function parseArgs(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? { value: undefined, index: -1 } : { value: argv[i + 1], index: i + 1 };
  };
  const documents = at("--documents");
  const files = argv.filter((arg, i) => !arg.startsWith("--") && i !== documents.index);
  return { files, documentsDir: documents.value };
}

// By digest, not by the recorded path. That is what lets a certificate be replayed on a
// machine that is not the one that made it, which is the whole point of the artefact being
// portable.
function findByDigest(digest, directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const candidate = path.join(directory, entry.name);
    if (digestFile(candidate) === digest) return candidate;
  }
  return null;
}

async function main(argv) {
  const { files, documentsDir } = parseArgs(argv);
  if (files.length === 0 || !documentsDir) {
    console.error("usage: replay.js <certificate.json>... --documents <dir>");
    return 2;
  }

  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-replay", "inference.jsonl") });
  const installed = sdkVersion();
  const rows = [];
  let session = null;
  let extractor = null;
  let outDir = null;

  try {
    for (const file of files) {
      const recorded = JSON.parse(fs.readFileSync(file, "utf8"));
      const name = path.basename(file);

      // The model this environment would run for that route, not the one the certificate
      // names. Comparing the recorded model against itself always agrees, and the check that
      // exists to refuse a run before it starts would never fire.
      const verdict = comparability(recorded,
        { sdkVersion: installed, model: modelForRoute(recorded.document?.route) });
      if (!verdict.comparable) {
        rows.push({ name, outcome: "not comparable", detail: verdict.reason, ms: 0 });
        continue;
      }

      const document = findByDigest(recorded.document.digest, documentsDir);
      if (!document) {
        rows.push({ name, outcome: "input missing",
                    detail: `no file in ${documentsDir} digests to ` +
                            `${recorded.document.digest.slice(0, 12)}`, ms: 0 });
        continue;
      }

      if (!session) {
        session = await launchApp();
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-replay-"));
      }
      // A fresh extractor per certificate, seeded from the descriptor. Reusing one across
      // certificates with different seeds would replay the second under the first's seed.
      extractor = createExtractor({ audit, template: DEFAULT_TEMPLATE, seed: recorded.replay.seed });
      const pipeline = createPipeline({
        extractor, audit, template: DEFAULT_TEMPLATE, outDir,
        raster: {
          renderFirstPage: (f, o) => callInMain(session, "raster.js", "renderFirstPage", [f, o]),
          readTextGeometry: (f) => callInMain(session, "raster.js", "readTextGeometry", [f]),
        },
      });

      const started = performance.now();
      const run = await pipeline.run(document);
      const regenerated = certifyRun({
        file: document, run,
        // The recorded verdict, not a recomputed one. Reconciliation needs the record set,
        // which is not in the certificate; replaying the reading is what this checks, and
        // pretending otherwise would be replaying half the run and reporting the whole.
        verdict: recorded.verdict, currency: recorded.fields?.currency?.value ?? null,
        sdkVersion: installed, seed: recorded.replay.seed,
      });
      const ms = Math.round(performance.now() - started);

      const out = compare(recorded, { ...regenerated, verdict: recorded.verdict });
      rows.push({
        name, ms,
        outcome: out.match ? "match" : "mismatch",
        detail: out.match
          ? `${Object.keys(regenerated.fields).length} fields, root ${regenerated.trace.root.slice(0, 12)}`
          : `${out.differences.length} differences, first at ${out.firstDifference.path}: ` +
            `${JSON.stringify(out.firstDifference.recorded)} against ` +
            `${JSON.stringify(out.firstDifference.regenerated)}`,
      });
      await extractor.unload();
      extractor = null;
    }
  } finally {
    if (extractor) await extractor.unload().catch(() => {});
    if (session) await session.close();
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  }

  report(rows);
  return rows.some((r) => r.outcome === "mismatch" || r.outcome === "input missing") ? 1 : 0;
}

function report(rows) {
  console.log("\nCERTIFICATE                    OUTCOME          MS      DETAIL");
  for (const row of rows) {
    console.log(`${row.name.padEnd(30)} ${row.outcome.padEnd(16)} ${String(row.ms).padEnd(7)} ${row.detail}`);
  }

  const matched = rows.filter((r) => r.outcome === "match").length;
  const comparable = rows.filter((r) => r.outcome === "match" || r.outcome === "mismatch").length;
  console.log(`\n${matched} of ${comparable} comparable certificates replayed byte for byte.`);
  console.log("\n  Replay establishes that the reported execution is the one that occurred. It");
  console.log("  does not establish that the execution was right: provenance and abstention");
  console.log("  address correctness, this addresses whether the document in your hand");
  console.log("  describes what actually ran.");
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c))
  .catch((e) => { console.error(e); process.exit(1); });

module.exports = { parseArgs, findByDigest };
