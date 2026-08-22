"use strict";
const path = require("node:path");
const { _electron: electron } = require("playwright");

const APP_DIR = path.join(__dirname, "..", "..");

async function launchApp({ args = [] } = {}) {
  const app = await electron.launch({ args: [APP_DIR, ...args] });
  const window = await app.firstWindow();
  return {
    app,
    window,
    async close() {
      await app.close();
    },
  };
}

module.exports = { launchApp, APP_DIR };
