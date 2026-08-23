"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");

function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-audit-"));
  return path.join(dir, "inference.jsonl");
}

test("writes one JSON line per record", () => {
  const logPath = tempLog();
  const audit = createAudit({ logPath, now: () => "2026-08-22T00:00:00.000Z" });

  audit.record({ op: "completion", model: "QWEN3_4B", gen_ms: 940 });
  audit.record({ op: "unloadModel", model: "QWEN3_4B" });

  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), {
    ts: "2026-08-22T00:00:00.000Z",
    platform: `${process.platform}/${process.arch}`,
    op: "completion",
    model: "QWEN3_4B",
    gen_ms: 940,
  });
});

test("a second audit over the same path appends rather than truncating", () => {
  const logPath = tempLog();
  createAudit({ logPath }).record({ op: "first" });
  createAudit({ logPath }).record({ op: "second" });

  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).op, "first");
});

test("concurrent records never interleave a partial line", async () => {
  const logPath = tempLog();
  const audit = createAudit({ logPath });
  const payload = "x".repeat(4096);

  await Promise.all(
    Array.from({ length: 200 }, (_, i) => Promise.resolve().then(() =>
      audit.record({ op: "completion", i, payload })))
  );

  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 200);
  for (const line of lines) JSON.parse(line);
});

test("completion records the profiler fields, not a wall clock guess", async () => {
  const logPath = tempLog();
  const fakeSdk = async () => ({
    completion: () => ({
      events: (async function* () { yield { type: "contentDelta", text: "{}" }; })(),
      final: Promise.resolve({
        contentText: "{}",
        stats: {
          timeToFirstToken: 332.124,
          tokensPerSecond: 117.61,
          promptTokens: 76,
          generatedTokens: 50,
          cacheTokens: 0,
          backendDevice: "gpu",
        },
      }),
    }),
  });

  const audit = createAudit({ logPath, sdk: fakeSdk });
  const out = await audit.auditCompletion({ modelId: "m" }, { model: "QWEN3_600M" });

  assert.equal(out.text, "{}");
  const row = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(row.op, "completion");
  assert.equal(row.model, "QWEN3_600M");
  assert.equal(row.ttft_ms, 332.124);
  assert.equal(row.tok_per_sec, 117.61);
  assert.equal(row.prompt_tokens, 76);
  assert.equal(row.backend_device, "gpu");
  assert.equal(row.metrics_source, "profiler-raw");
});

test("a run without stats is marked wall-clock, not silently profiler-raw", async () => {
  const logPath = tempLog();
  const fakeSdk = async () => ({
    completion: () => ({
      events: (async function* () {})(),
      final: Promise.resolve({ contentText: "" }),
    }),
  });

  const audit = createAudit({ logPath, sdk: fakeSdk });
  await audit.auditCompletion({ modelId: "m" }, { model: "X" });

  const row = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(row.metrics_source, "wall-clock");
  assert.equal(row.ttft_ms, undefined);
});

test("a failing completion still leaves a record", async () => {
  const logPath = tempLog();
  const fakeSdk = async () => ({
    completion: () => { throw new Error("context overflow"); },
  });

  const audit = createAudit({ logPath, sdk: fakeSdk });
  await assert.rejects(() => audit.auditCompletion({ modelId: "m" }, { model: "X" }));

  const row = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(row.op, "completion");
  assert.equal(row.error, "context overflow");
});

test("OCR seconds are converted to milliseconds", async () => {
  const logPath = tempLog();
  const fakeSdk = async () => ({
    ocr: () => ({
      blocks: Promise.resolve([{ text: "TOTAL", bbox: [1, 2, 3, 4], confidence: 0.99 }]),
      stats: Promise.resolve({ detectionTime: 18.233, recognitionTime: 1.978, totalTime: 20.302 }),
    }),
  });

  const audit = createAudit({ logPath, sdk: fakeSdk, elapsed: () => 20300 });
  await audit.auditOcr({ modelId: "ocr", image: "/x.png" }, { model: "OCR_LATIN" });

  const row = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(row.ocr_ms, 20302);
  assert.equal(row.detect_ms, 18233);
  assert.equal(row.recognize_ms, 1978);
  assert.equal(row.metrics_source, "profiler-raw");
});

