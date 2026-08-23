"use strict";
const os = require("node:os");
const path = require("node:path");
const { createAudit } = require("../lib/audit");
const { loadArgs, TEXT_MODELS } = require("../lib/models");
const { createSlots } = require("../lib/slots");
const { RECONCILE_ACTIONS, legalActions, referenceGrammar } = require("../lib/actions");
const { runLoop, createSelector } = require("../lib/orchestrator");
const { runNaive } = require("../lib/naive");
const { classifyNaive, classifySlotBound, aggregate, upperBound, latencyVerdict, OUTCOMES } =
  require("./orchestration-report");

const BASE_SEED = 1000;
const DOCUMENT_TOTAL_MINOR = 52381n;
const RECORD_AMOUNT_MINOR = 52281n;

// One object, one value, two shapes. The slot arm works in BigInt minor units and a tool
// argument is a JSON number, so the entry points cannot be literally the same function -- but
// the amount is defined once and both entry points return it, because a variance computed
// from two different constants is two experiments.
const host = {
  lookup: () => RECORD_AMOUNT_MINOR,
  lookup_record: () => ({ amount: Number(RECORD_AMOUNT_MINOR) }),
  compute_variance: ({ a, b }) => ({ variance: a - b }),
};

const expected = { variance: 100 };

// Declared, not inferred. A run that reached the right answer through the wrong slot is still
// a misreference, and only a declared expectation can say so.
const EXPECTED_REFERENCES = {
  lookup_record: { reference: "document.reference" },
  compute_variance: { documentAmount: "document.total", recordAmount: "record.amount" },
  report: { variance: "variance" },
};

function startingSlots() {
  const slots = createSlots();
  slots.put("document.reference", { type: "string", value: "NW-2026-0117", provenance: "document-asserted" });
  slots.put("document.currency", { type: "string", value: "EUR", provenance: "document-asserted" });
  slots.put("document.total", { type: "amount", value: DOCUMENT_TOTAL_MINOR, provenance: "document-asserted" });
  return slots;
}

function flag(name, fallback) {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`) || a === `--${name}`);
  if (!found) return fallback;
  return found.includes("=") ? found.split("=").slice(1).join("=")
    : process.argv[process.argv.indexOf(found) + 1] ?? fallback;
}

async function naiveTrials({ audit, modelId, trials, temp }) {
  const rows = [];
  for (let i = 0; i < trials; i++) {
    const started = performance.now();
    const trial = await runNaive({ audit, modelId, seed: BASE_SEED + i, host, temp });
    const ms = Math.round(performance.now() - started);
    const { outcome, detail } = classifyNaive(trial, { expected });

    const lookup = trial.calls.find((c) => c.name === "lookup_record");
    const variance = trial.calls.find((c) => c.name === "compute_variance");
    rows.push({
      i: i + 1, outcome, detail, ms,
      second: variance ? "yes" : "no",
      supplied: variance?.arguments?.b ?? null,
      returned: lookup?.returned?.amount ?? null,
    });
  }
  return rows;
}

async function slotTrials({ audit, modelId, trials }) {
  const rows = [];
  for (let i = 0; i < trials; i++) {
    const started = performance.now();
    const run = await runLoop({
      actions: RECONCILE_ACTIONS,
      slots: startingSlots(),
      host,
      select: createSelector({ audit, modelId, seed: BASE_SEED + i }),
    });
    const ms = Math.round(performance.now() - started);
    const { outcome, detail } = classifySlotBound(run, { expected, references: EXPECTED_REFERENCES });

    rows.push({
      i: i + 1, outcome, detail, ms,
      steps: run.steps.map((s) => s.action).join(","),
      answer: run.answer === null ? "-" : String(run.answer),
    });
  }
  return rows;
}

function printNaive(rows, temp) {
  console.log(`\nNAIVE  (temperature ${temp})`);
  console.log("  #  SECOND CALL  b SUPPLIED  TOOL RETURNED  OUTCOME                MS");
  for (const r of rows) {
    console.log(`  ${String(r.i).padEnd(2)} ${r.second.padEnd(12)} ` +
      `${String(r.supplied ?? "-").padEnd(11)} ${String(r.returned ?? "-").padEnd(14)} ` +
      `${r.outcome.padEnd(22)} ${r.ms}`);
  }
  for (const r of rows) if (r.outcome !== "correct") console.log(`     #${r.i}: ${r.detail}`);
}

function printSlot(rows) {
  console.log("\nSLOT-BOUND  (temperature 0)");
  console.log("  #  STEPS                                        ANSWER  OUTCOME                MS");
  for (const r of rows) {
    console.log(`  ${String(r.i).padEnd(2)} ${r.steps.padEnd(44)} ${r.answer.padEnd(7)} ` +
      `${r.outcome.padEnd(22)} ${r.ms}`);
  }
  for (const r of rows) if (r.outcome !== "correct") console.log(`     #${r.i}: ${r.detail}`);
}

