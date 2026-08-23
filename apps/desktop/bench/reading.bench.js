"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspect } = require("../lib/reader");
const { readPage } = require("../lib/recogniser");
const { joinSplitNumbers } = require("../lib/geometry");
const { createAudit } = require("../lib/audit");
const { scoreRegions, aggregate } = require("./reading-report");
const { launchApp, callInMain } = require("../test/helpers/launch");

const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");
const SWEEP = process.argv.includes("--sweep") ? undefined : [];

// A document routed to the text path produces no geometry, so its values can be scored for
// correctness but never for placement. Conflating the two would report every digital PDF as
// a mislocation and make the localisation figure meaningless.
function scoreTextOnly(expected, text) {
  const flat = text.replace(/\s+/g, " ");
  let correct = 0, missed = 0;
  for (const want of expected) {
    if (flat.includes(want.text)) correct++;
    else missed++;
  }
  return { found: null, correct, mislocated: null, missed };
}

// A region is a correct reading when its characters are on the page, and a misread when
// they are not. Classifying by field match instead would only ever find values in the wrong
// place, never the confident nonsense that the abstention gate exists to catch.
const normalise = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");

function splitConfidences(pageText, regions) {
  const page = normalise(pageText);
  const correct = [], incorrect = [];
  for (const r of regions) {
    if (typeof r.confidence !== "number") continue;
    const n = normalise(r.text);
    if (!n) continue;
    (page.includes(n) ? correct : incorrect).push(Number(r.confidence.toFixed(3)));
  }
  return { correct, incorrect };
}

async function main() {
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));
  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-reading", "inference.jsonl") });
  const session = await launchApp();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-reading-"));

  const rows = [];
  try {
    for (const name of Object.keys(truth).sort()) {
      const doc = truth[name];
      const file = path.join(CORPUS, name);
      const t0 = performance.now();

      const route = await inspect(file);
      const routeMs = Math.round(performance.now() - t0);
      if (route.kind === "unsupported") {
        rows.push({ name, route: route.kind, skipped: true });
        continue;
      }

      let imagePath = route.kind === "image" ? route.imagePath : null;
      let renderMs = 0;
      if (route.kind === "pdf-needs-render") {
        const t1 = performance.now();
        const r = await callInMain(session, "raster.js", "renderFirstPage", [file, { outDir }]);
        imagePath = r.imagePath;
        renderMs = Math.round(performance.now() - t1);
      }

      let scored, readMs = 0, confidences = { correct: [], incorrect: [] }, regionCount = null;
      if (route.kind === "text") {
        scored = scoreTextOnly(doc.fields, route.text);
      } else {
        const t2 = performance.now();
        const out = await readPage(imagePath, { audit, rotations: SWEEP });
        readMs = Math.round(performance.now() - t2);
        const regions = joinSplitNumbers(out.regions);
        regionCount = regions.length;
        scored = scoreRegions(doc.fields, regions);
        confidences = splitConfidences(doc.page_text, regions);
      }

      rows.push({
        name, route: route.kind, classes: doc.classes.join(","), regions: regionCount,
        routeMs, renderMs, readMs, totalMs: Math.round(performance.now() - t0),
        fields: doc.fields.length, ...scored, confidences,
      });
    }
  } finally {
    await session.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const scoredRows = rows.filter((r) => !r.skipped);
  console.log("\nDOCUMENT                  ROUTE             OK/MISL/MISS  REGIONS  ROUTE  RENDER  READ");
  for (const r of scoredRows) {
    console.log(
      `${r.name.padEnd(25)} ${r.route.padEnd(17)} ` +
      `${`${r.correct}/${r.mislocated ?? "-"}/${r.missed}`.padEnd(13)} ` +
      `${String(r.regions ?? "-").padEnd(8)} ${String(r.routeMs + "ms").padEnd(6)} ` +
      `${String(r.renderMs + "ms").padEnd(7)} ${r.readMs}ms`,
    );
  }
  for (const r of rows.filter((x) => x.skipped)) console.log(`${r.name.padEnd(25)} skipped (${r.route})`);

  const corpus = aggregate(scoredRows);
  const fields = scoredRows.reduce((s, r) => s + r.fields, 0);
  const pixel = scoredRows.filter((r) => r.route !== "text").length;

  console.log(`\nfields: ${fields} across ${scoredRows.length} documents`);
  console.log(`correct ${corpus.correct}  mislocated ${corpus.mislocated}  missed ${corpus.missed}`);
  console.log(`routing: ${scoredRows.length - pixel}/${scoredRows.length} documents never touched the pixel path`);
  console.log(`sweep: ${SWEEP === undefined ? "on" : "off"}`);

  const c = corpus.confidence;
  console.log(`\nconfidence, correct   n=${c.correct.n} min=${c.correct.min} max=${c.correct.max}`);
  console.log(`confidence, incorrect n=${c.incorrect.n} min=${c.incorrect.min} max=${c.incorrect.max}`);
  if (c.separable === false) {
    console.log(`\nNo single confidence threshold separates correct readings from incorrect ones: ` +
      `a wrong reading scored ${c.incorrect.max} while a correct one scored ${c.correct.min}.`);
  } else if (c.separable === true) {
    console.log(`\nConfidence separated correct from incorrect on this corpus.`);
  } else {
    console.log(`\nConfidence separability is undetermined: one of the two sets is empty.`);
  }

  console.log(`\n${scoredRows.length} documents is enough to show a direction and not enough to state a rate.`);
  console.log(`log: ${audit.logPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
