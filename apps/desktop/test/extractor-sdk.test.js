"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { createExtractor } = require("../lib/extractor");
const { parseAmount } = require("../lib/money");
const { inspect } = require("../lib/reader");

const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");
const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, "truth.json"), "utf8"));
const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-extract-test", "inference.jsonl") });

test("a digital PDF extracts to schema-valid values through the text path", async () => {
  const extractor = createExtractor({ audit });
  try {
    const route = await inspect(path.join(CORPUS, "digital-continental.pdf"));
    assert.equal(route.kind, "text");

    const out = await extractor.fromText(route.text);
    const want = truth["digital-continental.pdf"].fields.find((f) => f.field === "total");

    assert.deepEqual(out.rejected, [], "the model returned something the schema could not take");
    assert.equal(out.values.total.value, parseAmount(want.text).minor,
      `total came back as ${JSON.stringify(out.raw.total)}`);
  } finally {
    await extractor.unload();
  }
});

test("structured output survives the vision path", async () => {
  const extractor = createExtractor({ audit });
  try {
    const out = await extractor.fromImage(path.join(CORPUS, "photo-skewed.png"));
    const want = truth["photo-skewed.png"].fields.find((f) => f.field === "total");

    // The claim under test is that the grammar holds with an image attached, not that a
    // 2B vision model reads a skewed photograph correctly. Shape is asserted; the value is
    // reported either way and its accuracy is the next plan's measurement.
    assert.equal(typeof out.raw, "object");
    assert.ok("total" in out.raw, "the grammar did not hold on the vision path");
    console.log(`  vision total: ${JSON.stringify(out.raw.total)}, expected ${want.text}`);
  } finally {
    await extractor.unload();
  }
});
