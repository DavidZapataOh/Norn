"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonical } = require("../lib/canonical");

// This script is deliberately not built from the modules that produce certificates. Its checks
// are a second implementation of the same rules, which is duplicated logic on purpose: a bug
// shared with the producer would pass both sides, and a check that only runs inside the thing
// being checked is not much of a check.
//
// The canonicaliser is the one thing it does share, and it has to be: the signature is over
// that function's output. It imports nothing, which is what makes sharing it safe.

const GENESIS = crypto.createHash("sha256").update("norn-trace-genesis").digest("hex");
const READS_VERSION = "1.0";
const DESCRIPTOR_FIELDS = ["model", "quantisation", "sdkVersion", "seed", "inputDigest"];

const TRUST_LIMIT = [
  "A valid signature proves this certificate was not altered after signing. It does not",
  "prove the signer is who they claim: the public key travels inside the certificate, there",
  "is no key distribution and no revocation, and nothing here has seen this key before.",
];

const digestOf = (text) => crypto.createHash("sha256").update(text).digest("hex");

function checkSignature(certificate) {
  const { signature, ...unsigned } = certificate;
  if (!signature) return { outcome: "fail", detail: "the certificate carries no signature" };
  if (signature.alg !== "ed25519") {
    return { outcome: "fail", detail: `unknown signature algorithm "${signature.alg}"` };
  }

  const body = canonical(unsigned);
  const digest = digestOf(body);
  if (digest !== signature.digest) {
    return { outcome: "fail",
             detail: `the content digests to ${digest.slice(0, 12)} and the signature claims ` +
                     `${String(signature.digest).slice(0, 12)}` };
  }

  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(body, "utf8"),
                       crypto.createPublicKey(signature.publicKey),
                       Buffer.from(signature.sig, "base64"));
  } catch (error) {
    return { outcome: "fail", detail: `the signature could not be checked: ${error.message}` };
  }

  const fingerprint = digestOf(signature.publicKey).slice(0, 8);
  return ok
    ? { outcome: "pass", detail: `ed25519, key ${fingerprint}` }
    : { outcome: "fail", detail: `the signature does not match the content (key ${fingerprint})` };
}

function checkTrace(certificate) {
  const records = certificate.trace?.records;
  if (!Array.isArray(records)) return { outcome: "fail", detail: "the certificate carries no trace" };

  let head = GENESIS;
  for (const [i, record] of records.entries()) {
    const { head: recorded, ...linked } = record;
    head = crypto.createHash("sha256").update(head).update(canonical(linked)).digest("hex");
    if (head !== recorded) {
      // Which record, not merely that the chain broke. "The chain is broken" is a starting
      // point; "record 3 does not follow record 2" is a finding.
      return { outcome: "fail",
               detail: `record ${i} (${record.stage}) does not follow the one before it` };
    }
  }

  if (head !== certificate.trace.root) {
    return { outcome: "fail", detail: "the records chain cleanly but do not reach the recorded root" };
  }
  return { outcome: "pass", detail: `${records.length} records, root ${head.slice(0, 12)}` };
}

// Two cents, matching the producer's tolerance. It exists for the rounding of a percentage and
// nothing else: one large enough to swallow a transposed digit is a tolerance that defeats the
// check.
const TOLERANCE_MINOR = 2n;
const abs = (x) => (x < 0n ? -x : x);