// A parameter with one admissible slot cannot be misreferenced, so the meaning of a zero
// misreference rate depends entirely on whether a misreference was available to make.
function referenceChoices() {
  const slots = startingSlots();
  slots.put("record.amount", { type: "amount", value: RECORD_AMOUNT_MINOR, provenance: "source-attested" });
  const lines = [];
  for (const action of RECONCILE_ACTIONS) {
    for (const param of action.params) {
      const admissible = referenceGrammar(action, slots).schema.properties[param.name].enum;
      lines.push({ name: `${action.name}.${param.name}`, admissible });
    }
  }
  return { lines, legal: legalActions(RECONCILE_ACTIONS, slots).length };
}

function compare(arms, trials) {
  const names = Object.keys(arms);
  console.log(`\n${"".padEnd(22)}${names.map((n) => n.padEnd(15)).join("")}`);
  for (const outcome of OUTCOMES) {
    const cells = names.map((n) => String(arms[n].agg.byOutcome[outcome]).padEnd(15));
    console.log(`  ${outcome.padEnd(20)}${cells.join("")}`);
  }

  const latency = latencyVerdict(Object.fromEntries(names.map((n) => [n, arms[n].ms])));
  console.log(`  ${"median latency".padEnd(20)}` +
    names.map((n) => `${latency.medians[n]} ms`.padEnd(15)).join(""));
  if (names.length > 1) {
    console.log(latency.separable
      ? `  ${latency.faster} is faster by ${latency.gap} ms, against a ${latency.spread} ms ` +
        "spread within an arm."
      : `  The ${latency.gap} ms between them is inside the ${latency.spread} ms spread within ` +
        "an arm.\n  The arms run in sequence and latency climbs across a run, so this is not\n" +
        "  a difference between the architectures.");
  }

  console.log("");
  for (const n of names) {
    const failures = arms[n].agg.trials - arms[n].agg.correct;
    const pct = (upperBound(failures, trials) * 100).toFixed(0);
    console.log(`  ${n}: ${arms[n].agg.correct}/${trials} correct. ` +
      `${failures} failures in ${trials} is consistent with a true failure rate up to ` +
      `${pct}% at 95% confidence.`);
  }
  const rates = names.map((n) => arms[n].agg.correct);
  if (names.length > 1 && new Set(rates).size === 1) {
    // The result this run actually produced, said plainly. Both arms scored the same, so
    // these trials measured no difference between them -- the bound above is the width of
    // what the run could have detected, and it is wide.
    console.log(`\n  Both arms scored ${rates[0]}/${trials}. This run separates them on nothing:`);
    console.log("  the reference task is one lookup and one subtraction with the returned value");
    console.log("  one message back, which the baseline gets right. A delta, if there is one,");
    console.log("  is not visible at this task size and cannot be claimed from this run.");
  }

  console.log(`\n  ${trials} trials on one task is enough to show a direction and not enough`);
  console.log("  to state a rate.");

  const { lines, legal } = referenceChoices();
  console.log("\nWAS A MISREFERENCE AVAILABLE TO MAKE?");
  for (const l of lines) {
    console.log(`  ${l.name.padEnd(32)} ${l.admissible.length} admissible  ` +
      `${JSON.stringify(l.admissible)}`);
  }
  const choices = lines.filter((l) => l.admissible.length > 1);
  console.log(choices.length
    ? `  ${choices.length} parameter with a real choice (${choices.map((c) => c.name).join(", ")}): ` +
      "a zero above is not observed, not structural."
    : "  Every parameter is forced. A zero misreference rate on a choice nobody could get " +
      "wrong is not evidence about anything.");
  console.log(`  ${legal} action${legal === 1 ? "" : "s"} legal from the starting state.`);
}

async function main() {
  const trials = Number(flag("trials", 10));
  const mode = flag("mode", "both");
  const temp = Number(flag("temp", 0.7));
  const key = flag("model", "qwen3-4b");
  const entry = TEXT_MODELS.find((m) => m.key === key);
  if (!entry) throw new Error(`no model named "${key}"`);

  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-orchestration", "inference.jsonl") });
  // One load for both arms. Two loads would be two configurations, and this script exists to
  // have one; tools: true is required at load or the naive arm emits no tool call at all.
  const modelId = await audit.auditLoadModel(await loadArgs(entry, { tools: true }),
    { model: entry.constName });

  const arms = {};
  try {
    console.log(`${entry.label} on ${os.cpus()[0].model}, ${trials} trials, seeds ` +
      `${BASE_SEED}..${BASE_SEED + trials - 1}`);

    if (mode === "naive" || mode === "both") {
      // The baseline is read first. Reading it after the other arm is what lets a comparison
      // be written backwards from a result.
      const rows = await naiveTrials({ audit, modelId, trials, temp });
      printNaive(rows, temp);
      arms.naive = { agg: aggregate(rows), ms: rows.map((r) => r.ms) };
    }
    if (mode === "slot" || mode === "both") {
      const rows = await slotTrials({ audit, modelId, trials });
      printSlot(rows);
      arms["slot-bound"] = { agg: aggregate(rows), ms: rows.map((r) => r.ms) };
    }
  } finally {
    await audit.auditUnloadModel(modelId, { model: entry.constName });
  }

  compare(arms, trials);
}

main().catch((e) => { console.error(e); process.exit(1); });