test("a profiler timing that disagrees with the wall clock is not trusted", async () => {
  const logPath = tempLog();
  // A future SDK reporting milliseconds here would make totalTime 20302, which
  // converted would claim a 20302-second pass against a 20.3-second wall clock.
  const fakeSdk = async () => ({
    ocr: () => ({
      blocks: Promise.resolve([]),
      stats: Promise.resolve({ totalTime: 20302 }),
    }),
  });

  const audit = createAudit({ logPath, sdk: fakeSdk, elapsed: () => 20300 });
  await audit.auditOcr({ modelId: "ocr", image: "/x.png" }, { model: "OCR_LATIN" });

  const row = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(row.ocr_ms, 20300);
  assert.equal(row.metrics_source, "wall-clock");
});

test("load and unload each leave a record with their duration", async () => {
  const logPath = tempLog();
  const fakeSdk = async () => ({
    loadModel: async () => "model-abc",
    unloadModel: async () => undefined,
  });

  const audit = createAudit({ logPath, sdk: fakeSdk });
  const id = await audit.auditLoadModel({ modelSrc: {} }, { model: "QWEN3_4B" });
  await audit.auditUnloadModel(id, { model: "QWEN3_4B" });

  const rows = fs.readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(id, "model-abc");
  assert.equal(rows[0].op, "loadModel");
  assert.equal(typeof rows[0].load_ms, "number");
  assert.equal(rows[1].op, "unloadModel");
});

test("unload never clears the model cache", async () => {
  const logPath = tempLog();
  let seen = null;
  const fakeSdk = async () => ({
    unloadModel: async (args) => { seen = args; },
  });

  await createAudit({ logPath, sdk: fakeSdk }).auditUnloadModel("m", { model: "X" });

  assert.equal(seen.clearStorage, false);
});

function toolAudit(logPath, final) {
  return createAudit({
    logPath, now: () => "T", elapsed: () => 10,
    sdk: async () => ({
      completion: () => ({ events: (async function* () {})(), final: Promise.resolve(final) }),
    }),
  });
}

test("a completion's tool calls and tool errors reach the caller, separated", async () => {
  const audit = toolAudit(tempLog(), {
    contentText: "",
    // Both shapes arrive in the same array and are told apart by type. Separating them at
    // each call site means a caller eventually forgets.
    toolCalls: [
      { type: "toolCall", call: { id: "1", name: "lookup_record", arguments: { reference: "NW-1" } } },
      { type: "toolCallError", error: { code: "VALIDATION_ERROR", message: "amount is not a number" } },
    ],
    stopReason: "eos",
    stats: {},
  });

  const out = await audit.auditCompletion({ modelId: "m" }, { model: "test" });

  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, "lookup_record");
  assert.deepEqual(out.toolCalls[0].arguments, { reference: "NW-1" });
  assert.equal(out.toolErrors.length, 1);
  assert.equal(out.toolErrors[0].code, "VALIDATION_ERROR");
  assert.equal(out.stopReason, "eos");
});

test("the audit record counts tool calls and tool errors", async () => {
  // A trial that emitted nothing and a trial that emitted a malformed call are different
  // events, and a log recording both as "one completion" cannot tell them apart afterwards.
  const logPath = tempLog();
  await toolAudit(logPath, {
    contentText: "",
    toolCalls: [
      { type: "toolCall", call: { id: "1", name: "lookup_record", arguments: {} } },
      { type: "toolCallError", error: { code: "PARSE_ERROR", message: "x" } },
    ],
    stopReason: "eos", stats: {},
  }).auditCompletion({ modelId: "m" }, { model: "test" });

  const line = JSON.parse(fs.readFileSync(logPath, "utf8").trim().split("\n").pop());
  assert.equal(line.tool_calls, 1);
  assert.equal(line.tool_errors, 1);
  assert.equal(line.stop_reason, "eos");
});

test("a completion with no tools returns empty arrays, not undefined", async () => {
  // Every existing caller reads { text, stats } and must keep working.
  const out = await toolAudit(tempLog(), {
    contentText: "hello", toolCalls: [], stats: { tokensPerSecond: 9 },
  }).auditCompletion({ modelId: "m" }, { model: "test" });

  assert.equal(out.text, "hello");
  assert.deepEqual(out.toolCalls, []);
  assert.deepEqual(out.toolErrors, []);
});