// Recomputed from the amounts in the document, not read from the checks the certificate
// records. A tamperer edits those too, and a step that believed them would be checking that
// the certificate agrees with itself.
//
// This is the only step besides the signature that can catch an altered amount, and it is the
// one a reader can run without the invoice.
function checkArithmetic(certificate) {
  const fields = certificate.fields ?? {};
  const minorOf = (key) => {
    const field = fields[key];
    if (!field || typeof field.minor !== "string") return null;
    return BigInt(field.minor);
  };

  const subtotal = minorOf("subtotal");
  const tax = minorOf("tax");
  const total = minorOf("total");
  const rate = typeof fields.tax_rate?.value === "number" ? BigInt(fields.tax_rate.value) : null;

  const identities = [];
  if (subtotal !== null && tax !== null && total !== null) {
    const difference = subtotal + tax - total;
    identities.push({ name: "subtotal + tax = total", ok: abs(difference) <= TOLERANCE_MINOR,
                      detail: `off by ${difference} minor units` });
  }
  if (subtotal !== null && tax !== null && rate !== null) {
    // Basis points keep the multiplication in integers, so the only rounding left is the one
    // the document itself performed.
    const difference = tax - (subtotal * rate * 100n) / 10000n;
    identities.push({ name: "tax = subtotal x rate", ok: abs(difference) <= TOLERANCE_MINOR,
                      detail: `off by ${difference} minor units` });
  }

  if (identities.length === 0) {
    // An identity built on a value the gate refused is an identity built on nothing.
    // Reporting it as passed would be the verifier inventing evidence.
    const missing = ["subtotal", "tax", "total"].filter((k) => minorOf(k) === null);
    return { outcome: "not checked",
             detail: missing.length
               ? `no identity is available: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not among the admitted amounts`
               : "this document states no amounts the identities apply to" };
  }

  const broken = identities.filter((i) => !i.ok);
  return broken.length
    ? { outcome: "fail",
        detail: broken.map((i) => `${i.name} does not hold: ${i.detail}`).join("; ") }
    : { outcome: "pass", detail: identities.map((i) => i.name).join(", ") };
}

function checkSections(certificate) {
  const problems = [];
  const fields = certificate.fields ?? {};
  const abstentions = certificate.abstentions ?? [];

  if (certificate.version !== READS_VERSION) {
    problems.push(`version is "${certificate.version}" and this verifier reads ${READS_VERSION}`);
  }

  const abstained = new Set(abstentions.map((a) => a.key));
  for (const key of Object.keys(fields)) {
    if (abstained.has(key)) problems.push(`"${key}" appears in both fields and abstentions`);
  }

  // Fields plus abstentions must account for exactly what was declared. Without this a
  // deleted abstention leaves a certificate that is internally consistent and quietly
  // incomplete, which is precisely how a document is made to look cleaner than the run was.
  const declared = new Set(certificate.declared ?? []);
  const accounted = new Set([...Object.keys(fields), ...abstained]);
  for (const key of declared) {
    if (!accounted.has(key)) {
      problems.push(`"${key}" was declared and the certificate does not say what became of it`);
    }
  }
  for (const key of accounted) {
    if (declared.size && !declared.has(key)) {
      problems.push(`"${key}" appears in the certificate and was never declared`);
    }
  }

  for (const [key, field] of Object.entries(fields)) {
    // An admitted value that cannot be located on the page is the thing the whole pipeline
    // exists to refuse. Removing an abstention leaves exactly this shape behind.
    if (!Array.isArray(field.bbox) && field.unbound !== true) {
      problems.push(`"${key}" was admitted with no region and is not marked unbound`);
    }
    if (field.type === "amount" && typeof field.minor !== "string") {
      problems.push(`"${key}" carries its amount as a ${typeof field.minor}, not a decimal string`);
    }
  }

  for (const abstention of abstentions) {
    if (!abstention.check) problems.push(`the abstention for "${abstention.key}" names no check`);
    if (abstention.declined === undefined) {
      problems.push(`the abstention for "${abstention.key}" carries no declined value`);
    }
  }

  return problems.length
    ? { outcome: "fail", detail: problems.join("; ") }
    : { outcome: "pass",
        detail: `${Object.keys(fields).length} fields, ${abstentions.length} abstentions, ` +
                `disjoint, accounting for all ${declared.size || accounted.size} declared` };
}

function checkDescriptor(certificate) {
  const replay = certificate.replay ?? {};
  const missing = DESCRIPTOR_FIELDS.filter((f) => replay[f] === undefined);
  if (missing.length) {
    return { outcome: "fail",
             detail: `the descriptor is missing ${missing.join(", ")}, so the run cannot be reproduced` };
  }
  return { outcome: "pass",
           detail: `${replay.model} ${replay.quantisation}, sdk ${replay.sdkVersion}, seed ${replay.seed}` };
}

