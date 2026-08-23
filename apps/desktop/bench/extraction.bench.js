"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { createExtractor } = require("../lib/extractor");
const { createPipeline } = require("../lib/pipeline");
const { DEFAULT_THRESHOLDS } = require("../lib/gate");
const { DEFAULT_TEMPLATE } = require("../lib/schema");
const { scoreDocument, aggregateExtraction } = require("./extraction-report");
const { launchApp, callInMain } = require("../test/helpers/launch");

const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");
const ONLY = process.argv.find((a) => a.startsWith("--only="));
// The floor is overridable so the risk-coverage curve is produced by running the harness
// rather than by editing it, which is what keeps the chosen operating point defensible.
const FLOOR = process.env.NORN_CONFIDENCE_FLOOR
  ? Number(process.env.NORN_CONFIDENCE_FLOOR) : null;

// The template's field keys against the corpus's ground-truth names.
const TRUTH_KEY = { vat: "tax" };

function thresholds() {
  if (FLOOR === null) return DEFAULT_THRESHOLDS;
  return { confidence: Object.fromEntries(
    Object.keys(DEFAULT_THRESHOLDS.confidence).map((k) => [k, FLOOR])) };
}

async function main() {
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));
  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-extraction", "inference.jsonl") });
  const extractor = createExtractor({ audit, template: DEFAULT_TEMPLATE });
  const labels = Object.fromEntries(DEFAULT_TEMPLATE.fields.map((f) => [f.key, f.label]));
  const session = await launchApp();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-extraction-"));
  const pipeline = createPipeline({
    extractor, audit, template: DEFAULT_TEMPLATE, outDir, thresholds: thresholds(),
    raster: {
      renderFirstPage: (file, opts) => callInMain(session, "raster.js", "renderFirstPage", [file, opts]),
      readTextGeometry: (file) => callInMain(session, "raster.js", "readTextGeometry", [file]),
    },
  });
  const rows = [];
  const identityRuns = {};

  try {
    for (const name of Object.keys(truth).sort()) {
      const doc = truth[name];
      if (doc.mode === "skip") continue;
      if (ONLY && !ONLY.slice(7).split(",").includes(name)) continue;

      const out = await pipeline.run(path.join(CORPUS, name));
      if (out.skipped) continue;

      for (const identity of out.identities) {
        identityRuns[identity.name] = (identityRuns[identity.name] ?? 0) + 1;
      }

      const wanted = doc.fields.map((f) => ({ ...f, field: TRUTH_KEY[f.field] ?? f.field }));
      rows.push({
        name, route: out.route, ms: out.timings.totalMs, regions: out.regions,
        gateAdmitted: out.admitted, naConfidence: out.confidenceNotApplicable,
        ...scoreDocument(wanted, out.fields),
      });
    }
  } finally {
    await extractor.unload();
    await session.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  report(rows, identityRuns);
}

function report(rows, identityRuns) {
  console.log("\nDOCUMENT                  ROUTE             RIGHT  WRONG  ABST(R/W)  REGIONS  MS");
  for (const r of rows) {
    console.log(`${r.name.padEnd(25)} ${r.route.padEnd(17)} ` +
      `${String(r.admittedRight).padEnd(6)} ${String(r.admittedWrong).padEnd(6)} ` +
      `${`${r.abstainedWouldBeRight}/${r.abstainedWouldBeWrong}`.padEnd(10)} ` +
      `${String(r.regions).padEnd(8)} ${r.ms}`);
  }

  const corpus = aggregateExtraction(rows);
  const naConfidence = rows.reduce((s, r) => s + r.naConfidence, 0);
  const gateAdmitted = rows.reduce((s, r) => s + r.gateAdmitted, 0);

  console.log(`\nWRONGLY ADMITTED: ${corpus.admittedWrong} of ${corpus.admitted} answered`);
  console.log(`coverage ${(corpus.coverage * 100).toFixed(1)}%  precision ${(corpus.precision * 100).toFixed(1)}%`);
  console.log(`abstained: ${corpus.abstainedWouldBeRight} would have been right, ` +
    `${corpus.abstainedWouldBeWrong} would have been wrong`);
  console.log(`abstentions by check: ${JSON.stringify(corpus.byCheck)}`);
  console.log(`confidence floor did not run on ${naConfidence} of ${gateAdmitted} gate admissions` +
    `${FLOOR === null ? "" : ` (floor overridden to ${FLOOR})`}`);
  console.log(`identities evaluated: ${JSON.stringify(identityRuns)}`);
  console.log(`\n${rows.length} documents and ${corpus.fields} fields is enough to show a direction ` +
    `and not enough to state a rate.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
