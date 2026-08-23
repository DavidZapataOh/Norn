"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonical } = require("./canonical");
const { certificateDigest } = require("./certificate");

// Stated in the code because the verifier has to print them. A limit recorded only in a
// document is a limit the program never tells anyone about.
const KEY_STORAGE_LIMITS = [
  "The signing key is stored in a file readable only by its owner. The OS keychain is not " +
    "used: it is not implemented rather than partially implemented.",
  "There is no key distribution and no revocation. A valid signature proves the certificate " +
    "was not altered after signing. It does not prove the signer is who they claim.",
];

const publicPem = (privateKey) =>
  crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });

function loadOrCreateKey({ file }) {
  if (fs.existsSync(file)) {
    // A umask can only clear permission bits, so a file this program wrote with mode 0o600
    // can never come out more permissive and needs no chmod to prove it. A file that was
    // already there was written by something else, and reading a signing key out of it
    // without looking is how a key ends up world-readable and still used.
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & 0o077) {
      throw new Error(`the signing key at ${file} is mode 0${mode.toString(8)} and is ` +
        "readable beyond its owner; fix its permissions or delete it and let one be created");
    }
    const privateKey = crypto.createPrivateKey(fs.readFileSync(file, "utf8"));
    return { privateKey, publicKeyPem: publicPem(privateKey), created: false };
  }

  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return { privateKey, publicKeyPem: publicPem(privateKey), created: true };
}

// Over the canonical serialisation, not over JSON.stringify. That is what makes the signature
// checkable by an implementation that is not this one, and what lets a certificate survive a
// round trip through another program's JSON writer.
function sign(certificate, privateKey) {
  const { signature, ...unsigned } = certificate;
  const digest = certificateDigest(unsigned);
  const sig = crypto.sign(null, Buffer.from(canonical(unsigned), "utf8"), privateKey);

  return {
    ...unsigned,
    signature: {
      alg: "ed25519",
      publicKey: publicPem(privateKey),
      sig: sig.toString("base64"),
      // Recorded so a reader can see what was signed without recomputing it, and so a
      // certificate whose content no longer matches its own claimed digest is refused before
      // the signature is even checked.
      digest,
    },
  };
}

function verifySignature(certificate) {
  const { signature, ...unsigned } = certificate ?? {};
  if (!signature) return { ok: false, reason: "the certificate carries no signature" };
  if (signature.alg !== "ed25519") {
    return { ok: false, reason: `unknown signature algorithm "${signature.alg}"` };
  }

  const digest = certificateDigest(unsigned);
  if (digest !== signature.digest) {
    return { ok: false, reason: `the content digests to ${digest.slice(0, 16)} and the ` +
      `signature claims ${String(signature.digest).slice(0, 16)}` };
  }

  let ok;
  try {
    ok = crypto.verify(null, Buffer.from(canonical(unsigned), "utf8"),
                       crypto.createPublicKey(signature.publicKey),
                       Buffer.from(signature.sig, "base64"));
  } catch (error) {
    return { ok: false, reason: `the signature could not be checked: ${error.message}` };
  }

  return ok
    ? { ok: true, reason: "signed over the canonical form, and the content still matches" }
    : { ok: false, reason: "the signature does not match the content" };
}

module.exports = { loadOrCreateKey, sign, verifySignature, KEY_STORAGE_LIMITS };
