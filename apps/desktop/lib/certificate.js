"use strict";
const { canonical } = require("./canonical");
const { digestOf, digestFile } = require("./digest");

// A certificate is meant to outlive the software that produced it. A verifier has to know what
// it is reading before it starts reading it, so the version is written from the first
// certificate rather than added when the format first changes.
const CERTIFICATE_VERSION = "1.0";

const REQUIRED_SECTIONS = ["version", "document", "declared", "verdict", "fields",
                           "abstentions", "attestations", "trace", "replay"];

// The route kinds the reader actually hands to the pipeline. "unsupported" is absent because
// a document that cannot be read produces no certificate. Named here so the published schema
// can be compared against it: a schema naming a route nothing emits would have a third party
// rejecting valid certificates.
const ROUTES = ["text", "image", "pdf-needs-render"];

// The canonicaliser refuses BigInt so that an amount cannot serialise as a label. The
// conversion happens here, once, in the place where the schema names the field a decimal
// string.
const minor = (value) => (value === null || value === undefined ? null : String(value));

function admittedField(field, { page, currency }) {
  const out = {
    key: field.key,
    type: field.type,
    page,
    bbox: field.bbox ?? null,
    confidence: field.confidence ?? null,
    width: field.width,
    checks: field.checks,
  };
  if (field.source) out.source = field.source;
  if (field.type === "amount") {
    out.minor = minor(field.value);
    out.currency = currency;
  } else {
    out.value = field.value;
  }
  return out;
}

function abstention(field, { page, currency }) {
  // The declined value travels with the abstention. Scoring abstentions against truth is what
  // stops caution looking free, and it cannot be done from a record that dropped the value.
  const declined = field.type === "amount"
    ? { minor: minor(field.value), currency }
    : { value: field.value ?? null };

  return {
    key: field.key,
    check: field.check,
    reason: field.reason,
    type: field.type,
    page,
    bbox: field.bbox ?? null,
    confidence: field.confidence ?? null,
    text: field.text ?? null,
    declined,
  };
}

function buildCertificate({ document, run, verdict, replay, currency = null,
                            producedAt = new Date().toISOString() }) {
  // Built from a completed run, never accumulated during one. There is no append here, so a
  // throw mid-run leaves no half-written document that reads as whole.
  if (!run?.trace?.root) throw new Error("the run carries no trace; a certificate without " +
    "one cannot say how its values were reached");

  const page = document.page ?? 1;
  const context = { page, currency };
  const fields = {};
  const abstentions = [];

  for (const field of Object.values(run.fields ?? {})) {
    if (field.admitted) fields[field.key] = admittedField(field, context);
    else abstentions.push(abstention(field, context));
  }

  return {
    version: CERTIFICATE_VERSION,
    producedAt,
    // What the template asked for. Fields plus abstentions must account for exactly this, so
    // a deleted abstention leaves a hole a verifier can name rather than a document that is
    // internally consistent and quietly incomplete.
    declared: run.declared ?? [],
    document: {
      digest: document.digest,
      path: document.path ?? null,
      route: document.route,
      // Every reader is page one: the geometry reads getPage(1) and the rasteriser renders
      // the first page. Recorded rather than varied, so the document does not imply support
      // that is not here.
      page,
      // The page's extent in the same units as every bbox. A box a reader cannot place on
      // the page is not evidence, and it also makes "is this region even on the page" a
      // question the verifier can answer.
      width: run.page?.width ?? null,
      height: run.page?.height ?? null,
    },
    verdict: {
      decision: verdict.decision,
      checks: verdict.checks,
      variance: verdict.variance
        ? { minor: minor(verdict.variance.minor), proportion: verdict.variance.proportion }
        : null,
      record: verdict.record
        ? { reference: verdict.record.reference, currency: verdict.record.currency,
            minor: minor(verdict.record.amountMinor) }
        : null,
    },
    fields,
    abstentions,
    // Empty rather than absent: a reader cannot tell a missing feature from a step that
    // passed silently, and the absence costs one line to state.
    attestations: [],
    // The completed run's own shape, taken whole. A builder that called a live trace object
    // would only work when invoked from inside the run it is certifying.
    trace: { root: run.trace.root, records: run.trace.records },
    replay: {
      model: replay.model,
      quantisation: replay.quantisation,
      sdkVersion: replay.sdkVersion,
      seed: replay.seed,
      inputDigest: replay.inputDigest,
    },
  };
}

