"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TEXT_MODELS, VISION_MODELS, OCR_MODELS, loadArgs, assets } = require("../lib/models");

test("every catalogued constant exists in the installed SDK", async () => {
  for (const entry of [...TEXT_MODELS, ...VISION_MODELS, ...OCR_MODELS]) {
    const args = await loadArgs(entry);
    assert.equal(typeof args.modelSrc, "string", `${entry.label} has no src`);
    assert.equal(typeof args.modelType, "string", `${entry.label} has no engine`);
    if (entry.projName) {
      assert.equal(typeof args.modelConfig.projectionModelSrc, "string",
        `${entry.label} has no projector`);
    }
  }
});

test("the OCR detector exists in the installed SDK", async () => {
  for (const entry of OCR_MODELS) {
    const list = await assets(entry);
    assert.equal(list.length, 2, `${entry.label} did not resolve both recogniser and detector`);
    for (const a of list) assert.equal(typeof a.src, "string", `${entry.label} asset has no src`);
  }
});
