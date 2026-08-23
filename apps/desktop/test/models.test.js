"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TEXT_MODELS, VISION_MODELS, OCR_MODELS, loadArgs, assets, catalogue, download } = require("../lib/models");

const registry = {
  QWEN3_4B_INST_Q4_K_M: {
    src: "registry://s3/qwen3-4b.gguf",
    engine: "llamacpp-completion",
    modelId: "Qwen3-4B-Q4_K_M.gguf",
    expectedSize: 2497280256,
    params: "4B",
  },
};
const fakeSdk = async () => registry;

test("a text entry resolves to src, type and a zero reasoning budget", async () => {
  const entry = TEXT_MODELS.find((m) => m.key === "qwen3-4b");
  const args = await loadArgs(entry, { sdk: fakeSdk });

  assert.equal(args.modelSrc, "registry://s3/qwen3-4b.gguf");
  assert.equal(args.modelType, "llamacpp-completion");
  assert.equal(args.modelConfig.reasoning_budget, 0);
  assert.equal(args.modelConfig.projectionModelSrc, undefined);
});

const visionRegistry = {
  QWEN3VL_2B_MULTIMODAL_Q4_K: {
    src: "registry://hf/qwen3vl-2b.gguf",
    engine: "llamacpp-completion",
    modelId: "Qwen3VL-2B-Instruct-Q4_K_M.gguf",
    expectedSize: 1107409952,
  },
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K: {
    src: "registry://hf/qwen3vl-2b.mmproj.gguf",
    engine: "llamacpp-completion",
    modelId: "Qwen3VL-2B.mmproj-Q4_K_M.gguf",
    expectedSize: 441000000,
  },
};

test("a vision entry passes its projector through modelConfig", async () => {
  const entry = VISION_MODELS.find((m) => m.key === "qwen3vl-2b");
  const args = await loadArgs(entry, { sdk: async () => visionRegistry, ctxSize: 8192 });

  assert.equal(args.modelSrc, "registry://hf/qwen3vl-2b.gguf");
  assert.equal(args.modelType, "llamacpp-completion");
  assert.equal(args.modelConfig.projectionModelSrc, "registry://hf/qwen3vl-2b.mmproj.gguf");
  assert.equal(args.modelConfig.ctx_size, 8192);
  assert.equal(args.modelConfig.reasoning_budget, 0);
});

test("a vision entry whose projector is absent names the projector, not the weights", async () => {
  const onlyWeights = { QWEN3VL_2B_MULTIMODAL_Q4_K: visionRegistry.QWEN3VL_2B_MULTIMODAL_Q4_K };
  const entry = VISION_MODELS.find((m) => m.key === "qwen3vl-2b");

  await assert.rejects(
    () => loadArgs(entry, { sdk: async () => onlyWeights }),
    /missing its projector/,
  );
});

test("an entry whose constant is gone is unavailable with a reason", async () => {
  const partial = { QWEN3_4B_INST_Q4_K_M: registry.QWEN3_4B_INST_Q4_K_M };
  const result = await catalogue({ sdk: async () => partial, cacheDir: "/nonexistent" });

  const ok = result.text.find((m) => m.key === "qwen3-4b");
  const gone = result.text.find((m) => m.key === "qwen3-8b");

  assert.equal(ok.available, true);
  assert.equal(ok.bytes, 2497280256);
  assert.equal(gone.available, false);
  assert.match(gone.why, /not in @qvac\/sdk/);
});

test("a vision entry counts as cached only when both files are present", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-cache-"));
  fs.writeFileSync(path.join(dir, "0123456789abcdef_Qwen3VL-2B-Instruct-Q4_K_M.gguf"), "");

  const half = await catalogue({ sdk: async () => visionRegistry, cacheDir: dir });
  assert.equal(half.vision.find((m) => m.key === "qwen3vl-2b").cached, false);

  fs.writeFileSync(path.join(dir, "fedcba9876543210_Qwen3VL-2B.mmproj-Q4_K_M.gguf"), "");
  const full = await catalogue({ sdk: async () => visionRegistry, cacheDir: dir });
  assert.equal(full.vision.find((m) => m.key === "qwen3vl-2b").cached, true);
});

test("download uses assetSrc and reports one monotonic progress track", async () => {
  const calls = [];
  const fakeSdkWithDownload = async () => ({
    ...visionRegistry,
    downloadAsset: async ({ assetSrc, onProgress }) => {
      calls.push(assetSrc);
      onProgress({ percentage: 50 });
      onProgress({ percentage: 100 });
    },
  });

  const seen = [];
  const entry = VISION_MODELS.find((m) => m.key === "qwen3vl-2b");
  const out = await download(entry, (p) => seen.push(p.percentage), { sdk: fakeSdkWithDownload });

  assert.deepEqual(calls, [
    "registry://hf/qwen3vl-2b.gguf",
    "registry://hf/qwen3vl-2b.mmproj.gguf",
  ]);
  assert.equal(out.files, 2);
  assert.equal(out.bytes, 1107409952 + 441000000);

  assert.equal(seen.at(-1), 100);
  assert.equal(seen.filter((p) => p === 100).length, 1, "progress reached 100 more than once");
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `progress went backwards: ${seen[i - 1]} then ${seen[i]}`);
  }
});

const ocrRegistry = {
  OCR_LATIN: { src: "registry://s3/latin_g2.gguf", engine: "ggml-ocr",
               modelId: "latin_g2.gguf", expectedSize: 15396512 },
  OCR_CRAFT: { src: "registry://s3/craft.gguf", engine: "ggml-ocr",
               modelId: "craft.gguf", expectedSize: 83000000 },
};
const fakeOcrSdk = async () => ocrRegistry;

test("an OCR entry resolves without a projector and keeps its engine", async () => {
  const entry = OCR_MODELS.find((m) => m.key === "latin");
  const args = await loadArgs(entry, { sdk: fakeOcrSdk });

  assert.equal(args.modelSrc, "registry://s3/latin_g2.gguf");
  assert.equal(args.modelType, "ggml-ocr");
  assert.equal(args.modelConfig.projectionModelSrc, undefined);
});

test("an OCR entry is not given language-model parameters", async () => {
  // The OCR addon's config schema is non-strict (z.core.$strip), so passing
  // reasoning_budget here would be dropped silently and never surface as an error.
  const entry = OCR_MODELS.find((m) => m.key === "latin");
  const args = await loadArgs(entry, { sdk: fakeOcrSdk });

  assert.equal(args.modelConfig.reasoning_budget, undefined,
    "a language-model parameter reached an OCR model");
});

test("an OCR entry accounts for its detector in size and cache state", async () => {
  // The detector is a separate 83 MB download. Counting only the recogniser would
  // report a model as cached while a file it cannot run without is still missing.
  const entry = OCR_MODELS.find((m) => m.key === "latin");
  const list = await assets(entry, { sdk: fakeOcrSdk });

  assert.equal(list.length, 2, "the detector was not counted as an asset");
  assert.deepEqual(list.map((a) => a.modelId).sort(), ["craft.gguf", "latin_g2.gguf"]);
});
