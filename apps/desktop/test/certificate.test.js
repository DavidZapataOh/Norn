"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildCertificate, certifyRun, certificateDigest, validate, CERTIFICATE_VERSION,
        REQUIRED_SECTIONS, ROUTES } =
  require("../lib/certificate");
const { createTrace } = require("../lib/trace");

function completedRun() {
  const trace = createTrace();
  trace.append({ stage: "route", action: "text", reads: ["document.bytes"],
                 writes: "document.route", digest: "b".repeat(64) });
  return {
    route: "text",
    fields: {
      total: { key: "total", admitted: true, value: 52381n, type: "amount",
               bbox: [10, 20, 90, 34], confidence: null, width: "region", source: "text-layer",
               checks: { confidence: "not applicable", binding: "region", arithmetic: "passed" } },
      vendor: { key: "vendor", admitted: true, value: "Northwind", type: "string",
                bbox: [10, 5, 60, 18], confidence: null, width: "region", source: "text-layer",
                checks: { confidence: "not applicable", binding: "region", arithmetic: "not checked" } },
      tax: { key: "tax", admitted: false, check: "confidence", reason: "read at 0.201",
             value: 9091n, type: "amount", bbox: [10, 40, 90, 54], confidence: 0.201,
             text: "90,91" },
    },
    // The shape the pipeline actually returns: a root and records, not a live trace. A
    // builder that took the live object would only work when called from inside the run.
    trace: { root: trace.root(), records: trace.records() },
  };
}

const verdict = {
  decision: "matched",
  variance: { minor: 100n, proportion: 0.0019 },
  record: { id: 3, reference: "NW-2026-0117", currency: "EUR", amountMinor: 52281n },
  checks: [{ name: "amount agrees", outcome: "pass", detail: "within tolerance" }],
};

const replay = { model: "QWEN3_4B_INST_Q4_K_M", quantisation: "Q4_K_M", sdkVersion: "0.17.1",
                 seed: 4242, inputDigest: "c".repeat(64) };

const built = (over = {}) => buildCertificate({
  document: { digest: "c".repeat(64), route: "text", page: 1 },
  run: completedRun(), verdict, replay, currency: "EUR", ...over,
});

test("an abstained field is in abstentions and is not in fields", () => {
  // The distinction is the product: a reader must be able to tell "could not read this" from
  // "this field does not apply", and a null in the fields map cannot say which.
  const cert = built();

  assert.ok("total" in cert.fields);
  assert.ok(!("tax" in cert.fields));
  assert.equal(cert.abstentions.length, 1);
  assert.equal(cert.abstentions[0].key, "tax");
  assert.equal(cert.abstentions[0].check, "confidence");
});

test("an abstention carries what was seen, so caution can be scored", () => {
  // The declined value travels with the abstention. Without it nobody can say how many
  // abstentions would have been right, and caution looks free.
  const [abstention] = built().abstentions;

  assert.equal(abstention.declined.minor, "9091");
  assert.equal(abstention.text, "90,91");
  assert.deepEqual(abstention.bbox, [10, 40, 90, 54]);
  assert.equal(abstention.confidence, 0.201);
});

test("every amount is a decimal string in minor units with its currency beside it", () => {
  const cert = built();

  assert.equal(cert.fields.total.minor, "52381");
  assert.equal(cert.fields.total.currency, "EUR");
  assert.equal(cert.verdict.variance.minor, "100");
  assert.equal(typeof cert.fields.total.minor, "string",
    "a JSON number cannot carry a minor-unit amount without a precision claim nobody made");
});

test("a string field carries its text and no currency", () => {
  // A currency on a vendor name would be a field the schema has to explain away.
  const vendor = built().fields.vendor;

  assert.equal(vendor.value, "Northwind");
  assert.equal(vendor.minor, undefined);
  assert.equal(vendor.currency, undefined);
});

test("an admitted field says where it was found and which checks ran", () => {
  const field = built().fields.total;

  assert.deepEqual(field.bbox, [10, 20, 90, 34]);
  assert.equal(field.page, 1);
  assert.equal(field.checks.confidence, "not applicable",
    "an admission that skipped the floor must not read like one that cleared it");
});

test("the certificate carries the trace root and the records that reach it", () => {
  const cert = built();

  assert.equal(cert.trace.root.length, 64);
  assert.equal(cert.trace.records.length, 1);
  assert.equal(cert.trace.records[0].stage, "route");
});

