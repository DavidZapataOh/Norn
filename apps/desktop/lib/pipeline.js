"use strict";
const { inspect } = require("./reader");
const { joinSplitNumbers } = require("./geometry");
const { bindAll } = require("./binding");
const { check } = require("./arithmetic");
const { judgeAll } = require("./gate");
const { readPage: defaultReadPage } = require("./recogniser");
const { DEFAULT_TEMPLATE } = require("./schema");

// The rasteriser is the only module that needs Electron, so it arrives as an argument. That
// keeps this file testable in milliseconds and the Electron boundary list at one entry.
function createPipeline({ extractor, audit, raster, readPage = defaultReadPage,
                          template = DEFAULT_TEMPLATE, outDir, thresholds } = {}) {
  const labels = Object.fromEntries(template.fields.map((f) => [f.key, f.label]));

  async function regionsFor(route, filePath) {
    if (route.kind === "text") {
      // A digital PDF already carries its characters and their positions. Recognising it
      // spends seconds re-deriving what the file states, and introduces reading errors the
      // text layer does not have.
      const { items } = await raster.readTextGeometry(filePath);
      return { regions: items, imagePath: null };
    }
    const imagePath = route.kind === "image"
      ? route.imagePath
      : (await raster.renderFirstPage(filePath, { outDir })).imagePath;
    const { regions } = await readPage(imagePath, { audit });
    return { regions: joinSplitNumbers(regions), imagePath };
  }

  return {
    async run(filePath) {
      const started = performance.now();
      const route = await inspect(filePath);
      const routeMs = Math.round(performance.now() - started);

      if (route.kind === "unsupported") {
        return { skipped: true, route: "unsupported", reason: route.reason };
      }

      const beforeRegions = performance.now();
      const { regions, imagePath } = await regionsFor(route, filePath);
      const regionsMs = Math.round(performance.now() - beforeRegions);

      const beforeExtract = performance.now();
      const extracted = route.kind === "text"
        ? await extractor.fromText(route.text)
        : await extractor.fromImage(imagePath);
      const extractMs = Math.round(performance.now() - beforeExtract);

      // Binding first, and it needs nothing from arithmetic. A value the model produced that
      // is not on the page must not be used to check the values that are.
      const bindings = bindAll(extracted.values, regions, { labels });
      const untrusted = new Set(Object.entries(bindings)
        .filter(([, b]) => b.status === "unbound").map(([key]) => key));

      const arithmetic = check(extracted.values, { untrusted });
      const judged = judgeAll(extracted.values, bindings,
        { arithmetic: arithmetic.byField, ...(thresholds ? { thresholds } : {}) });

      return {
        route: route.kind,
        regions: regions.length,
        raw: extracted.raw,
        rejected: extracted.rejected,
        identities: arithmetic.identities,
        ...judged,
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
