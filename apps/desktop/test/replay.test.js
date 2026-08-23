"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compare, comparability, VOLATILE_PATHS } = require("../lib/replay");

const base = () => ({
  version: "1.0",
  producedAt: "2026-08-23T10:00:00.000Z",
  document: { digest: "c".repeat(64), path: "/Users/a/inv.pdf", route: "text", page: 1 },
  verdict: { decision: "matched", variance: { minor: "100", proportion: 0.0019 }, record: null,
             checks: [{ name: "amount agrees", outcome: "pass", detail: "within tolerance" }] },
  fields: {
    total: { key: "total", type: "amount", minor: "52381", currency: "EUR",
             bbox: [1, 2, 3, 4], confidence: null, page: 1 },
    tax: { key: "tax", type: "amount", minor: "9091", currency: "EUR",
           bbox: [1, 5, 3, 7], confidence: 0.83, page: 1 },
  },
  abstentions: [],
  attestations: [],
  trace: { root: "d".repeat(64), records: [] },
  replay: { model: "QWEN3_4B_INST_Q4_K_M", quantisation: "Q4_K_M", sdkVersion: "0.17.1",
            seed: 4242, inputDigest: "c".repeat(64) },
  signature: { alg: "ed25519", publicKey: "pk", sig: "aa", digest: "e".repeat(64) },
});

test("two identical certificates match", () => {
  const out = compare(base(), base());

  assert.equal(out.match, true);
  assert.deepEqual(out.differences, []);
  assert.equal(out.firstDifference, null);
});

test("a differing confidence names the path and both values", () => {
  // "Certificates differ" is not actionable. This says which stage to look at and roughly
  // what happened there.
  const changed = base();
  changed.fields.tax.confidence = 0.84;

  const out = compare(base(), changed);

  assert.equal(out.match, false);
  assert.equal(out.firstDifference.path, "fields.tax.confidence");
  assert.equal(out.firstDifference.recorded, 0.83);
  assert.equal(out.firstDifference.regenerated, 0.84);
});

test("a timestamp difference is not a mismatch", () => {
  // It varies by construction. A check that always fails is a check nobody runs.
  const later = base();
  later.producedAt = "2026-08-24T11:00:00.000Z";

  assert.equal(compare(base(), later).match, true);
});

test("an absolute path difference is not a mismatch", () => {
  const elsewhere = base();
  elsewhere.document.path = "/Users/b/Downloads/inv.pdf";

  assert.equal(compare(base(), elsewhere).match, true);
});

test("a new signature over the same content is not a mismatch", () => {
  // A replay produces its own signature. A differing signature is not a differing result --
  // but the digest it covers is compared, which is what keeps this from being a hole.
  const resigned = base();
  resigned.signature = { alg: "ed25519", publicKey: "other", sig: "bb", digest: "f".repeat(64) };

  assert.equal(compare(base(), resigned).match, true);
});

test("the input digest is still compared, because the path is not the document", () => {
  // Excluding where the file sat must not quietly exclude which file it was.
  const other = base();
  other.document.digest = "e".repeat(64);

  const out = compare(base(), other);

  assert.equal(out.match, false);
  assert.equal(out.firstDifference.path, "document.digest");
});

test("a field present in one and absent in the other is named, not skipped", () => {
  const fewer = base();
  delete fewer.fields.tax;

  const out = compare(base(), fewer);

  assert.equal(out.match, false);
  assert.match(out.firstDifference.path, /^fields\.tax/);
  assert.equal(out.firstDifference.regenerated, undefined);
});

test("a field the replay invented is named too", () => {
  const more = base();
  more.fields.discount = { key: "discount", type: "amount", minor: "500", currency: "EUR",
                           bbox: [9, 9, 9, 9], confidence: null, page: 1 };

  const out = compare(base(), more);

  assert.equal(out.match, false);
  assert.match(out.firstDifference.path, /^fields\.discount/);
  assert.equal(out.firstDifference.recorded, undefined);
});