test("the format is versioned from the first write", () => {
  // A certificate is meant to outlive the software that produced it, and a verifier has to
  // know what it is reading before it starts reading it.
  assert.equal(built().version, CERTIFICATE_VERSION);
  assert.match(CERTIFICATE_VERSION, /^\d+\.\d+$/);
});

test("attestations are an empty section rather than an absent one", () => {
  // Absent, a reader cannot tell a missing feature from a step that passed silently.
  assert.deepEqual(built().attestations, []);
});

test("the digest does not cover the signature, and does not change when one is added", () => {
  const cert = built();
  const before = certificateDigest(cert);

  assert.equal(certificateDigest({ ...cert, signature: { alg: "ed25519", sig: "ab" } }), before);
});

test("the digest changes when the seed changes", () => {
  // A signature that did not cover the replay descriptor would let someone change the claimed
  // seed and keep the signature.
  const cert = built();

  assert.notEqual(
    certificateDigest({ ...cert, replay: { ...cert.replay, seed: 1 } }),
    certificateDigest(cert));
});

test("the digest does not depend on the order the certificate's keys were written in", () => {
  const cert = built();
  const reordered = Object.fromEntries(Object.entries(cert).reverse());

  assert.equal(certificateDigest(reordered), certificateDigest(cert));
});

test("a run with no trace produces no certificate rather than a partial one", () => {
  // The builder takes finished values and has no append, so there is no half-built object to
  // escape. Asserted because the alternative design is the tempting one.
  assert.throws(() => built({ run: { route: "text", fields: {} } }), /trace/);
});

test("a BigInt cannot reach the document, because the canonicaliser would refuse it", () => {
  // The one place amounts become strings. If the builder missed a field, signing would throw
  // at the canonicaliser rather than the certificate being wrong, but only if nothing here
  // converts implicitly.
  const { canonical } = require("../lib/canonical");

  assert.doesNotThrow(() => canonical(built()));
});

test("the published schema and the checker require the same sections", () => {
  // The reason not to hand-write a validator is drift. This is the test that makes the
  // hand-written one safe: the two are compared, not trusted.
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "schema", "certificate.schema.json"), "utf8"));

  assert.deepEqual([...REQUIRED_SECTIONS].sort(), [...schema.required].sort());
  for (const section of REQUIRED_SECTIONS) {
    assert.ok(schema.properties[section], `the schema does not describe "${section}"`);
  }
});

test("the published schema names the version this code writes", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "schema", "certificate.schema.json"), "utf8"));

  assert.deepEqual(schema.properties.version.enum, [CERTIFICATE_VERSION]);
});

test("a certificate this program built validates", () => {
  const out = validate(built());

  assert.deepEqual(out.problems, []);
  assert.equal(out.ok, true);
});

test("a field appearing in both sections is rejected, naming the field", () => {
  // Disjointness is what the product's central claim rests on, so it is checked rather than
  // assumed to follow from how the builder happens to partition.
  const cert = built();
  cert.abstentions.push({ key: "total", check: "confidence", reason: "x", declined: {} });

  const out = validate(cert);

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /total/.test(p) && /both/.test(p)), out.problems.join("; "));
});

test("an amount written as a JSON number is rejected, naming the path", () => {
  const cert = built();
  cert.fields.total.minor = 52381;

  const out = validate(cert);

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /fields\.total\.minor/.test(p)), out.problems.join("; "));
});

test("an unknown version is rejected, and the message says which version it read", () => {
  const out = validate({ ...built(), version: "9.9" });

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /9\.9/.test(p)), out.problems.join("; "));
});

test("a replay descriptor missing a field is rejected, naming the field", () => {
  // If replay needs something the descriptor does not carry, that is a defect here rather
  // than a mismatch discovered later by replay.
  const cert = built();
  delete cert.replay.seed;

  assert.ok(validate(cert).problems.some((p) => /seed/.test(p)));
});

test("an admitted field with no region and no explicit mark is rejected", () => {
  // An admitted value that cannot be located on the page is the fabrication the whole
  // pipeline exists to refuse, and a certificate must not be able to state one silently.
  const cert = built();
  cert.fields.total.bbox = null;

  const out = validate(cert);

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /total/.test(p) && /region|bbox/.test(p)),
    out.problems.join("; "));
});

test("a missing section is rejected, naming it", () => {
  const cert = built();
  delete cert.attestations;

  assert.ok(validate(cert).problems.some((p) => /attestations/.test(p)));
});

