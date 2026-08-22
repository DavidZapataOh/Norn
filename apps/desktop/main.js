"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { createShutdown } = require("./lib/shutdown");

// Two processes sharing the model cache deadlock over the native worker with no
// error and no rejection, so the second instance must exit rather than degrade.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

const shutdown = createShutdown();
let mainWindow = null;

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Norn",
    show: false,
    backgroundColor: "#fbfaf8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// A test-only handler, gated behind a flag, so the shutdown path is exercised
// before any module has real cleanup to register.
if (process.argv.includes("--norn-test-shutdown")) {
  shutdown.register("test-marker", () => {
    fs.writeFileSync(path.join(app.getPath("temp"), "norn-shutdown-ran"), "1");
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  await shutdown.run();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (shutdown.size === 0) return;
  event.preventDefault();
  await shutdown.run();
  app.exit(0);
});

module.exports = { shutdown };
