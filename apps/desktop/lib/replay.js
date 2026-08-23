"use strict";

// Named paths, not a pattern over key names. A heuristic skipping anything called "path" would
// also skip a template field named path, and the exclusion list is the one part of a
// comparison where being wrong is silent: an over-broad entry makes the check stop looking.
//
// producedAt and document.path vary by construction, and a check that always fails is a check
// nobody runs. The signature is excluded because a replay produces its own over the same
// content -- and the digest that signature covers is compared like everything else, which is
// what keeps this from being a hole.
const VOLATILE_PATHS = ["producedAt", "document.path", "signature"];

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function walk(recorded, regenerated, path, differences, volatile) {
  if (volatile.has(path)) return;

  if (Array.isArray(recorded) && Array.isArray(regenerated)) {
    for (let i = 0; i < Math.max(recorded.length, regenerated.length); i++) {
      walk(recorded[i], regenerated[i], `${path}[${i}]`, differences, volatile);
    }
    return;
  }

  if (isPlainObject(recorded) && isPlainObject(regenerated)) {
    // Both sides' keys, so a field the replay invented is reported alongside one it lost.
    const keys = [...new Set([...Object.keys(recorded), ...Object.keys(regenerated)])].sort();
    for (const key of keys) {
      walk(recorded[key], regenerated[key], path ? `${path}.${key}` : key, differences, volatile);
    }
    return;
  }

  if (recorded !== regenerated) differences.push({ path, recorded, regenerated });
}

// Walks both documents rather than comparing digests. The digest is what tells you they
// differ; the walk is what tells you where, and "certificates differ" is not something a
// reader can act on.
function compare(recorded, regenerated, { volatilePaths = VOLATILE_PATHS } = {}) {
  const differences = [];
  walk(recorded, regenerated, "", differences, new Set(volatilePaths));
  return {
    match: differences.length === 0,
    firstDifference: differences[0] ?? null,
    differences,
  };
}

// A third outcome, and the honest one. Byte-identical output across runtime versions is a
// promise this project cannot keep: a runtime is entitled to change its sampling, its kernels
// or its tokeniser between releases, and none of that is a defect. Reporting it as a failure
// would put a red mark on a certificate that is fine, and red marks nobody believes are worse
// than no red marks at all.
function comparability(recorded, { sdkVersion, model }) {
  const claimed = recorded?.replay ?? {};
  const reasons = [];

  // Exact match rather than a semver range. A range would be this project claiming to know
  // which runtime changes affect output, which it does not know.
  if (claimed.sdkVersion !== sdkVersion) {
    reasons.push(`the certificate was produced on SDK ${claimed.sdkVersion} and this is ` +
      `SDK ${sdkVersion}`);
  }
  if (claimed.model !== model) {
    reasons.push(`the certificate names ${claimed.model} and this run has ${model}`);
  }

  return reasons.length
    ? { comparable: false, reason: reasons.join("; ") }
    : { comparable: true, reason: `${claimed.model} on SDK ${claimed.sdkVersion}` };
}

module.exports = { compare, comparability, VOLATILE_PATHS };
