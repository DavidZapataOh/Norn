"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifyCertificate } = require("../scripts/verify-certificate");
const { TAMPERS } = require("../scripts/make-tampered");
const { buildCertificate } = require("../lib/certificate");
const { loadOrCreateKey, sign } = require("../lib/signing");
const { createTrace } = require("../lib/trace");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const amount = (key, minor, over = {}) => ({
  key, admitted: true, value: BigInt(minor), type: "amount",
  bbox: [10, 20, 90, 34], confidence: 0.9, width: "region",
  checks: { confidence: "passed", binding: "region", arithmetic: "passed" }, ...over,
});

function unsigned() {
  const trace = createTrace();
  for (const stage of ["route", "extract", "gate"]) {
    trace.append({ stage, action: stage, reads: ["document.bytes"],
                   writes: `document.${stage}`, digest: "b".repeat(64) });
  }

  return buildCertificate({
    document: { digest: "c".repeat(64), route: "text", page: 1 },
    currency: "EUR",
    run: {
      route: "text",
      declared: ["subtotal", "tax", "tax_rate", "total", "vendor"],
      fields: {
        subtotal: amount("subtotal", 43290),
        tax: amount("tax", 9091),
        total: amount("total", 52381),
        tax_rate: { key: "tax_rate", admitted: true, value: 21, type: "integer",
                    bbox: [1, 1, 2, 2], confidence: 0.9, width: "region",
                    checks: { confidence: "passed", binding: "region", arithmetic: "not checked" } },
        vendor: { key: "vendor", admitted: false, check: "confidence", reason: "read at 0.201",
                  value: "Northwind", type: "string", bbox: [10, 40, 90, 54],
                  confidence: 0.201, text: "Nortnwind" },
      },
      trace: { root: trace.root(), records: trace.records() },
    },
    verdict: { decision: "matched", variance: { minor: 100n, proportion: 0.0019 },
               record: { reference: "NW-1", currency: "EUR", amountMinor: 52281n },
               checks: [{ name: "amount agrees", outcome: "pass", detail: "within tolerance" }] },
    replay: { model: "QWEN3_4B_INST_Q4_K_M", quantisation: "Q4_K_M", sdkVersion: "0.17.1",
              seed: 4242, inputDigest: "c".repeat(64) },
    producedAt: "2026-08-23T00:00:00.000Z",
  });
}

const keyFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "norn-vk-")), "key.pem");
const clean = () => sign(unsigned(), loadOrCreateKey({ file: keyFile() }).privateKey);

test("the clean certificate passes every step it can run", () => {
  const result = verifyCertificate(clean());

  assert.equal(result.ok, true, JSON.stringify(result.steps, null, 2));
  for (const step of result.steps) {
    assert.notEqual(step.outcome, "fail", `${step.name}: ${step.detail}`);
  }
});

test("the arithmetic step recomputes the identities rather than reading the recorded verdict", () => {
  // The certificate says which checks ran. A tamperer edits those too. Recomputing from the
  // amounts in the document is the only version of this check that is worth anything.
  const step = verifyCertificate(clean()).steps.find((s) => s.name === "arithmetic");

  assert.equal(step.outcome, "pass");
  assert.match(step.detail, /subtotal \+ tax = total/);
  assert.deepEqual(step.needs, ["certificate"]);
});

test("an altered total fails arithmetic, not only the signature", () => {
  // The most consequential single edit anyone would make, and the one an independent check
  // can catch without the document.
  const cert = clean();
  cert.fields.total.minor = "62381";

  const failed = verifyCertificate(cert).steps.filter((s) => s.outcome === "fail").map((s) => s.name);

  assert.ok(failed.includes("arithmetic"), `failed at ${failed.join(", ")}`);
});

test("arithmetic is not checked when an operand was abstained, rather than passing", () => {
  // An identity built on a value the gate refused is an identity built on nothing. Reporting
  // it as passed would be the verifier inventing evidence.
  const cert = clean();
  delete cert.fields.tax;
  cert.abstentions.push({ key: "tax", check: "confidence", reason: "read at 0.2", type: "amount",
                          page: 1, bbox: null, confidence: 0.2, text: "90,91",
                          declined: { minor: "9091", currency: "EUR" } });

  const step = verifyCertificate(cert).steps.find((s) => s.name === "arithmetic");

  assert.equal(step.outcome, "not checked");
  assert.match(step.detail, /tax/);
});

test("attestations report not-applicable rather than being skipped", () => {
  // A verifier whose output has one fewer line when a feature is missing gives a reader no
  // way to tell a missing step from a silent pass.
  const step = verifyCertificate(clean()).steps.find((s) => s.name === "attestations");

  assert.equal(step.outcome, "not applicable");
  assert.match(step.detail, /not implemented/i);
});

test("steps declare what they need, and most need only the certificate", () => {
  // A lender has the certificate and does not have the invoice. A procedure whose every step
  // needed the document is a procedure that reader cannot run at all.
  const needs = Object.fromEntries(verifyCertificate(clean()).steps.map((s) => [s.name, s.needs]));

  assert.deepEqual(needs.signature, ["certificate"]);
  assert.deepEqual(needs.trace, ["certificate"]);
  assert.deepEqual(needs.sections, ["certificate"]);
  assert.deepEqual(needs.arithmetic, ["certificate"]);
  assert.deepEqual(needs.attestations, ["certificate"]);
  assert.deepEqual(needs.provenance, ["certificate", "document"]);
  assert.deepEqual(needs.replay, ["certificate", "document", "pipeline"]);
});

