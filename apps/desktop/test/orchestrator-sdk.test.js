"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { loadArgs, TEXT_MODELS } = require("../lib/models");
const { createSlots } = require("../lib/slots");
const { RECONCILE_ACTIONS } = require("../lib/actions");
const { runLoop, createSelector } = require("../lib/orchestrator");

const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-loop-test", "inference.jsonl") });
const entry = TEXT_MODELS.find((m) => m.key === "qwen3-1.7b");

function started() {
  const slots = createSlots();
  slots.put("document.reference", { type: "string", value: "NW-2026-0117", provenance: "document-asserted" });
  slots.put("document.currency", { type: "string", value: "EUR", provenance: "document-asserted" });
  slots.put("document.total", { type: "amount", value: 52381n, provenance: "document-asserted" });
  return slots;
}

test("a real model drives the loop to a terminal state", async () => {
  const modelId = await audit.auditLoadModel(await loadArgs(entry), { model: entry.constName });
  try {
    const run = await runLoop({
      actions: RECONCILE_ACTIONS, slots: started(), host: { lookup: () => 52281n },
      select: createSelector({ audit, modelId, seed: 42 }),
    });

    assert.equal(run.stopReason, "terminal", `stopped as ${run.stopReason}`);
    // The claim under test is that the loop completes and the value came from the host, not
    // that a 1.7B model is clever. The sequence is forced by the grammar either way.
    assert.equal(run.answer, 100n);
    assert.deepEqual(run.steps.map((s) => s.action),
      ["lookup_record", "compute_variance", "report"]);
  } finally {
    await audit.auditUnloadModel(modelId, { model: entry.constName });
  }
});

test("the same seed reproduces the same step sequence", async () => {
  const modelId = await audit.auditLoadModel(await loadArgs(entry), { model: entry.constName });
  try {
    const once = await runLoop({
      actions: RECONCILE_ACTIONS, slots: started(), host: { lookup: () => 52281n },
      select: createSelector({ audit, modelId, seed: 7 }),
    });
    const twice = await runLoop({
      actions: RECONCILE_ACTIONS, slots: started(), host: { lookup: () => 52281n },
      select: createSelector({ audit, modelId, seed: 7 }),
    });

    // The precondition for replay: a reported result that can be reproduced rather than
    // described.
    assert.deepEqual(twice.steps, once.steps);
    assert.equal(twice.answer, once.answer);
  } finally {
    await audit.auditUnloadModel(modelId, { model: entry.constName });
  }
});
