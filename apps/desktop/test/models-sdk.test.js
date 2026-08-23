"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TEXT_MODELS, VISION_MODELS, loadArgs } = require("../lib/models");

test("every catalogued constant exists in the installed SDK", async () => {
  for (const entry of [...TEXT_MODELS, ...VISION_MODELS]) {
    const args = await loadArgs(entry);
    assert.equal(typeof args.modelSrc, "string", `${entry.label} has no src`);
    assert.equal(typeof args.modelType, "string", `${entry.label} has no engine`);
    if (entry.projName) {
      assert.equal(typeof args.modelConfig.projectionModelSrc, "string",
        `${entry.label} has no projector`);
    }
  }
});
