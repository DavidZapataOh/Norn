"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sdk: defaultSdk } = require("./sdk");

const CACHE_DIR = path.join(os.homedir(), ".qvac", "models");

const TEXT_MODELS = [
  { key: "qwen3-1.7b", label: "Qwen3 1.7B", constName: "QWEN3_1_7B_INST_Q4" },
  { key: "qwen3-4b", label: "Qwen3 4B", constName: "QWEN3_4B_INST_Q4_K_M" },
  { key: "qwen3-8b", label: "Qwen3 8B", constName: "QWEN3_8B_INST_Q4_K_M" },
];

const VISION_MODELS = [
  { key: "qwen3vl-2b", label: "Qwen3-VL 2B",
    constName: "QWEN3VL_2B_MULTIMODAL_Q4_K", projName: "MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K" },
  { key: "qwen3.5-4b", label: "Qwen3.5-VL 4B",
    constName: "QWEN3_5_4B_MULTIMODAL_Q4_K_M", projName: "MMPROJ_QWEN3_5_4B_MULTIMODAL_F16" },
];

async function loadArgs(entry, { sdk = defaultSdk, ctxSize = 8192 } = {}) {
  const S = await sdk();
  const weights = S[entry.constName];
  if (!weights) throw new Error(`${entry.label} is not available in this SDK version`);

  // A load-time parameter. Without it the Qwen3.5 family emits a <think> block
  // before the JSON even under a grammar. Harmless on models that do not reason.
  const modelConfig = { reasoning_budget: 0 };

  if (!entry.projName) {
    return { modelSrc: weights.src, modelType: weights.engine, modelConfig };
  }

  // A vision model is two files. The projector goes through modelConfig, and
  // omitting it fails validation with a message that reads like a bad path.
  const projector = S[entry.projName];
  if (!projector) throw new Error(`${entry.label} is missing its projector in this SDK version`);

  return {
    modelSrc: weights.src,
    modelType: weights.engine,
    modelConfig: { ...modelConfig, device: "gpu", projectionModelSrc: projector.src, ctx_size: ctxSize },
  };
}

// The registry stores each blob as "<16 hex>_<modelId>". Reading names is enough to
// paint a dropdown; asking the SDK to verify would read gigabytes to draw a tick.
function cachedIds({ cacheDir = CACHE_DIR } = {}) {
  try {
    return new Set(fs.readdirSync(cacheDir).map((f) => f.replace(/^[0-9a-f]{16}_/, "")));
  } catch {
    return new Set();   // no cache directory yet, which is the correct answer
  }
}

async function catalogue({ sdk = defaultSdk, cacheDir = CACHE_DIR } = {}) {
  const S = await sdk();
  const present = cachedIds({ cacheDir });

  const describe = (entry) => {
    const weights = S[entry.constName];
    const projector = entry.projName ? S[entry.projName] : null;
    if (!weights || (entry.projName && !projector)) {
      // A settings pane must degrade one row, not blank the window.
      return { ...entry, available: false, cached: false, bytes: 0, why: "not in @qvac/sdk" };
    }
    const bytes = (weights.expectedSize || 0) + (projector?.expectedSize || 0);
    const cached = present.has(weights.modelId) && (!projector || present.has(projector.modelId));
    return { ...entry, available: true, cached, bytes };
  };

  return {
    text: TEXT_MODELS.map(describe),
    vision: VISION_MODELS.map(describe),
    defaults: { text: "qwen3-4b", vision: "qwen3vl-2b" },
  };
}

async function assets(entry, { sdk = defaultSdk } = {}) {
  const S = await sdk();
  return [entry.constName, entry.projName].filter(Boolean).map((n) => S[n]).filter(Boolean);
}

// Progress is reported across the pair, not per file: two bars that each reach 100%
// read as a bug.
async function download(entry, onProgress, { sdk = defaultSdk } = {}) {
  const S = await sdk();
  const list = await assets(entry, { sdk });
  if (!list.length) throw new Error(`${entry.label} is not available in this SDK version`);

  const sizes = list.map((a) => a.expectedSize || 0);
  const grand = sizes.reduce((x, y) => x + y, 0);
  const done = list.map(() => 0);

  for (let i = 0; i < list.length; i++) {
    // The SDK calls this assetSrc, not modelSrc. The wrong key fails validation
    // with "Invalid input at assetSrc", which reads like a bad URL.
    await S.downloadAsset({
      assetSrc: list[i].src,
      onProgress: (p) => {
        if (!p || typeof p.percentage !== "number") return;
        done[i] = (sizes[i] * p.percentage) / 100;
        const sum = done.reduce((x, y) => x + y, 0);
        onProgress?.({
          model: entry.label,
          percentage: grand ? Math.min(100, (sum / grand) * 100) : p.percentage,
          downloaded: sum,
          total: grand,
          file: i + 1,
          files: list.length,
        });
      },
    });
    done[i] = sizes[i];
  }

  return { bytes: grand, files: list.length };
}

module.exports = {
  TEXT_MODELS, VISION_MODELS, loadArgs, cachedIds, catalogue, assets, download, CACHE_DIR,
};
