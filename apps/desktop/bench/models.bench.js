"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { TEXT_MODELS, loadArgs } = require("../lib/models");
const { createAudit } = require("../lib/audit");
const { scoreDocument, scoreCorpus } = require("./score");

// The instruction "if a field is not on the document, return null" measurably harms
// Qwen3 4B: it returns null for the total on every fixture, and drops the instruction
// to answer correctly. Nullability is already expressed by the schema, so stating it
// again in prose only competes with the document.
const SYSTEM =
  "You are a bookkeeping assistant. You read invoices and receipts and report their " +
  "fields exactly as printed. You never invent values. /no_think";

const SCHEMA = {
  type: "object",
  properties: {
    invoice_number: { type: ["string", "null"] },
    vendor: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    vat_number: { type: ["string", "null"] },
  },
  required: ["invoice_number", "vendor", "total", "currency", "vat_number"],
  additionalProperties: false,
};

async function main() {
  const key = process.argv[2];
  const entry = TEXT_MODELS.find((m) => m.key === key);
  if (!entry) {
    console.error(`usage: node bench/models.bench.js <${TEXT_MODELS.map((m) => m.key).join("|")}>`);
    process.exit(1);
  }

  const audit = createAudit({ logPath: path.join(os.tmpdir(), "norn-bench", "inference.jsonl") });
  const dir = path.join(__dirname, "fixtures");
  const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

  const args = await loadArgs(entry);
  const t0 = Date.now();
  const modelId = await audit.auditLoadModel(args, { model: entry.constName });
  const loadMs = Date.now() - t0;

  const results = [];
  for (const fixture of fixtures) {
    const t = Date.now();
    const { text, stats } = await audit.auditCompletion({
      modelId,
      history: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Extract the fields as JSON.\n\nDocument text:\n\n${fixture.text}` },
      ],
      stream: true,
      kvCache: false,
      responseFormat: { type: "json_schema", json_schema: { name: "invoice", schema: SCHEMA } },
      generationParams: { predict: 600, temp: 0, seed: 1 },
    }, { model: entry.constName, event: fixture.id });

    const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(clean); }
    catch { console.error(`  ${fixture.id}: UNPARSEABLE -- ${clean.slice(0, 90)}`); }

    const scored = scoreDocument(fixture.expected, parsed ?? {});
    results.push({ ...scored, id: fixture.id, expected: fixture.expected, ms: Date.now() - t, tps: stats?.tokensPerSecond });
  }

  await audit.auditUnloadModel(modelId, { model: entry.constName });

  const corpus = scoreCorpus(results);
  const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  const avgTps = results.filter((r) => r.tps).reduce((s, r) => s + r.tps, 0) / results.filter((r) => r.tps).length;

  console.log(`\n${entry.label}: ${corpus.correct}/${corpus.total} cells | load ${(loadMs / 1000).toFixed(1)}s | ${avgMs}ms/doc | ${avgTps.toFixed(1)} tok/s`);
  for (const r of results) {
    console.log(`  ${r.correct}/${r.total}  ${r.id.padEnd(22)} ${r.ms}ms`);
    for (const w of r.wrong) {
      console.log(`      ${w.field}: expected ${JSON.stringify(w.expected)}, got ${JSON.stringify(w.actual)}`);
    }
  }
  console.log(`\nlog: ${audit.logPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
