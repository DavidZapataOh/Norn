"use strict";
const fs = require("node:fs");
const path = require("node:path");

// One named mutation each, applied to one clean certificate, so a fixture's difference from
// the clean one is exactly the thing under test. A fixture written by hand differs in whatever
// the author happened to type, and a test naming the catching step might then be passing
// because of a stray edit.
//
// caughtBy is declared here rather than read back from the verifier, which would agree with
// itself no matter which step fired.
//
// Where the only thing that can catch a mutation is the signature, `why` says so. That is the
// honest half of this exercise: a confidence, a region and a seed are all internally consistent
// after editing, and nothing in the document contradicts them.
const TAMPERS = [
  {
    name: "an altered total",
    caughtBy: "arithmetic",
    apply: (c) => { c.fields.total.minor = "62381"; return c; },
  },
  {
    name: "an abstention removed",
    caughtBy: "sections",
    apply: (c) => { c.abstentions = []; return c; },
  },
  {
    name: "a trace record reordered",
    caughtBy: "trace",
    apply: (c) => { c.trace.records.reverse(); return c; },
  },
  {
    name: "an altered confidence",
    caughtBy: "signature",
    why: "a confidence is a number the document asserts about itself. Nothing else in the " +
      "certificate contradicts a different one, and the page cannot be consulted for it.",
    apply: (c) => { c.fields.tax.confidence = 0.99; return c; },
  },
  {
    name: "a moved region",
    caughtBy: "signature",
    why: "a box is only contradicted by the page it points at, which the provenance step " +
      "needs the document for and a reader has to check by eye.",
    apply: (c) => { c.fields.total.bbox = [0, 0, 10, 10]; return c; },
  },
  {
    name: "an altered seed",
    caughtBy: "signature",
    why: "nothing in the certificate depends on the seed. Only replay would notice, and " +
      "only by producing a different document.",
    apply: (c) => { c.replay.seed = 1; return c; },
  },
  {
    name: "the signature removed",
    caughtBy: "signature",
    why: "with no signature there is nothing to check the envelope against, which is the " +
      "state every other signature-only mutation reduces to.",
    apply: (c) => { delete c.signature; return c; },
  },
];

// A mutation that changes nothing is not a fixture. Found on a real corpus certificate whose
// document had no abstentions: emptying the array was a no-op, and the fixture sat in the set
// passing its test while proving nothing. A fixture that cannot fail is worse than a missing
// one, because the set looks complete.
function applyTamper(tamper, certificate) {
  const before = JSON.stringify(certificate);
  const after = tamper.apply(structuredClone(certificate));
  if (JSON.stringify(after) === before) {
    throw new Error(`"${tamper.name}" changes nothing on this certificate, so the fixture ` +
      "would prove nothing; pick a document the mutation applies to");
  }
  return after;
}

function main(argv) {
  const outDir = argv[argv.length - 1];
  const sources = argv.slice(0, -1);
  if (sources.length === 0 || !outDir) {
    console.error("usage: make-tampered.js <clean.json>... <out-dir>");
    return 2;
  }

  const clean = sources.map((file) => ({ file, certificate: JSON.parse(fs.readFileSync(file, "utf8")) }));
  fs.mkdirSync(outDir, { recursive: true });

  const unplaceable = [];
  for (const tamper of TAMPERS) {
    const name = tamper.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

    // Each mutation goes on the first supplied certificate it actually changes. No single
    // corpus document has both an admitted total and an abstention -- the one that abstains
    // is the one whose amounts failed arithmetic -- so a fixture set built from one document
    // would silently contain mutations that do nothing.
    let placed = null;
    for (const source of clean) {
      try {
        placed = { source, tampered: applyTamper(tamper, source.certificate) };
        break;
      } catch { /* try the next certificate */ }
    }

    if (!placed) {
      unplaceable.push(name);
      console.error(`${name.padEnd(28)} NOT PLACED -- no supplied certificate this changes`);
      continue;
    }

    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(placed.tampered, null, 2));
    console.log(`${name.padEnd(28)} expects ${tamper.caughtBy.padEnd(11)} ` +
      `from ${path.basename(placed.source.file)}`);
  }

  if (unplaceable.length) {
    console.error(`\n${unplaceable.length} mutation(s) could not be placed. A fixture set with ` +
      "a hole in it looks complete and is not; supply a certificate each one applies to.");
    return 2;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { TAMPERS, applyTamper };
