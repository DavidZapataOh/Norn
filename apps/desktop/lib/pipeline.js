"use strict";
const { inspect } = require("./reader");
const { joinSplitNumbers } = require("./geometry");
const { bindAll } = require("./binding");
const { check } = require("./arithmetic");
const { judgeAll } = require("./gate");
const { readPage: defaultReadPage } = require("./recogniser");
const { DEFAULT_TEMPLATE } = require("./schema");
const { createTrace } = require("./trace");
const { canonical } = require("./canonical");
const { digestOf } = require("./digest");

// The rasteriser is the only module that needs Electron, so it arrives as an argument. That
// keeps this file testable in milliseconds and the Electron boundary list at one entry.
function createPipeline({ extractor, audit, raster, readPage = defaultReadPage,
                          template = DEFAULT_TEMPLATE, outDir, thresholds } = {}) {
  const labels = Object.fromEntries(template.fields.map((f) => [f.key, f.label]));

  async function regionsFor(route, filePath, note) {
    if (route.kind === "text") {
      // A digital PDF already carries its characters and their positions. Recognising it
      // spends seconds re-deriving what the file states, and introduces reading errors the
      // text layer does not have.
      const { items } = await raster.readTextGeometry(filePath);
      note("geometry", "readTextGeometry", ["document.bytes"], "document.regions", items);
      return { regions: items, imagePath: null };
    }

    let imagePath = route.imagePath;
    if (route.kind !== "image") {
      imagePath = (await raster.renderFirstPage(filePath, { outDir })).imagePath;
      note("render", "renderFirstPage", ["document.bytes"], "document.page", { rendered: true });
    }

    const { regions } = await readPage(imagePath, { audit });
    const joined = joinSplitNumbers(regions);
    note("recognise", "readPage", ["document.page"], "document.regions", joined);
    return { regions: joined, imagePath };
  }

  return {
    async run(filePath) {
      const started = performance.now();
      const trace = createTrace();
      // The digest of what the stage produced, never the thing itself. The trace commits to
      // each stage's output without carrying it, which is what lets the certificate go to
      // someone entitled to check the process but not the figures.
      const note = (stage, action, reads, writes, produced) =>
        trace.append({ stage, action, reads, writes, digest: digestOf(canonical(produced)) });

      const route = await inspect(filePath);
      const routeMs = Math.round(performance.now() - started);
      note("route", route.kind, ["document.bytes"], "document.route",
           { kind: route.kind, reason: route.reason ?? null });

      if (route.kind === "unsupported") {
        return { skipped: true, route: "unsupported", reason: route.reason };
      }

      const beforeRegions = performance.now();
      const { regions, imagePath } = await regionsFor(route, filePath, note);
      const regionsMs = Math.round(performance.now() - beforeRegions);

      const beforeExtract = performance.now();
      const extracted = route.kind === "text"
        ? await extractor.fromText(route.text)
        : await extractor.fromImage(imagePath);
      const extractMs = Math.round(performance.now() - beforeExtract);
      note("extract", route.kind === "text" ? "fromText" : "fromImage",
           ["document.regions"], "document.values", extracted.raw);

      // Binding first, and it needs nothing from arithmetic. A value the model produced that
      // is not on the page must not be used to check the values that are.
      const bindings = bindAll(extracted.values, regions, { labels });
      const untrusted = new Set(Object.entries(bindings)
        .filter(([, b]) => b.status === "unbound").map(([key]) => key));
      // Status per field, not the boxes. A bounding box is a position on the page, and a
      // position is close enough to a figure to be worth withholding from a shareable record.
      note("bind", "bindAll", ["document.values", "document.regions"], "document.bindings",
           Object.fromEntries(Object.entries(bindings).map(([k, b]) => [k, b.status])));

      const arithmetic = check(extracted.values, { untrusted });
      note("arithmetic", "check", ["document.values"], "document.identities",
           arithmetic.identities);

      const judged = judgeAll(extracted.values, bindings,
        { arithmetic: arithmetic.byField, ...(thresholds ? { thresholds } : {}) });
      note("gate", "judgeAll", ["document.values", "document.bindings", "document.identities"],
           "document.fields",
           Object.fromEntries(Object.entries(judged.fields)
             .map(([k, f]) => [k, f.admitted ? "admitted" : f.check])));

      return {
        route: route.kind,
        regions: regions.length,
        raw: extracted.raw,
        rejected: extracted.rejected,
        identities: arithmetic.identities,
        ...judged,
        trace: { root: trace.root(), records: trace.records() },
        timings: {
          routeMs,
          geometryMs: route.kind === "text" ? regionsMs : 0,
          recogniseMs: route.kind === "text" ? 0 : regionsMs,
          extractMs,
          totalMs: Math.round(performance.now() - started),
        },
      };
    },
  };
}

module.exports = { createPipeline };
