"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");

// A document's identity, defined once. The render cache and the store key on the same bytes,
// so the same invoice arriving under two filenames is one document to both.
function digestOf(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Sixteen hex characters is ample for a cache filename and is not what a duplicate-detection
// claim rests on, so it is derived from the full digest rather than computed separately.
const shortDigest = (bytes) => digestOf(bytes).slice(0, 16);

const digestFile = (filePath) => digestOf(fs.readFileSync(filePath));

module.exports = { digestOf, shortDigest, digestFile };
