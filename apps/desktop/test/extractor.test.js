"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createExtractor } = require("../lib/extractor");

const registry = {
  QWEN3_4B_INST_Q4_K_M: { src: "registry://s3/qwen3-4b.gguf", engine: "llamacpp-completion",
                          modelId: "q4b.gguf", expectedSize: 1 },
  QWEN3VL_2B_MULTIMODAL_Q4_K: { src: "registry://s3/vl.gguf", engine: "llamacpp-completion",
                                modelId: "vl.gguf", expectedSize: 1 },
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K: { src: "registry://s3/vl.mmproj", engine: "llamacpp-completion",
                                       modelId: "vl.mmproj", expectedSize: 1 },
};
const sdk = async () => registry;

function fakeAudit({ reply = '{"vendor":"Northwind","total":"2.831,40"}' } = {}) {
  const calls = { load: [], completion: [], unload: [] };
  return {
    calls,
    auditLoadModel: async (args, meta) => { calls.load.push({ args, meta }); return `model-${calls.load.length}`; },
    auditCompletion: async (params, meta) => {
      calls.completion.push({ params, meta });
      return { text: reply, stats: { tokensPerSecond: 40 } };
    },
    auditUnloadModel: async (id) => { calls.unload.push(id); },
  };
}

const template = {
  name: "invoice",
  fields: [
    { key: "vendor", label: "Vendor", type: "string" },
    { key: "total", label: "Total", type: "amount" },
  ],
};

test("the text path sends a grammar and no attachment", async () => {
  const audit = fakeAudit();
  const extractor = createExtractor({ audit, sdk, template });

  const out = await extractor.fromText("Total due 2.831,40");

  const { params } = audit.calls.completion[0];
  assert.equal(params.responseFormat.type, "json_schema");
  assert.equal(params.responseFormat.json_schema.name, "invoice");
  assert.equal(params.responseFormat.json_schema.schema.additionalProperties, false);
  assert.equal(params.kvCache, false, "a shared cache bleeds the previous document into this one");
  assert.equal(params.generationParams.temp, 0);
  assert.equal(params.history.at(-1).attachments, undefined);
  assert.ok(params.history.at(-1).content.includes("2.831,40"), "the document text never reached the model");

  assert.equal(out.values.total.value, 283140n);
  assert.equal(out.values.vendor.value, "Northwind");

  await extractor.unload();
});

test("the vision path attaches the image by path and sends no document text", async () => {
  const audit = fakeAudit();
  const extractor = createExtractor({ audit, sdk, template });

  await extractor.fromImage("/tmp/page.png");

  const turn = audit.calls.completion[0].params.history.at(-1);
  // The SDK takes a path and has no buffer form.
  assert.deepEqual(turn.attachments, [{ path: "/tmp/page.png" }]);
  assert.ok(!turn.content.includes("Document text"));

  await extractor.unload();
});

test("a grammar and tools are never sent together", async () => {
  // responseFormat and tools are mutually exclusive in one request.
  const audit = fakeAudit();
  const extractor = createExtractor({ audit, sdk, template });

  await extractor.fromText("x");

  assert.equal(audit.calls.completion[0].params.tools, undefined);
  await extractor.unload();
});

test("a second document on the same path reuses the resident model", async () => {
  const audit = fakeAudit();
  const extractor = createExtractor({ audit, sdk, template });

  await extractor.fromText("one");
  await extractor.fromText("two");

  assert.equal(audit.calls.load.length, 1, "the model was reloaded for the second document");
  assert.equal(audit.calls.completion.length, 2);

  await extractor.unload();
});

test("switching path unloads the previous model before loading the next", async () => {
  const audit = fakeAudit();
  const extractor = createExtractor({ audit, sdk, template });

  await extractor.fromText("a digital invoice");
  await extractor.fromImage("/tmp/page.png");

  assert.equal(audit.calls.load.length, 2);
  assert.deepEqual(audit.calls.unload, ["model-1"],
    "the text model stayed resident, so the next document is read by the wrong one");

  await extractor.unload();
});

test("a completion that throws still leaves no model resident", async () => {
  const audit = fakeAudit();
  audit.auditCompletion = async () => { throw new Error("generation failed"); };
  const extractor = createExtractor({ audit, sdk, template });

  await assert.rejects(() => extractor.fromText("x"), /generation failed/);
  assert.deepEqual(audit.calls.unload, ["model-1"], "the model was left resident after a throw");
  assert.equal(extractor.residentKey, null);
});

const { cleanJson } = require("../lib/extractor");

test("a think block is stripped before parsing", () => {
  const dirty = '<think>The total appears twice, I will use the larger.</think>\n{"vendor":"A","total":"12,00"}';
  assert.equal(cleanJson(dirty), '{"vendor":"A","total":"12,00"}');
});

test("a fenced response is unwrapped", () => {
  assert.equal(cleanJson('```json\n{"a":1}\n```'), '{"a":1}');
});

test("a truncated generation fails with a message naming the cause", async () => {
  const audit = fakeAudit({ reply: '{"vendor":"Northwind","total":"2.83' });
  const extractor = createExtractor({ audit, sdk, template });

  await assert.rejects(() => extractor.fromText("x"),
    /model output is not valid JSON.*truncated/s);
  await extractor.unload();
});

test("the load watchdog fires on silence", async () => {
  const audit = fakeAudit();
  audit.auditLoadModel = () => new Promise(() => {});   // never settles, never reports
  const extractor = createExtractor({ audit, sdk, template, silenceMs: 40 });

  await assert.rejects(() => extractor.fromText("x"),
    /no progress for 40ms.*another process/s);
});

test("the watchdog does not fire on a slow but progressing load", async () => {
  const audit = fakeAudit();
  audit.auditLoadModel = async (args) => {
    // Six quiet stretches, each shorter than the window: a large first download. The SDK
    // takes onProgress inside the load options, so that is where the watchdog listens.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 25));
      args.onProgress?.({ percentage: (i + 1) * 16 });
    }
    return "model-1";
  };
  const extractor = createExtractor({ audit, sdk, template, silenceMs: 40 });

  await extractor.fromText("x");   // 150ms total, no stretch over 40ms
  await extractor.unload();
});
