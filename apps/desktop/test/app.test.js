"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const electronPath = require("electron");
const { launchApp, APP_DIR } = require("./helpers/launch");

test("opens exactly one window and reports its title", async () => {
  const session = await launchApp();
  try {
    assert.equal(await session.window.title(), "Norn");
    assert.equal(session.app.windows().length, 1);
  } finally {
    await session.close();
  }
});

test("the window is visible once ready", async () => {
  const session = await launchApp();
  try {
    await session.window.waitForLoadState("domcontentloaded");
    const visible = await session.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible());
    assert.equal(visible, true);
  } finally {
    await session.close();
  }
});

test("the renderer has no Node access", async () => {
  const session = await launchApp();
  try {
    const probe = await session.window.evaluate(() => ({
      hasRequire: typeof require !== "undefined",
      hasProcess: typeof process !== "undefined",
      hasBuffer: typeof Buffer !== "undefined",
      bridgeKeys: Object.keys(window.norn ?? {}),
    }));

    assert.equal(probe.hasRequire, false);
    assert.equal(probe.hasProcess, false);
    assert.equal(probe.hasBuffer, false);
    assert.deepEqual(probe.bridgeKeys, ["version"]);
  } finally {
    await session.close();
  }
});

test("the bridge exposes nothing beyond its declared surface", async () => {
  const session = await launchApp();
  try {
    const leaked = await session.window.evaluate(() => {
      const suspicious = ["ipcRenderer", "electron", "fs", "sdk", "store", "invoke"];
      return suspicious.filter((k) => k in window || k in (window.norn ?? {}));
    });
    assert.deepEqual(leaked, []);
  } finally {
    await session.close();
  }
});

test("a second instance exits immediately", async () => {
  const session = await launchApp();
  try {
    // Same user data directory, or the two processes take two different locks and the
    // second one has nothing to collide with.
    const second = spawn(electronPath, [APP_DIR, `--user-data-dir=${session.userDataDir}`],
      { stdio: "ignore" });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { second.kill(); resolve("timeout"); }, 15000);
      second.on("exit", (c) => { clearTimeout(timer); resolve(c); });
    });

    assert.equal(code, 0);
    assert.equal(session.app.windows().length, 1);
  } finally {
    await session.close();
  }
});

test("the lock is acquired before the window is created", () => {
  const source = fs.readFileSync(path.join(APP_DIR, "main.js"), "utf8");
  const lockAt = source.indexOf("requestSingleInstanceLock");
  const windowAt = source.indexOf("new BrowserWindow");

  assert.ok(lockAt > -1, "main.js must acquire the single instance lock");
  assert.ok(lockAt < windowAt, "the lock must be acquired before any window is created");
});

test("registered cleanup runs before the app quits", async () => {
  const session = await launchApp({ args: ["--norn-test-shutdown"] });
  const tempDir = await session.app.evaluate(({ app }) => app.getPath("temp"));
  const markerFile = path.join(tempDir, "norn-shutdown-ran");
  fs.rmSync(markerFile, { force: true });

  await session.close();

  assert.equal(fs.existsSync(markerFile), true, "cleanup handler did not run");
  fs.rmSync(markerFile, { force: true });
});

test("closing the window leaves no process behind", async () => {
  const session = await launchApp();
  const pid = session.app.process().pid;

  await session.close();
  await new Promise((r) => setTimeout(r, 1500));

  assert.throws(() => process.kill(pid, 0), /ESRCH/, `process ${pid} survived close`);
});
