"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createShutdown } = require("../lib/shutdown");

test("runs handlers in reverse registration order", async () => {
  const calls = [];
  const s = createShutdown();
  s.register("first", () => { calls.push("first"); });
  s.register("second", () => { calls.push("second"); });

  await s.run();

  assert.deepEqual(calls, ["second", "first"]);
});

test("a failing handler does not prevent the others", async () => {
  const calls = [];
  const s = createShutdown();
  s.register("model", () => { calls.push("model"); });
  s.register("store", () => { throw new Error("database locked"); });

  const results = await s.run();

  assert.deepEqual(calls, ["model"]);
  assert.equal(results.find((r) => r.name === "store").ok, false);
  assert.equal(results.find((r) => r.name === "store").error.message, "database locked");
  assert.equal(results.find((r) => r.name === "model").ok, true);
});

test("running twice does not run handlers twice", async () => {
  let count = 0;
  const s = createShutdown();
  s.register("once", () => { count++; });

  await s.run();
  await s.run();

  assert.equal(count, 1);
});