function checkProvenance(certificate, { documentPath } = {}) {
  const fields = Object.entries(certificate.fields ?? {});

  if (!documentPath) {
    // A lender holds the certificate and not the invoice. That is not a failure, and reporting
    // it as one would put a red mark on a document that is fine.
    return { outcome: "not checked",
             detail: "no document was supplied; pass --document <path> to list the regions to inspect",
             fields: [] };
  }

  const digest = digestOf(fs.readFileSync(documentPath));
  if (digest !== certificate.document?.digest) {
    return { outcome: "fail",
             detail: `${path.basename(documentPath)} digests to ${digest.slice(0, 12)} and the ` +
                     `certificate describes ${String(certificate.document?.digest).slice(0, 12)}`,
             fields: [] };
  }

  // This script does not crop. Rasterising would pull a browser engine into a verifier whose
  // whole point is having no dependencies, so it reports where to look and what to expect and
  // leaves the comparison to the reader.
  return {
    outcome: "pass",
    detail: `the document matches; ${fields.length} regions to inspect by eye`,
    fields: fields.map(([key, field]) => ({
      key, page: field.page, bbox: field.bbox,
      expect: field.type === "amount" ? `${field.minor} ${field.currency ?? ""}`.trim()
                                      : String(field.value),
    })),
  };
}

function verifyCertificate(certificate, options = {}) {
  const steps = [
    { name: "signature", needs: ["certificate"], ...checkSignature(certificate) },
    { name: "provenance", needs: ["certificate", "document"], ...checkProvenance(certificate, options) },
    // Reported rather than skipped. A verifier whose output has four lines when a feature is
    // missing and five when it is present gives a reader no way to tell a missing step from a
    // step that passed silently.
    { name: "attestations", needs: ["certificate"],
      outcome: (certificate.attestations ?? []).length ? "fail" : "not applicable",
      detail: (certificate.attestations ?? []).length
        ? "this certificate carries attestations and this verifier cannot check them"
        : "external facts are not implemented, and this certificate claims none" },
    { name: "arithmetic", needs: ["certificate"], ...checkArithmetic(certificate) },
    { name: "trace", needs: ["certificate"], ...checkTrace(certificate) },
    { name: "sections", needs: ["certificate"], ...checkSections(certificate) },
    { name: "descriptor", needs: ["certificate"], ...checkDescriptor(certificate) },
    { name: "replay", needs: ["certificate", "document", "pipeline"], outcome: "not checked",
      detail: "run the replay script; this verifier deliberately cannot load a model" },
  ];

  return { ok: steps.every((s) => s.outcome !== "fail"), steps };
}

function report(name, result) {
  console.log(`\n${name}`);
  for (const step of result.steps) {
    console.log(`  ${step.name.padEnd(13)} ${step.outcome.padEnd(15)} ${step.detail}`);
  }
  for (const field of result.steps.find((s) => s.name === "provenance").fields ?? []) {
    console.log(`      ${field.key.padEnd(12)} page ${field.page} ` +
      `[${(field.bbox ?? []).join(", ")}]  expect ${field.expect}`);
  }
}

function parseArgs(argv) {
  const documentIndex = argv.indexOf("--document");
  const documentPath = documentIndex === -1 ? undefined : argv[documentIndex + 1];
  // Guarded on -1 rather than arithmetic on it: computing documentIndex + 1 when the flag is
  // absent excludes argument zero, which silently ate the only certificate path.
  const valueIndex = documentIndex === -1 ? -1 : documentIndex + 1;
  const files = argv.filter((arg, i) => !arg.startsWith("--") && i !== valueIndex);
  return { files, documentPath };
}

function main(argv) {
  const { files, documentPath } = parseArgs(argv);

  if (files.length === 0) {
    console.error("usage: verify-certificate.js <certificate.json>... [--document <path>]");
    return 2;
  }

  let failed = 0;
  for (const file of files) {
    const certificate = JSON.parse(fs.readFileSync(file, "utf8"));
    const result = verifyCertificate(certificate, { documentPath });
    report(path.basename(file), result);
    if (!result.ok) failed++;
  }

  console.log(`\n${TRUST_LIMIT.map((l) => `  ${l}`).join("\n")}`);
  // The exit code, not only the printed lines. A verifier that prints "fail" and exits zero
  // has told a human and lied to a script.
  return failed === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { verifyCertificate, parseArgs, TRUST_LIMIT };
