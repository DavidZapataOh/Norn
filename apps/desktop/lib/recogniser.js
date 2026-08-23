"use strict";
const { OCR_MODELS, loadArgs } = require("./models");

const DEFAULT = "latin";

// No quarter-turn sweep by default. Measured across five pages, trying each region at 90,
// 180 and 270 degrees never improved a reading and cost two to five times the recognition
// time. On a page fed in sideways -- the case it exists for -- it was materially worse:
// 26 regions right and 20 wrong, against 30 right and 9 wrong with it off, because more
// candidate orientations produce more confident nonsense. Callers can still pass angles.
const NO_SWEEP = [];

async function readPage(imagePath, {
  audit,
  sdk,
  rotations = NO_SWEEP,
  languages = ["en"],
  key = DEFAULT,
} = {}) {
  const entry = OCR_MODELS.find((m) => m.key === key);
  if (!entry) throw new Error(`unknown recogniser "${key}"`);

  const args = await loadArgs(entry, sdk ? { sdk } : {});
  const modelId = await audit.auditLoadModel({
    ...args,
    modelConfig: {
      ...args.modelConfig,
      langList: languages,
      magRatio: 1.5,
      defaultRotationAngles: rotations,
      contrastRetry: true,
      lowConfidenceThreshold: 0.5,
      recognizerBatchSize: 1,
    },
  }, { model: entry.constName });

  try {
    const { blocks, stats } = await audit.auditOcr(
      { modelId, image: imagePath, options: { paragraph: false } },
      { model: entry.constName },
    );
    // Geometry and confidence pass through untouched. Flattening to a string here is the
    // conventional next line and it permanently destroys the link between a value and a
    // mark on the page, because geometry cannot be recovered downstream.
    return { regions: blocks, timings: stats };
  } finally {
    // A throw that skips the unload leaves the model resident while the busy flag
    // releases, and the next operation runs against a leaked model.
    await audit.auditUnloadModel(modelId, { model: entry.constName });
  }
}

module.exports = { readPage, DEFAULT };
