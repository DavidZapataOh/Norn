"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const APP_DIR = path.join(__dirname, "..", "..");

// The application takes a single-instance lock, which is scoped to the user data
// directory. Test files run in parallel, so sessions that shared one would fight over the
// lock and the loser would exit before its window appeared. A directory per session also
// keeps test runs out of the real evidence log.
async function launchApp({ args = [], userDataDir } = {}) {
  const dataDir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "norn-session-"));
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${dataDir}`, ...args] });
  const window = await app.firstWindow();
  return {
    app,
    window,
    userDataDir: dataDir,
    async close() {
      await app.close();
      if (!userDataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Playwright serialises the callback, so it cannot close over anything and has no `require`
// in scope. `process.mainModule.require` resolves against the running main script, so these
// tests exercise the app's own module resolution rather than the harness's.
async function callInMain(session, moduleName, method, args = []) {
  return session.app.evaluate(async ({ app }, payload) => {
    // process.mainModule is Electron's own entry, so a relative specifier resolves against
    // Electron rather than the app. The app path has to be explicit.
    const nodePath = process.mainModule.require("node:path");
    const mod = process.mainModule.require(
      nodePath.join(app.getAppPath(), "lib", payload.moduleName));
    return mod[payload.method](...payload.args);
  }, { moduleName, method, args });
}

async function windowCount(session) {
  return session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

module.exports = { launchApp, callInMain, windowCount, APP_DIR };
