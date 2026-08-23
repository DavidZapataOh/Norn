"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { inspect } = require("../lib/reader");

const DOCS = path.join(__dirname, "..", "fixtures", "docs");

test("an image routes straight to the pixel path", async () => {
  const out = await inspect(path.join(DOCS, "receipt-photo.png"));

  assert.equal(out.kind, "image");
  assert.equal(out.signal, "image");
  assert.ok(out.imagePath.endsWith("receipt-photo.png"));
});

test("a file that does not exist is unsupported, not an exception", async () => {
  const out = await inspect(path.join(DOCS, "nothing-here.pdf"));

  assert.equal(out.kind, "unsupported");
  assert.match(out.reason, /not found/);
});

test("an unknown extension is unsupported and names the extension", async () => {
  const out = await inspect(path.join(DOCS, "notes.txt"));

  assert.equal(out.kind, "unsupported");
  assert.match(out.reason, /\.txt/);
});

test("a digital PDF routes to the text path with its text", async () => {
  const out = await inspect(path.join(DOCS, "invoice-digital.pdf"));

  assert.equal(out.kind, "text");
  assert.equal(out.signal, "pdf-text");
  assert.match(out.text, /INVOICE/i);
  assert.ok(out.text.length >= 120, `expected a real text layer, got ${out.text.length} chars`);
});

test("the same PDF parses identically on repeated reads", async () => {
  // Node allocates small Buffers from a shared pool and pdf.js reads past the view,
  // so a pooled Buffer makes the same file parse differently between runs.
  const reads = [];
  for (let i = 0; i < 5; i++) {
    reads.push((await inspect(path.join(DOCS, "invoice-digital.pdf"))).text);
  }
  assert.ok(reads[0] && reads[0].length > 0, "no text was read, so sameness proves nothing");
  assert.equal(new Set(reads).size, 1, "parsing is not deterministic across reads");
});

test("a scanned PDF is routed to render, with a reason", async () => {
  const out = await inspect(path.join(DOCS, "invoice-scanned.pdf"));

  assert.equal(out.kind, "pdf-needs-render");
  assert.equal(out.signal, "pdf-scan");
  assert.ok(out.filePath.endsWith("invoice-scanned.pdf"));
  assert.match(out.reason, /characters|treating it as a scan/);
});

test("a text-poor PDF is treated as a scan rather than trusted", async () => {
  const out = await inspect(path.join(DOCS, "invoice-textpoor.pdf"));

  assert.equal(out.kind, "pdf-needs-render");
  assert.match(out.reason, /only \d+ characters/);
});

test("a corrupt PDF routes to render instead of throwing", async () => {
  const out = await inspect(path.join(DOCS, "invoice-corrupt.pdf"));

  assert.equal(out.kind, "pdf-needs-render");
  assert.match(out.reason, /text extraction failed/);
});

test("an oversized PDF routes to render and names the size", async () => {
  const out = await inspect(path.join(DOCS, "invoice-huge.pdf"));

  assert.equal(out.kind, "pdf-needs-render");
  assert.match(out.reason, /too large to parse safely/);
});

test("no fixture makes the router throw", async () => {
  for (const name of fs.readdirSync(DOCS)) {
    const out = await inspect(path.join(DOCS, name));
    assert.ok(
      ["text", "image", "pdf-needs-render", "unsupported"].includes(out.kind),
      `${name} produced an unknown outcome: ${JSON.stringify(out)}`,
    );
  }
});
