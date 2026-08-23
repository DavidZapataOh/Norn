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

// The SDK exports no version constant -- checked against the installed index.d.ts on 0.17.1,
// which names SDK_CLIENT_ERROR_CODES and SDK_DEFAULT_PLUGINS and nothing carrying a version --
// so the manifest is the source. The package's exports map exposes it as "./package" and not
// as "./package.json", which is the spelling that resolves. It is read here because this is
// the one module permitted to reach the package, and a subpath import elsewhere is a second
// door.
const sdkVersion = () => require("@qvac/sdk/package").version;

// Node caches ESM namespaces, so an identity check cannot tell a cached loader
// from an uncached one. These seams let a test count loader entries instead.
const __importForTest = () => load;
const __setImportForTest = (fn) => { load = fn; };
const __resetCacheForTest = () => { cached = null; };

module.exports = { sdk, sdkVersion, __importForTest, __setImportForTest, __resetCacheForTest };