// The one construction, used by the original run and by its replay. If the two were built by
// different code, a difference between the certificates would be a difference between the
// builders, and replay would be measuring the wrong thing.
function certifyRun({ file, run, verdict, currency = null, sdkVersion, seed, producedAt }) {
  const digest = digestFile(file);
  return buildCertificate({
    document: { digest, path: file, route: run.route, page: 1 },
    run,
    verdict,
    currency,
    replay: {
      model: run.model,
      quantisation: run.quantisation,
      sdkVersion,
      seed,
      // The same bytes as document.digest today. Kept as its own field because a later format
      // may let them differ, and a descriptor pointing at a different file than the document
      // section describes would replay something other than what the certificate is about.
      inputDigest: digest,
    },
    ...(producedAt ? { producedAt } : {}),
  });
}

// Over everything except the signature, so signing does not change what was signed. The
// canonical form rather than JSON.stringify, so a certificate that survived a round trip
// through another program's writer is still the same document.
function certificateDigest(certificate) {
  const { signature, ...rest } = certificate;
  return digestOf(canonical(rest));
}


const DESCRIPTOR_FIELDS = ["model", "quantisation", "sdkVersion", "seed", "inputDigest"];
const DIGITS = /^-?[0-9]+$/;

// Hand-written rather than a JSON Schema validator: Node ships none, this project has three
// runtime dependencies, and adding one to check a document this project also writes buys a
// dependency and little assurance. The published schema is kept honest by a test that derives
// the required section set from both and compares them.
//
// Problems are sentences that name their path. A boolean would report that something is wrong
// without saying what, which is the thing this whole artefact exists to avoid.
function validate(certificate) {
  const problems = [];
  const say = (message) => problems.push(message);

  if (certificate?.version !== CERTIFICATE_VERSION) {
    say(`version is "${certificate?.version}", and this checker reads ${CERTIFICATE_VERSION}`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (certificate?.[section] === undefined) say(`the certificate has no "${section}" section`);
  }
  if (problems.length) return { ok: false, problems };

  const abstained = new Set(certificate.abstentions.map((a) => a.key));
  for (const key of Object.keys(certificate.fields)) {
    if (abstained.has(key)) {
      // The distinction between a value that was read and one that was refused is what the
      // product's central claim rests on. A field in both sections says both at once.
      say(`"${key}" appears in both fields and abstentions`);
    }
  }

  const declared = new Set(certificate.declared ?? []);
  const accounted = new Set([...Object.keys(certificate.fields), ...abstained]);
  for (const key of declared) {
    if (!accounted.has(key)) {
      say(`"${key}" was declared and is neither admitted nor abstained; the certificate does ` +
        "not say what became of it");
    }
  }
  for (const key of accounted) {
    if (declared.size && !declared.has(key)) {
      say(`"${key}" appears in the certificate and was never declared`);
    }
  }

  for (const [key, field] of Object.entries(certificate.fields)) {
    if (field.type === "amount" && !DIGITS.test(String(field.minor ?? ""))) {
      say(`fields.${key}.minor is ${JSON.stringify(field.minor)}, not minor units as decimal digits`);
    }
    if (field.type === "amount" && typeof field.minor !== "string") {
      say(`fields.${key}.minor is a ${typeof field.minor}; an amount is carried as a string`);
    }
    // An admitted value that cannot be located on the page is the fabrication the pipeline
    // exists to refuse. A certificate must not be able to state one without saying so.
    if (!Array.isArray(field.bbox) && field.unbound !== true) {
      say(`fields.${key} was admitted with no region and is not marked unbound`);
    }
    const { width, height } = certificate.document ?? {};
    if (Array.isArray(field.bbox) && typeof width === "number" && typeof height === "number") {
      const [x0, y0, x1, y1] = field.bbox;
      if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) {
        say(`fields.${key} has a region [${field.bbox.join(", ")}] that is not inside the ` +
          `${width} by ${height} page`);
      }
    }
  }

  for (const abstention of certificate.abstentions) {
    if (!abstention.check) say(`abstentions["${abstention.key}"] names no check that refused it`);
    if (abstention.declined === undefined) {
      say(`abstentions["${abstention.key}"] carries no declined value, so it cannot be scored`);
    }
  }

  for (const field of DESCRIPTOR_FIELDS) {
    if (certificate.replay?.[field] === undefined) {
      say(`replay.${field} is missing, so the descriptor is not sufficient to reproduce the run`);
    }
  }

  if (!ROUTES.includes(certificate.document?.route)) {
    say(`document.route is "${certificate.document?.route}", which is not a route this ` +
      `reader produces (${ROUTES.join(", ")})`);
  }

  if (!/^[0-9a-f]{64}$/.test(certificate.trace?.root ?? "")) {
    say("trace.root is not a sha-256 digest");
  }

  return { ok: problems.length === 0, problems };
}

module.exports = { buildCertificate, certifyRun, certificateDigest, validate,
                   CERTIFICATE_VERSION, REQUIRED_SECTIONS, ROUTES };