for (const tamper of TAMPERS) {
  test(`${tamper.name} is caught by ${tamper.caughtBy}`, () => {
    // caughtBy is declared beside the mutation, not read back from the verifier. Asking the
    // verifier which step caught it and asserting that step would agree with itself no matter
    // which step fired.
    const result = verifyCertificate(tamper.apply(structuredClone(clean())));

    assert.equal(result.ok, false, `${tamper.name} was not caught at all`);
    const failed = result.steps.filter((s) => s.outcome === "fail").map((s) => s.name);
    assert.ok(failed.includes(tamper.caughtBy),
      `${tamper.name}: expected ${tamper.caughtBy}, failed at ${failed.join(", ") || "nothing"}`);
  });
}

test("every tamper alters exactly one section of the certificate", () => {
  // A fixture that differs in two sections might be caught by the wrong step and still pass
  // its test, which would make "caught by X" unattributable. One section, not one path:
  // reversing three trace records changes eight leaves and is still a single change.
  const { compare } = require("../lib/replay");
  const original = clean();

  for (const tamper of TAMPERS) {
    const out = compare(original, tamper.apply(structuredClone(original)),
                        { volatilePaths: ["producedAt", "document.path"] });
    const sections = new Set(out.differences.map((d) => d.path.split(/[.[]/)[0]));

    assert.equal(sections.size, 1,
      `${tamper.name} altered ${[...sections].join(", ")}`);
    assert.ok(out.differences.length > 0, `${tamper.name} altered nothing`);
  }
});

test("each tamper declares whether anything but the signature can catch it", () => {
  // The honest half of this exercise. A confidence, a region and a seed are internally
  // consistent after editing: nothing but the signature knows. Saying so is what stops a
  // reader concluding that an unsigned certificate can still be checked.
  const signatureOnly = TAMPERS.filter((t) => t.caughtBy === "signature");

  assert.ok(signatureOnly.length > 0, "if nothing is signature-only, this claim needs revisiting");
  for (const tamper of signatureOnly) {
    assert.equal(typeof tamper.why, "string", `${tamper.name} does not say why`);
  }
});

test("a mutation that changes nothing is refused rather than written as a fixture", () => {
  // Found on a real corpus certificate: the document had no abstentions, so emptying the
  // array was a no-op and the fixture sat in the set proving nothing. A fixture that cannot
  // fail is worse than a missing one, because the set looks complete.
  const { applyTamper } = require("../scripts/make-tampered");
  const withoutAbstentions = clean();
  withoutAbstentions.abstentions = [];

  const removal = TAMPERS.find((t) => t.caughtBy === "sections");

  assert.throws(() => applyTamper(removal, withoutAbstentions), /changes nothing|no-op/i);
});

test("a mutation that does change something is applied", () => {
  const { applyTamper } = require("../scripts/make-tampered");
  const removal = TAMPERS.find((t) => t.caughtBy === "sections");

  assert.deepEqual(applyTamper(removal, clean()).abstentions, []);
});

const DOC = path.join(__dirname, "..", "..", "..", "docs", "verifying-a-certificate.md");

test("the written procedure states the coordinate space of a region", () => {
  // A box a reader cannot place on the page is not evidence, and placing it needs the origin,
  // the direction of the axes and the unit.
  const doc = fs.readFileSync(DOC, "utf8");

  assert.match(doc, /\[x0, y0, x1, y1\]/);
  assert.match(doc, /top-left/i);
  assert.match(doc, /y increases downward/i);
  assert.match(doc, /half a PDF point/i);
});

test("the written procedure states which steps need no document", () => {
  const doc = fs.readFileSync(DOC, "utf8");

  assert.match(doc, /need only the certificate/i);
});

test("the written procedure states the trust limit, not only the verifier", () => {
  const doc = fs.readFileSync(DOC, "utf8");

  assert.match(doc, /does not mean the signer is who they claim/i);
  assert.match(doc, /no key distribution|no revocation/i);
});

test("the written procedure names every step the verifier runs", () => {
  // A procedure that describes four of six steps leaves a reader unable to interpret the
  // other two, which is the same as not having documented them.
  const doc = fs.readFileSync(DOC, "utf8").toLowerCase();

  for (const step of verifyCertificate(clean()).steps) {
    assert.match(doc, new RegExp(`## \\d+\\. ${step.name}`),
      `the procedure has no section for the "${step.name}" step`);
  }
});

test("the written procedure names no artefact outside the repository", () => {
  const doc = fs.readFileSync(DOC, "utf8");

  assert.doesNotMatch(doc, /sprint|whitepaper|plan \d\d/i);
});

test("the written procedure has one section per step and no duplicates", () => {
  // A reordering edit left two copies of one section and every other test still passed: a
  // regex that asks whether a heading exists cannot see a second one.
  const headings = fs.readFileSync(DOC, "utf8").match(/^## \d+\. \w+/gm) ?? [];
  const names = headings.map((h) => h.replace(/^## \d+\. /, "").toLowerCase());

  assert.equal(new Set(names).size, names.length, `duplicated: ${names.join(", ")}`);
  assert.deepEqual(names, verifyCertificate(clean()).steps.map((s) => s.name),
    "the procedure's sections are not the verifier's steps, in order");
});
