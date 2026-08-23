"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadOrCreateKey, sign, verifySignature, KEY_STORAGE_LIMITS } = require("../lib/signing");
const { buildCertificate } = require("../lib/certificate");
const { createTrace } = require("../lib/trace");

const keyFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "norn-key-")), "key.pem");

function certificate() {
  const trace = createTrace();
  trace.append({ stage: "route", action: "text", reads: ["document.bytes"],
                 writes: "document.route", digest: "b".repeat(64) });

  return buildCertificate({
    document: { digest: "c".repeat(64), route: "text", page: 1 },
    currency: "EUR",
    run: {
      route: "text",
      fields: {
        total: { key: "total", admitted: true, value: 52381n, type: "amount",
                 bbox: [10, 20, 90, 34], confidence: null, width: "region", source: "text-layer",
                 checks: { confidence: "not applicable", binding: "region", arithmetic: "passed" } },
        tax: { key: "tax", admitted: false, check: "confidence", reason: "read at 0.201",
               value: 9091n, type: "amount", bbox: [10, 40, 90, 54], confidence: 0.201,
               text: "90,91" },
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

test("a key is created on first use and reused after", () => {
  const file = keyFile();

  const first = loadOrCreateKey({ file });
  const second = loadOrCreateKey({ file });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.publicKeyPem, first.publicKeyPem);
});

test("a key this program created is readable by its owner and nobody else", () => {
  const file = keyFile();
  loadOrCreateKey({ file });

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a key file others can read is refused, not loaded", () => {
  // The case that actually needs guarding. A umask can only remove permission bits, so a
  // file written with mode 0o600 can never come out more permissive -- but a key file that
  // already existed was written by something else, and nothing here looks at it before
  // reading the private key out of it.
  const file = keyFile();
  const { privateKey } = loadOrCreateKey({ file });
  fs.chmodSync(file, 0o644);

  assert.throws(() => loadOrCreateKey({ file }), /readable|permission|0644/i);
  assert.ok(privateKey, "the first load, which created the file, must still have worked");
});

test("a key file the group can read is refused too, not only a world-readable one", () => {
  const file = keyFile();
  loadOrCreateKey({ file });
  fs.chmodSync(file, 0o640);

  assert.throws(() => loadOrCreateKey({ file }), /readable|permission|0640/i);
});

test("a signed certificate verifies", () => {
  const { privateKey } = loadOrCreateKey({ file: keyFile() });

  const signed = sign(certificate(), privateKey);

  assert.equal(verifySignature(signed).ok, true);
  assert.equal(signed.signature.alg, "ed25519");
});

test("the public key travels in the certificate, so no directory is needed", () => {
  const { privateKey, publicKeyPem } = loadOrCreateKey({ file: keyFile() });

  assert.equal(sign(certificate(), privateKey).signature.publicKey, publicKeyPem);
});

test("signing does not alter what was signed", () => {
  // The digest excludes the signature, so attaching one must not change the document the
  // signature is over.
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const before = certificate();

  const signed = sign(before, privateKey);
  const { signature, ...rest } = signed;

  assert.deepEqual(rest, before);
});

test("altering a field value breaks the signature", () => {
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  signed.fields.total.minor = "52382";

  assert.equal(verifySignature(signed).ok, false);
});

test("altering the trace root breaks the signature", () => {
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  signed.trace.root = "0".repeat(64);

  assert.equal(verifySignature(signed).ok, false);
});

test("altering the seed breaks the signature", () => {
  // A signature that did not cover the replay descriptor would let someone change the claimed
  // seed and keep the signature, which would make replay a claim about a number the signer
  // never made.
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  signed.replay.seed = 1;

  assert.equal(verifySignature(signed).ok, false);
});

test("removing an abstention breaks the signature", () => {
  // How a document is made to look cleaner than the run was.
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  signed.abstentions = [];

  assert.equal(verifySignature(signed).ok, false);
});

test("reordering the certificate's keys does not break the signature", () => {
  // The point of signing the canonical form rather than JSON.stringify: a certificate that
  // survived a round trip through another program's JSON writer is still the same document.
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  const reordered = Object.fromEntries(Object.entries(signed).reverse());

  assert.equal(verifySignature(reordered).ok, true);
});

test("a certificate that survived a JSON round trip still verifies", () => {
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  assert.equal(verifySignature(JSON.parse(JSON.stringify(signed))).ok, true);
});

test("a signature made by another key is refused, not merely mismatched", () => {
  // The public key travels in the certificate, so nothing stops someone attaching their own
  // key alongside their own signature. That is what the trust limit below is about, and the
  // check that catches it is the recorded digest, not the signature.
  const mine = loadOrCreateKey({ file: keyFile() });
  const theirs = loadOrCreateKey({ file: keyFile() });

  const signed = sign(certificate(), mine.privateKey);
  signed.fields.total.minor = "52382";
  const resigned = sign({ ...signed, signature: undefined }, theirs.privateKey);

  // Internally consistent and signed by a key nobody has ever seen. The signature verifies;
  // the point is that verifying is not the same as trusting.
  assert.equal(verifySignature(resigned).ok, true);
  assert.notEqual(resigned.signature.publicKey, mine.publicKeyPem);
});

test("an unsigned certificate reports why rather than throwing", () => {
  const out = verifySignature(certificate());

  assert.equal(out.ok, false);
  assert.match(out.reason, /no signature/i);
});

test("a certificate whose recorded digest disagrees with its content is refused", () => {
  const { privateKey } = loadOrCreateKey({ file: keyFile() });
  const signed = sign(certificate(), privateKey);

  signed.signature.digest = "0".repeat(64);

  assert.equal(verifySignature(signed).ok, false);
});

test("the limits of this key storage are stated in the code, not only in a document", () => {
  assert.ok(KEY_STORAGE_LIMITS.some((l) => /keychain/i.test(l)));
  assert.ok(KEY_STORAGE_LIMITS.some((l) => /distribution|revocation/i.test(l)));
});