test("differences are ordered, so the first is the earliest in the document", () => {
  const changed = base();
  changed.fields.tax.confidence = 0.9;
  changed.verdict.decision = "mismatch";

  const out = compare(base(), changed);

  assert.equal(out.differences.length, 2);
  assert.equal(out.firstDifference.path, "fields.tax.confidence");
  assert.equal(out.differences[1].path, "verdict.decision");
});

test("an array that differs in length reports the index, not the whole array", () => {
  const changed = base();
  changed.verdict.checks.push({ name: "extra", outcome: "pass", detail: "x" });

  const out = compare(base(), changed);

  assert.match(out.firstDifference.path, /verdict\.checks\[1\]/);
});

test("the volatile list is explicit, not a guess about key names", () => {
  // A heuristic skipping any key called "path" would also skip a template field named path.
  assert.ok(VOLATILE_PATHS.includes("document.path"));
  assert.ok(VOLATILE_PATHS.includes("producedAt"));
  assert.ok(VOLATILE_PATHS.includes("signature"));
  assert.ok(!VOLATILE_PATHS.some((p) => p.includes("*")));
});

test("the same SDK and model is comparable", () => {
  const out = comparability(base(), { sdkVersion: "0.17.1", model: "QWEN3_4B_INST_Q4_K_M" });

  assert.equal(out.comparable, true);
});

test("a different SDK version is not comparable, and is not a failure", () => {
  // A runtime is entitled to change its sampling or its kernels between releases and none of
  // that is a defect. Reporting it as a failure puts a red mark on a certificate that is
  // fine, and after the second time nobody reads the red marks.
  const out = comparability(base(), { sdkVersion: "0.18.0", model: "QWEN3_4B_INST_Q4_K_M" });

  assert.equal(out.comparable, false);
  assert.match(out.reason, /0\.17\.1/);
  assert.match(out.reason, /0\.18\.0/);
  assert.ok(!/fail/i.test(out.reason), "not comparable is a third outcome, not a failure");
});

test("a different model is not comparable, naming both", () => {
  const out = comparability(base(), { sdkVersion: "0.17.1", model: "QWEN3_1_7B_INST_Q4" });

  assert.equal(out.comparable, false);
  assert.match(out.reason, /QWEN3_1_7B_INST_Q4/);
  assert.match(out.reason, /QWEN3_4B_INST_Q4_K_M/);
});

test("a patch-level SDK difference is still not comparable", () => {
  // Exact match rather than a semver range: a range would be this project claiming to know
  // which SDK changes affect output, which it does not know.
  assert.equal(comparability(base(),
    { sdkVersion: "0.17.2", model: "QWEN3_4B_INST_Q4_K_M" }).comparable, false);
});

const { parseArgs, findByDigest } = require("../scripts/replay");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { digestOf } = require("../lib/digest");

test("the documents flag takes its value out of the certificate list", () => {
  assert.deepEqual(parseArgs(["a.json", "--documents", "corpus"]),
    { files: ["a.json"], documentsDir: "corpus" });
  assert.deepEqual(parseArgs(["--documents", "corpus", "a.json", "b.json"]),
    { files: ["a.json", "b.json"], documentsDir: "corpus" });
});

test("an input is found by its digest, whatever it is called now", () => {
  // Resolving by digest rather than by the recorded path is what lets a certificate be
  // replayed on a machine that is not the one that made it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-replay-find-"));
  fs.writeFileSync(path.join(dir, "decoy.pdf"), "not it");
  fs.writeFileSync(path.join(dir, "renamed-by-someone-else.pdf"), "the invoice");

  const found = findByDigest(digestOf(Buffer.from("the invoice")), dir);

  assert.equal(path.basename(found), "renamed-by-someone-else.pdf");
});

test("an input that is not in the directory is reported as absent, not guessed at", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-replay-find-"));
  fs.writeFileSync(path.join(dir, "something.pdf"), "not it");

  assert.equal(findByDigest("f".repeat(64), dir), null);
});
