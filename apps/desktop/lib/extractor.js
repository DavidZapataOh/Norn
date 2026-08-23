"use strict";
const { TEXT_MODELS, VISION_MODELS, loadArgs } = require("./models");
const { compile, instruction, coerce, SYSTEM, DEFAULT_TEMPLATE } = require("./schema");

// reasoning_budget: 0 at load already stops the Qwen3.5 family emitting these under a
// grammar. This is the belt to that braces: one regex, covering a model whose reasoning
// channel the SDK does not recognise.
const THINK = /<think>[\s\S]*?<\/think>/gi;
const FENCE = /^```(?:json)?\s*|\s*```$/g;

function cleanJson(text) {
  return String(text ?? "").replace(THINK, "").replace(FENCE, "").trim();
}

// The watchdog fires on silence, not elapsed time. A first download of several gigabytes is
// slow but never silent; a second process holding the shared worker is silent from the
// first millisecond, with no error and no rejection to observe.
function withSilenceWatchdog(silenceMs, start) {
  let timer = null;
  let fail = null;
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fail?.(new Error(
      `model load made no progress for ${silenceMs}ms, which usually means another ` +
      `process is holding the shared worker`)), silenceMs);
  };
  const guard = new Promise((_, reject) => { fail = reject; bump(); });
  return Promise.race([start(bump), guard]).finally(() => timer && clearTimeout(timer));
}

const DEFAULT_TEXT = "qwen3-4b";
const DEFAULT_VISION = "qwen3vl-2b";

function createExtractor({ audit, sdk, template = DEFAULT_TEMPLATE, silenceMs = 90_000 }) {
  const compiled = compile(template);
  const ask = instruction(template);
  let resident = null;

  async function unload() {
    if (!resident) return;
    const held = resident;
    resident = null;
    await audit.auditUnloadModel(held.modelId, { model: held.key });
  }

  async function ensure(entry) {
    if (resident && resident.key === entry.key) return resident.modelId;
    // Switching model must drop what is loaded, or the next document is silently read by
    // the old one.
    if (resident) await unload();
    const args = await loadArgs(entry, sdk ? { sdk } : {});
    const modelId = await withSilenceWatchdog(silenceMs, (bump) =>
      // The SDK reads onProgress from the load options and switches to streaming when it
      // is present, which is what makes a slow download observable at all.
      audit.auditLoadModel({ ...args, onProgress: bump }, { model: entry.constName }));
    resident = { key: entry.key, modelId };
    return modelId;
  }

  async function run(entry, turn, event) {
    const modelId = await ensure(entry);
    let text, stats;
    try {
      ({ text, stats } = await audit.auditCompletion({
        modelId,
        history: [{ role: "system", content: SYSTEM }, turn],
        stream: true,
        // Every document is independent. A shared cache bleeds the previous invoice into
        // this one, which produces a plausible wrong answer rather than an error.
        kvCache: false,
        responseFormat: { type: "json_schema", json_schema: compiled },
        generationParams: { predict: 600, temp: 0 },
      }, { model: entry.constName, event }));
    } catch (error) {
      // A throw that skips the unload leaves the model resident while the caller believes
      // it is gone, and the next operation runs against a leak.
      await unload().catch(() => {});
      throw error;
    }

    const clean = cleanJson(text);
    let raw;
    try { raw = JSON.parse(clean); }
    catch {
      // The grammar guarantees shape, not completion: a generation truncated at `predict`
      // cuts valid JSON off mid-object.
      await unload().catch(() => {});
      throw new Error(
        `model output is not valid JSON, most likely truncated at the token limit: ` +
        `${clean.slice(0, 120)}`);
    }
    return { ...coerce(template, raw), raw, stats };
  }

  return {
    fromText(text, { modelKey = DEFAULT_TEXT } = {}) {
      const entry = TEXT_MODELS.find((m) => m.key === modelKey);
      if (!entry) throw new Error(`unknown text model "${modelKey}"`);
      return run(entry, { role: "user", content: `${ask}\n\nDocument text:\n\n${text}` }, "extract-text");
    },
    fromImage(imagePath, { modelKey = DEFAULT_VISION } = {}) {
      const entry = VISION_MODELS.find((m) => m.key === modelKey);
      if (!entry) throw new Error(`unknown vision model "${modelKey}"`);
      // Attachments are path-based; the SDK has no buffer form.
      return run(entry, { role: "user", content: ask, attachments: [{ path: imagePath }] }, "extract-vision");
    },
    unload,
    get residentKey() { return resident?.key ?? null; },
  };
}

module.exports = { createExtractor, cleanJson, DEFAULT_TEXT, DEFAULT_VISION };
