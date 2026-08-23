"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { sdk: defaultSdk } = require("./sdk");

function createAudit({
  logPath,
  now = () => new Date().toISOString(),
  elapsed = (from) => performance.now() - from,
  sdk = defaultSdk,
}) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  function record(entry) {
    const line = JSON.stringify({
      ts: now(),
      platform: `${process.platform}/${process.arch}`,
      ...entry,
    });
    fs.appendFileSync(logPath, `${line}\n`);
  }

  async function auditCompletion(params, { model, event } = {}) {
    const started = performance.now();
    const S = await sdk();

    try {
      const run = S.completion(params);
      // A rejected tool call exists only here. It is a `toolError` event and never reaches
      // `final`, so a caller that drains the stream and reads only `final` sees a turn that
      // called no tool and cannot tell it from a turn that chose to call none.
      const toolErrors = [];
      for await (const emitted of run.events) {
        if (emitted?.type === "toolError") toolErrors.push(emitted.error);
      }
      const final = await run.final;
      const stats = final?.stats;

      // Flat calls, no discriminator: `final.toolCalls` is ToolCallWithCall[], which is
      // { id, name, arguments } and not a tagged union.
      const toolCalls = final?.toolCalls ?? [];

      record({
        op: "completion",
        model,
        event,
        gen_ms: Math.round(elapsed(started)),
        ttft_ms: stats?.timeToFirstToken,
        tok_per_sec: stats?.tokensPerSecond,
        prompt_tokens: stats?.promptTokens,
        completion_tokens: stats?.generatedTokens,
        cache_tokens: stats?.cacheTokens,
        backend_device: stats?.backendDevice,
        seed: params?.generationParams?.seed,
        tool_calls: toolCalls.length,
        tool_errors: toolErrors.length,
        stop_reason: final?.stopReason,
        metrics_source: stats ? "profiler-raw" : "wall-clock",
      });

      return { text: String(final?.contentText ?? ""), stats, toolCalls, toolErrors,
               stopReason: final?.stopReason };
    } catch (error) {
      // A failed inference is still an inference that happened. A log holding only
      // successes describes a system that never fails.
      record({
        op: "completion",
        model,
        event,
        gen_ms: Math.round(elapsed(started)),
        error: String(error.message),
        metrics_source: "wall-clock",
      });
      throw error;
    }
  }

  // The OCR addon reports seconds while the LLM profiler reports milliseconds.
  // Logging the field raw once recorded an 18.9s pass as 19ms.
  async function auditOcr(params, { model } = {}) {
    const started = performance.now();
    const S = await sdk();
    const run = S.ocr(params);
    const blocks = await run.blocks;
    const stats = await run.stats.catch(() => undefined);

    const wallMs = elapsed(started);
    const profilerMs = stats?.totalTime !== undefined ? stats.totalTime * 1000 : undefined;
    const agrees = profilerMs !== undefined && Math.abs(profilerMs - wallMs) < wallMs * 0.5 + 250;

    record({
      op: "ocr",
      model,
      ocr_ms: Math.round(agrees ? profilerMs : wallMs),
      detect_ms: stats?.detectionTime !== undefined ? Math.round(stats.detectionTime * 1000) : undefined,
      recognize_ms: stats?.recognitionTime !== undefined ? Math.round(stats.recognitionTime * 1000) : undefined,
      blocks: blocks.length,
      metrics_source: agrees ? "profiler-raw" : "wall-clock",
    });

    return { blocks, stats };
  }

  async function auditLoadModel(args, { model } = {}) {
    const started = performance.now();
    const S = await sdk();
    try {
      const modelId = await S.loadModel(args);
      record({ op: "loadModel", model, load_ms: Math.round(elapsed(started)), metrics_source: "wall-clock" });
      return modelId;
    } catch (error) {
      record({
        op: "loadModel", model,
        load_ms: Math.round(elapsed(started)),
        error: String(error.message),
        metrics_source: "wall-clock",
      });
      throw error;
    }
  }

  async function auditUnloadModel(modelId, { model } = {}) {
    const started = performance.now();
    const S = await sdk();
    // clearStorage deletes the weights from disk and forces a re-download. It is a
    // cache-eviction flag, not a memory operation, and is never what this app wants.
    await S.unloadModel({ modelId, clearStorage: false });
    record({ op: "unloadModel", model, load_ms: Math.round(elapsed(started)), metrics_source: "wall-clock" });
  }

  return { record, auditCompletion, auditOcr, auditLoadModel, auditUnloadModel, logPath };
}

module.exports = { createAudit };
