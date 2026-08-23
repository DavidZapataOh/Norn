"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { launchApp, callInMain, windowCount } = require("./helpers/launch");

const DOCS = path.join(__dirname, "..", "fixtures", "docs");
const render = (session, pdf, opts) =>
  callInMain(session, "raster.js", "renderFirstPage", [pdf, opts]);

// A uniform page still compresses to tens of kilobytes, so file size cannot tell a
// rendered invoice from a viewer that never painted. Ink can.
function inkFraction(session, imagePath) {
  return session.app.evaluate(({ nativeImage }, file) => {
    const bmp = nativeImage.createFromPath(file).toBitmap();
    const counts = new Map();
    for (let i = 0; i < bmp.length; i += 4) {
      const lum = (bmp[i + 2] * 299 + bmp[i + 1] * 587 + bmp[i] * 114) / 1000 | 0;
      counts.set(lum, (counts.get(lum) || 0) + 1);
    }
    let background = 0, best = -1;
    for (const [lum, n] of counts) if (n > best) { best = n; background = lum; }
    let ink = 0;
    for (const [lum, n] of counts) if (Math.abs(lum - background) > 32) ink += n;
    return ink / (bmp.length / 4);
  }, imagePath);
}

test("page one of a scanned PDF becomes an image", async () => {
  const session = await launchApp();
  try {
    const out = await render(session, path.join(DOCS, "invoice-scanned.pdf"));

    assert.ok(fs.existsSync(out.imagePath), "no image written");
    assert.ok(fs.statSync(out.imagePath).size > 10_000, "image is suspiciously small");
    assert.ok(out.width > 600 && out.height > 800, `unexpected dimensions ${out.width}x${out.height}`);

    const ink = await inkFraction(session, out.imagePath);
    assert.ok(ink > 0.005, `page looks blank: only ${(ink * 100).toFixed(3)}% ink`);
  } finally {
    await session.close();
  }
});

test("no offscreen window survives a render", async () => {
  const session = await launchApp();
  try {
    const before = await windowCount(session);
    await render(session, path.join(DOCS, "invoice-scanned.pdf"));

    assert.equal(await windowCount(session), before, "an offscreen window survived the render");
  } finally {
    await session.close();
  }
});

test("a render that throws still destroys its window", async () => {
  const session = await launchApp();
  try {
    const before = await windowCount(session);

    // The corrupt fixture exists, so the digest and the window are both created before
    // anything fails. A missing file would throw before there was a window to leak, and
    // would pass this test without ever reaching the cleanup it is meant to cover.
    await assert.rejects(() => render(session, path.join(DOCS, "invoice-corrupt.pdf")));

    assert.equal(await windowCount(session), before, "a failing render leaked its window");
  } finally {
    await session.close();
  }
});

test("a second render of the same document is served from cache", async () => {
  const session = await launchApp();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "norn-cache-"));
  try {
    const pdf = path.join(DOCS, "invoice-scanned.pdf");
    const first = await render(session, pdf, { outDir });
    const second = await render(session, pdf, { outDir });

    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.imagePath, first.imagePath);
    assert.ok(second.ms < first.ms, `cache was not faster: ${second.ms}ms vs ${first.ms}ms`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    await session.close();
  }
});

const geometry = (session, pdf) => callInMain(session, "raster.js", "readTextGeometry", [pdf]);

test("a digital PDF yields its text with coordinates, without recognition", async () => {
  const session = await launchApp();
  try {
    const out = await geometry(session, path.join(DOCS, "invoice-digital.pdf"));

    assert.ok(out.items.length > 10, `expected a text layer, got ${out.items.length} items`);
    const total = out.items.find((i) => i.text.includes("523.81"));
    assert.ok(total, "the total is in the text layer and was not returned");
    assert.equal(total.bbox.length, 4);
    assert.ok(total.bbox[2] > total.bbox[0] && total.bbox[3] > total.bbox[1],
      `degenerate box ${JSON.stringify(total.bbox)}`);

    // The box has to sit in the same space the rasteriser produces, or a highlight drawn
    // from it lands somewhere else on the page.
    const rendered = await render(session, path.join(DOCS, "invoice-digital.pdf"));
    assert.ok(total.bbox[2] <= rendered.width + 1 && total.bbox[3] <= rendered.height + 1,
      `box ${JSON.stringify(total.bbox)} falls outside the ${rendered.width}x${rendered.height} page`);
  } finally {
    await session.close();
  }
});

test("a scanned PDF has no text layer, which is how the caller knows to recognise it", async () => {
  const session = await launchApp();
  try {
    const out = await geometry(session, path.join(DOCS, "invoice-scanned.pdf"));
    assert.equal(out.items.length, 0);
  } finally {
    await session.close();
  }
});

test("a text-layer item carries no confidence, because none was measured", async () => {
  const session = await launchApp();
  try {
    const out = await geometry(session, path.join(DOCS, "invoice-digital.pdf"));

    for (const item of out.items) {
      assert.equal(item.confidence, undefined,
        "a fabricated confidence here would pass a gate that measured nothing");
      assert.equal(item.source, "text-layer", "the consumer has to be able to tell these apart");
    }
  } finally {
    await session.close();
  }
});