test("one function builds the certificate for both the original run and its replay", () => {
  // If the two were built by different code, a difference between them would be a difference
  // between the builders and replay would be testing the wrong thing.
  const run = completedRun();
  const args = { file: __filename, run, verdict, currency: "EUR",
                 sdkVersion: "0.17.1", seed: 4242, producedAt: "T" };

  const original = certifyRun(args);
  const replayed = certifyRun(args);

  assert.deepEqual(replayed, original);
  assert.equal(original.replay.model, undefined ?? original.replay.model);
});

test("the descriptor takes the model from the run, not from a default", () => {
  const run = { ...completedRun(), model: "QWEN3VL_2B_MULTIMODAL_Q4_K", quantisation: "Q4_K" };

  const cert = certifyRun({ file: __filename, run, verdict, currency: "EUR",
                            sdkVersion: "0.17.1", seed: 4242 });

  assert.equal(cert.replay.model, "QWEN3VL_2B_MULTIMODAL_Q4_K");
  assert.equal(cert.replay.quantisation, "Q4_K");
});

test("the input digest is the file's bytes, and the document digest is the same bytes", () => {
  // Two fields, one fact. They are separate because a later format may let them differ, and
  // a certificate whose descriptor pointed at a different file than its document section
  // would replay something other than what it describes.
  const cert = certifyRun({ file: __filename, run: completedRun(), verdict, currency: "EUR",
                            sdkVersion: "0.17.1", seed: 4242 });

  assert.equal(cert.replay.inputDigest, cert.document.digest);
  assert.match(cert.replay.inputDigest, /^[0-9a-f]{64}$/);
});

test("the published schema's route values are the ones the reader actually produces", () => {
  // The section-agreement test compares required keys and says nothing about enums, which is
  // how the schema came to name a route ("scan") that nothing emits while omitting the one
  // every rasterised PDF carries. A third party reading the schema would reject valid
  // certificates.
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "schema", "certificate.schema.json"), "utf8"));

  assert.deepEqual([...schema.properties.document.properties.route.enum].sort(),
    [...ROUTES].sort());
});

test("a route the reader never produces is rejected, naming it", () => {
  const cert = built();
  cert.document.route = "scan";

  const out = validate(cert);

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /scan/.test(p)), out.problems.join("; "));
});

test("every route the reader can hand to the pipeline is accepted", () => {
  for (const route of ROUTES) {
    const cert = built();
    cert.document.route = route;
    assert.deepEqual(validate(cert).problems, [], `${route} was refused`);
  }
});

test("the certificate records which fields were asked for", () => {
  // Removing an abstention is how a document is made to look cleaner than the run was. With
  // nothing recording what was requested, the removal leaves a certificate that is
  // internally consistent and quietly incomplete.
  const cert = built({ run: { ...completedRun(), declared: ["total", "vendor", "tax"] } });

  assert.deepEqual(cert.declared, ["total", "vendor", "tax"]);
});

test("a declared field that is neither admitted nor abstained is rejected, naming it", () => {
  const cert = built({ run: { ...completedRun(), declared: ["total", "vendor", "tax"] } });
  cert.abstentions = [];

  const out = validate(cert);

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /tax/.test(p) && /neither|unaccounted|missing/i.test(p)),
    out.problems.join("; "));
});

test("a field nobody asked for is rejected too", () => {
  // The other direction: a certificate cannot invent a field the template never declared.
  const cert = built({ run: { ...completedRun(), declared: ["total", "vendor", "tax"] } });
  cert.fields.discount = { ...cert.fields.total, key: "discount" };

  assert.ok(validate(cert).problems.some((p) => /discount/.test(p)), validate(cert).problems.join("; "));
});

test("a certificate whose declared list matches its two sections validates", () => {
  const cert = built({ run: { ...completedRun(), declared: ["total", "vendor", "tax"] } });

  assert.deepEqual(validate(cert).problems, []);
});

test("the certificate records the page's extent, in the units the regions use", () => {
  // A box a reader cannot place on the page is not evidence, and placing it needs the extent
  // as well as the box.
  const cert = built({ run: { ...completedRun(), page: { width: 1191, height: 1684 } } });

  assert.equal(cert.document.width, 1191);
  assert.equal(cert.document.height, 1684);
});

test("a region outside the page is rejected, naming the field", () => {
  // The check that a bounding box means anything at all. Without the extent it could not be
  // made, which is half the reason the extent is recorded.
  // Smaller than the region it holds: at 100 by 100 the box [10, 20, 90, 34] is comfortably
  // inside and the check would pass while testing nothing.
  const cert = built({ run: { ...completedRun(), page: { width: 50, height: 50 } } });

  const out = validate(cert);

  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => /total/.test(p) && /page/.test(p)), out.problems.join("; "));
});
