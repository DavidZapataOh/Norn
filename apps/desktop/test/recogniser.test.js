"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readPage } = require("../lib/recogniser");

const ocrRegistry = {
  OCR_LATIN: { src: "registry://s3/latin_g2.gguf", engine: "ggml-ocr",
               modelId: "latin_g2.gguf", expectedSize: 15396512 },
  OCR_CRAFT: { src: "registry://s3/craft.gguf", engine: "ggml-ocr",
               modelId: "craft.gguf", expectedSize: 83000000 },
};
const sdk = async () => ocrRegistry;

function fakeAudit({ blocks, onUnload = () => {}, onLoad = () => {}, throwOnOcr = null }) {
  return {
    auditLoadModel: async (args) => { onLoad(args); return "ocr-model-1"; },
    auditOcr: async () => {
      if (throwOnOcr) throw throwOnOcr;
      return { blocks, stats: { detectionTime: 18.2, recognitionTime: 2.0, totalTime: 20.2 } };
    },
    auditUnloadModel: async (id) => { onUnload(id); },
  };
}

test("regions keep their text, box and confidence", async () => {
  const blocks = [
    { text: "ACME CORP S.A", bbox: [101, 60, 468, 124], confidence: 0.958 },
    { text: "ARS 2.831,40", bbox: [824, 591, 1022, 635], confidence: 1.0 },
  ];

  const out = await readPage("/page.png", { audit: fakeAudit({ blocks }), sdk });

  assert.equal(out.regions.length, 2);
  assert.deepEqual(out.regions[0].bbox, [101, 60, 468, 124]);
  assert.equal(out.regions[0].confidence, 0.958);
  assert.equal(out.regions[1].text, "ARS 2.831,40");
});

test("a read that throws still unloads the model", async () => {
  const unloaded = [];
  const audit = fakeAudit({
    blocks: [],
    onUnload: (id) => unloaded.push(id),
    throwOnOcr: new Error("recognition failed"),
  });

  await assert.rejects(() => readPage("/page.png", { audit, sdk }), /recognition failed/);
  assert.deepEqual(unloaded, ["ocr-model-1"], "the model was left resident");
});

test("a region without geometry is kept and marked, not dropped", async () => {
  const blocks = [
    { text: "with box", bbox: [1, 2, 3, 4], confidence: 0.9 },
    { text: "no box", confidence: 0.7 },
  ];

  const out = await readPage("/page.png", { audit: fakeAudit({ blocks }), sdk });

  assert.equal(out.regions.length, 2, "a region was dropped for lacking a box");
  assert.equal(out.regions[1].bbox, undefined, "a box was fabricated");
});

test("the load carries the OCR configuration and no language-model parameter", async () => {
  let loaded = null;
  const audit = fakeAudit({ blocks: [], onLoad: (args) => { loaded = args; } });

  await readPage("/page.png", { audit, sdk, rotations: [90], languages: ["es"] });

  assert.equal(loaded.modelType, "ggml-ocr");
  assert.deepEqual(loaded.modelConfig.defaultRotationAngles, [90]);
  assert.deepEqual(loaded.modelConfig.langList, ["es"]);
  assert.equal(loaded.modelConfig.contrastRetry, true);
  assert.equal(loaded.modelConfig.reasoning_budget, undefined,
    "a language-model parameter reached the OCR load");
});

test("the rotation sweep is off by default", async () => {
  let loaded = null;
  const audit = fakeAudit({ blocks: [], onLoad: (args) => { loaded = args; } });

  await readPage("/page.png", { audit, sdk });

  assert.deepEqual(loaded.modelConfig.defaultRotationAngles, [],
    "quarter-turn rotations are on by default, which measurably costs accuracy");
});
