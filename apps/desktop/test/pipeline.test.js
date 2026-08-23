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

test("a run traces every stage it has, in the order it ran them", async () => {
  // A trace that starts after the document was read cannot describe how the document was
  // read, and routing decides which mechanism read it.
  const d = doubles({ regions: [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "digital-continental.pdf"));

  assert.deepEqual(out.trace.records.map((r) => r.stage),
    ["route", "geometry", "extract", "bind", "arithmetic", "gate"]);
  assert.equal(out.trace.root.length, 64);
});

test("the recognition path traces recognition where the text path traces geometry", async () => {
  const d = doubles({ regions: [{ text: "3.014,30", bbox: [1, 1, 2, 2], confidence: 0.9 }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "photo-skewed.png"));

  assert.deepEqual(out.trace.records.map((r) => r.stage),
    ["route", "recognise", "extract", "bind", "arithmetic", "gate"]);
});

test("a scanned PDF traces the render it needed before recognising", async () => {
  const d = doubles({ regions: [{ text: "3.014,30", bbox: [1, 1, 2, 2], confidence: 0.9 }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "scan-continental.pdf"));

  assert.deepEqual(out.trace.records.map((r) => r.stage),
    ["route", "render", "recognise", "extract", "bind", "arithmetic", "gate"]);
});

test("no trace record carries a figure", async () => {
  // Enforced by the record shape, asserted here because this is the module that would be
  // tempted: it has every value in hand at the moment it appends.
  const d = doubles({ regions: [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "digital-continental.pdf"));

  for (const record of out.trace.records) {
    assert.deepEqual(Object.keys(record).sort(),
      ["action", "digest", "head", "reads", "stage", "writes"]);
  }
  assert.ok(!JSON.stringify(out.trace.records).includes("52381"),
    "an amount reached the trace");
});

test("two runs of the same document produce the same trace root", async () => {
  // The cheapest determinism check available, and the only one that runs without a model.
  const regions = [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }];
  const file = path.join(CORPUS, "digital-continental.pdf");

  const first = await createPipeline({ ...doubles({ regions }), template }).run(file);
  const second = await createPipeline({ ...doubles({ regions }), template }).run(file);

  assert.equal(second.trace.root, first.trace.root);
});

test("a document read at a different confidence has a different trace root", async () => {
  // The trace commits to what each stage produced. A page read at different confidences is a
  // different reading of the page, and a root that could not tell them apart would be
  // committing to nothing.
  const file = path.join(CORPUS, "photo-skewed.png");
  const at = (confidence) => createPipeline({
    ...doubles({ regions: [{ text: "3.014,30", bbox: [1, 1, 2, 2], confidence }] }), template,
  }).run(file);

  const confident = await at(0.9);
  const less = await at(0.7);

  assert.notEqual(less.trace.root, confident.trace.root);
});

test("a run reports the model that extracted it, so a descriptor can name it", async () => {
  const d = doubles({ regions: [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }] });
  d.extractor.fromText = async () => ({
    ...coerce(template, { vendor: "Northwind", total: "523,81" }),
    raw: { vendor: "Northwind", total: "523,81" },
    model: "QWEN3_4B_INST_Q4_K_M", quantisation: "Q4_K_M",
  });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "digital-continental.pdf"));

  assert.equal(out.model, "QWEN3_4B_INST_Q4_K_M");
  assert.equal(out.quantisation, "Q4_K_M");
});

test("a run reports the fields the template asked for, not only the ones it got", async () => {
  // Without this a reader cannot tell a field that was never requested from one whose
  // abstention was deleted: both are simply absent.
  const d = doubles({ regions: [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }] });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "digital-continental.pdf"));

  assert.deepEqual(out.declared, ["vendor", "total"]);
});

test("a run reports the page's dimensions in the same units as the regions", async () => {
  // A box a reader cannot place on the page is not evidence. Given [112, 178, 375, 198] and
  // nothing else, a reader has no way to know what fraction of the page that is.
  const d = doubles({ regions: [{ text: "523,81", bbox: [1, 1, 2, 2], source: "text-layer" }] });
  d.raster.readTextGeometry = async () => ({ items: d.regions ?? [], width: 1191, height: 1684 });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "digital-continental.pdf"));

  assert.equal(out.page.width, 1191);
  assert.equal(out.page.height, 1684);
});

test("the rendered route reports the rendered page's dimensions", async () => {
  const d = doubles({ regions: [{ text: "3.014,30", bbox: [1, 1, 2, 2], confidence: 0.9 }] });
  d.raster.renderFirstPage = async () => ({ imagePath: "/tmp/page.png", width: 1240, height: 1754 });
  const pipeline = createPipeline({ ...d, template });

  const out = await pipeline.run(path.join(CORPUS, "scan-continental.pdf"));

  assert.equal(out.page.width, 1240);
  assert.equal(out.page.height, 1754);
});
