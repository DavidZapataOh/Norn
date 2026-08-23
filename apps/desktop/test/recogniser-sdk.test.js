"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { readPage } = require("../lib/recogniser");

const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-ocr-test", "inference.jsonl") });
const PAGE = path.join(__dirname, "..", "fixtures", "docs", "receipt-photo.png");

test("a real page yields regions with boxes and confidences", async () => {
  const out = await readPage(PAGE, { audit });

  assert.ok(out.regions.length > 5, `expected several regions, got ${out.regions.length}`);
  const placed = out.regions.filter((r) => Array.isArray(r.bbox) && r.bbox.length === 4);
  assert.ok(placed.length >= out.regions.length * 0.8, "most regions should carry a box");
  for (const r of placed) {
    assert.ok(r.bbox[2] > r.bbox[0] && r.bbox[3] > r.bbox[1], `degenerate box ${JSON.stringify(r.bbox)}`);
    assert.ok(r.confidence >= 0 && r.confidence <= 1, `confidence out of range: ${r.confidence}`);
  }
});
