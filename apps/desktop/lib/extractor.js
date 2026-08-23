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

// The quantisation is the tail of the registry constant, which is where the SDK puts it:
// QWEN3_4B_INST_Q4_K_M is Q4_K_M, QWEN3_1_7B_INST_Q4 is Q4. Derived rather than listed a
// second time, so a new entry cannot arrive with the two disagreeing.
const quantisationOf = (constName) => (constName.match(/_(Q\d[\w]*)$/)?.[1] ?? "unknown");

const DEFAULT_TEXT = "qwen3-4b";
const DEFAULT_VISION = "qwen3vl-2b";

// Recorded in the replay descriptor, so it has to be a value that was really sent rather than
// an assumption that greedy decoding is deterministic.
const DEFAULT_SEED = 4242;

// Which model a route will run, answerable before anything is loaded. Replay decides
// comparability first, and asking the route rather than the certificate is the point: comparing
// a recorded model against itself always agrees.
function modelForRoute(route) {
  if (route === "text") return TEXT_MODELS.find((m) => m.key === DEFAULT_TEXT).constName;
  if (route === "image" || route === "pdf-needs-render") {
    return VISION_MODELS.find((m) => m.key === DEFAULT_VISION).constName;
  }
  throw new Error(`no model is defined for route "${route}"`);
}

function createExtractor({ audit, sdk, template = DEFAULT_TEMPLATE, silenceMs = 90_000,
                           seed = DEFAULT_SEED }) {
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
        generationParams: { predict: 600, temp: 0, seed },
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
    // The model that ran, not the one that is the default. A descriptor reading the default
    // would be wrong for any run that overrode it, and wrong in a way replay cannot detect:
    // it would faithfully reproduce a run nobody performed.
    return { ...coerce(template, raw), raw, stats,
             model: entry.constName, quantisation: quantisationOf(entry.constName) };
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

module.exports = { createExtractor, modelForRoute, cleanJson,
                   DEFAULT_TEXT, DEFAULT_VISION, DEFAULT_SEED };
