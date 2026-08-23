"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createPipeline } = require("../lib/pipeline");
const { coerce } = require("../lib/schema");

const CORPUS = path.join(__dirname, "..", "fixtures", "corpus");

const template = {
  name: "invoice",
  fields: [
    { key: "vendor", label: "Vendor", type: "string" },
    { key: "total", label: "Total", type: "amount" },
  ],
};

function doubles({ regions = [], raw = { vendor: "Northwind", total: "523,81" }, template: t = template } = {}) {
  const calls = [];
  return {
    calls,
    raster: {
      renderFirstPage: async (f) => { calls.push(`render:${path.basename(f)}`); return { imagePath: "/tmp/page.png" }; },
      readTextGeometry: async (f) => { calls.push(`geometry:${path.basename(f)}`); return { items: regions }; },
    },
    readPage: async (image) => { calls.push(`recognise:${path.basename(image)}`); return { regions }; },
    extractor: {
      fromText: async () => { calls.push("extract:text"); return { ...coerce(t, raw), raw }; },
      fromImage: async () => { calls.push("extract:vision"); return { ...coerce(t, raw), raw }; },
    },
    audit: { record: () => {} },
  };
}

test("a digital PDF takes the text layer and never recognises", async () => {
  const d = doubles({ regions: [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "digital-continental.pdf"));

  assert.equal(out.route, "text");
  assert.ok(d.calls.some((c) => c.startsWith("geometry:")), "the text layer was never read");
  assert.ok(!d.calls.some((c) => c.startsWith("recognise:")),
    "a digital PDF was sent through recognition, which costs sixteen seconds to re-derive what the file states");
  assert.ok(d.calls.includes("extract:text"));
});

test("a photograph recognises and takes the vision path", async () => {
  const d = doubles({ regions: [{ text: "3.014,30", bbox: [1, 1, 2, 2], confidence: 0.9 }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "photo-skewed.png"));

  assert.equal(out.route, "image");
  assert.ok(d.calls.some((c) => c.startsWith("recognise:")));
  assert.ok(d.calls.includes("extract:vision"));
  assert.ok(!d.calls.some((c) => c.startsWith("render:")), "an image was rasterised again");
});

test("a scanned PDF rasterises before it recognises", async () => {
  const d = doubles({ regions: [{ text: "1.432,64", bbox: [1, 1, 2, 2], confidence: 0.9 }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "scan-continental.pdf"));

  assert.equal(out.route, "pdf-needs-render");
  const rendered = d.calls.findIndex((c) => c.startsWith("render:"));
  const recognised = d.calls.findIndex((c) => c.startsWith("recognise:"));
  assert.ok(rendered >= 0 && rendered < recognised, "recognition ran before the page existed");
});

test("an unsupported file is skipped and says why, rather than throwing", async () => {
  const d = doubles();
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "notes.txt"));

  assert.equal(out.skipped, true);
  assert.equal(out.route, "unsupported");
  assert.match(out.reason, /\.txt/);
  assert.deepEqual(d.calls, [], "a file the router rejected still reached a model");
});

test("binding runs before arithmetic, so an unfound value cannot fail an identity", async () => {
  // Measured on a document with no VAT line: asked for a rate, the model invented one, and
  // checking an identity against it implicated a subtotal that is printed and correct.
  const wide = {
    name: "invoice",
    fields: [
      { key: "subtotal", label: "Subtotal", type: "amount" },
      { key: "tax", label: "Tax", type: "amount" },
      { key: "tax_rate", label: "Tax rate", type: "integer" },
    ],
  };
  const d = doubles({
    // The subtotal is on the page; the rate is not.
    regions: [{ text: "432,90", bbox: [1, 1, 2, 2], source: "text-layer" }],
    raw: { subtotal: "432,90", tax: "0", tax_rate: 21 },
    template: wide,
  });
  const pipeline = createPipeline({ ...d, template: wide });

  const out = await pipeline.run(path.join(CORPUS, "digital-absent-vat.pdf"));

  assert.equal(out.fields.subtotal.admitted, true,
    "a value that is printed and correct was implicated by one that was invented");
  assert.equal(out.fields.tax_rate.admitted, false);
  assert.equal(out.fields.tax_rate.check, "binding");
});
