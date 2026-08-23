"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { readPage } = require("../lib/recogniser");
const { launchApp, callInMain } = require("../test/helpers/launch");

const PDF = path.join(__dirname, "..", "fixtures", "docs", "invoice-scanned.pdf");
const SCALES = [1, 2, 3];
// Cases can be selected from the command line so a single comparison can be re-run without
// paying for the whole table. Every conclusion below is drawn within one invocation.
const ONLY = process.argv.slice(2);
const wanted = (name) => !ONLY.length || ONLY.includes(String(name));

// The fixture's own text, so "correct" means the region matches what was printed rather
// than what a second recogniser thinks was printed. This is a proxy: a region counts as
// correct when its normalised text appears in the normalised page, which forgives word
// order and punishes nothing but invented characters.
const TRUTH = [
  "INVOICE", "Northwind Paper Supply SL", "Calle Mayor 14, 28013 Madrid",
  "VAT ID: ES-X0000000X (fake)", "Bill to: Acme Robotics GmbH", "Invoice no. NW-2024-0117",
  "Issue date: 14 March 2024", "Due date: 13 April 2024",
  "Description Qty Unit Amount", "A4 copier paper, 80 g/m2 40 8.20 328.00",
  "Recycled card stock, A3 12 6.75 81.00", "Delivery, next day 1 23.90 23.90",
  "Subtotal 432.90", "VAT 21% 90.91", "Total due 523.81",
  "Payment to IBAN ES00 0000 0000 0000 0000 0000 (fake)",
].join(" ");

const normalise = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
const TRUTH_N = normalise(TRUTH);

const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

async function renderScales() {
  if (!SCALES.some(wanted)) return {};
  const session = await launchApp();
  try {
    const out = {};
    for (const scale of SCALES.filter(wanted)) {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-recbench-"));
      out[scale] = await callInMain(session, "raster.js", "renderFirstPage", [PDF, { scale, outDir }]);
    }
    return out;
  } finally {
    await session.close();
  }
}

function score(regions) {
  const correct = [], wrong = [];
  for (const r of regions) {
    const n = normalise(r.text);
    if (!n) continue;
    (TRUTH_N.includes(n) ? correct : wrong).push(r.confidence ?? null);
  }
  const ok = correct.filter((c) => c !== null);
  const bad = wrong.filter((c) => c !== null);
  // Medians hide the only question that matters downstream: is there a threshold that
  // admits every correct reading and rejects every wrong one? That needs the extremes.
  return {
    ok: correct.length, wrong: wrong.length,
    minOk: ok.length ? r3(Math.min(...ok)) : null,
    maxWrong: bad.length ? r3(Math.max(...bad)) : null,
    separable: ok.length && bad.length ? Math.min(...ok) > Math.max(...bad) : null,
  };
}

(async () => {
  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-recbench", "inference.jsonl") });
  const rendered = await renderScales();
  const docs = path.join(__dirname, "..", "fixtures", "docs");
  rendered.photo = { imagePath: path.join(docs, "receipt-photo.png"), width: 900, height: 1400 };
  // The sweep is a set of quarter turns, so a page skewed by two degrees cannot show what
  // it is for. Only a page fed in sideways can.
  rendered.sideways = { imagePath: path.join(docs, "receipt-sideways.png"), width: 1400, height: 900 };

  console.log("CASE     SWEEP  DIMS         REGIONS  DETECT   RECOG    OK/WRONG  MIN-OK  MAX-WRONG  SEPARABLE");
  const rows = [];
  for (const scale of [...SCALES, "photo", "sideways"].filter(wanted)) {
    const { imagePath, width, height } = rendered[scale];
    for (const sweep of [true, false]) {
      const t0 = performance.now();
      const out = await readPage(imagePath, { audit, rotations: sweep ? undefined : [] });
      const wall = Math.round(performance.now() - t0);
      const sc = score(out.regions);
      const st = out.timings || {};
      const row = {
        scale, sweep, dims: `${width}x${height}`, regions: out.regions.length, wall,
        detect: st.detectionTime !== undefined ? Math.round(st.detectionTime * 1000) : null,
        recog: st.recognitionTime !== undefined ? Math.round(st.recognitionTime * 1000) : null,
        ...sc,
      };
      rows.push(row);
      console.log(
        `${String(scale).padEnd(8)} ${(sweep ? "on" : "off").padEnd(6)} ${row.dims.padEnd(12)} ` +
        `${String(row.regions).padEnd(8)} ${String(row.detect + "ms").padEnd(8)} ` +
        `${String(row.recog + "ms").padEnd(8)} ${(row.ok + "/" + row.wrong).padEnd(9)} ` +
        `${String(row.minOk ?? "-").padEnd(7)} ${String(row.maxWrong ?? "-").padEnd(10)} ` +
        `${row.separable === null ? "-" : row.separable}`,
      );
    }
  }

  const overlapping = rows.filter((r) => r.separable === false);
  console.log(overlapping.length
    ? `\nConfidence does not separate correct from incorrect in ${overlapping.length}/${rows.length} configurations:\n  ` +
      overlapping.map((r) => `${r.scale} sweep ${r.sweep ? "on" : "off"}: a wrong reading scored ${r.maxWrong} while a correct one scored ${r.minOk}`).join("\n  ")
    : "\nConfidence separated correct from incorrect in every configuration.");
})();
