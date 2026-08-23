"use strict";

// The SDK is ESM and this process is CommonJS, so it is reached by dynamic import.
// The module is cached because re-importing re-enters the loader and risks a second
// native worker, and two workers on one machine deadlock over the shared cache.
let cached = null;
let load = () => import("@qvac/sdk");

async function sdk() {
  if (!cached) cached = await load();
  return cached;
}

// Node caches ESM namespaces, so an identity check cannot tell a cached loader
// from an uncached one. These seams let a test count loader entries instead.
const __importForTest = () => load;
const __setImportForTest = (fn) => { load = fn; };
const __resetCacheForTest = () => { cached = null; };

module.exports = { sdk, __importForTest, __setImportForTest, __resetCacheForTest };
