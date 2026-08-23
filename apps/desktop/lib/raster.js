"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, nativeImage } = require("electron");

const PAGE = path.join(__dirname, "raster-page.html");
const PDFJS = require.resolve("pdfjs-dist/build/pdf.min.mjs");
const PDFJS_WORKER = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");

// pdf.js ships ESM only, and Chromium refuses a file:// module import from a file:// page.
// Handing the source over as a blob keeps the import same-origin, so the window can stay
// sandboxed with web security on while it parses an untrusted document.
function bootstrap({ pdfjs, worker, pdfBase64, scale }) {
  return `(async () => {
    const blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const pdfjsLib = await import(blobUrl(${JSON.stringify(pdfjs)}));
    pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl(${JSON.stringify(worker)});

    const raw = atob(${JSON.stringify(pdfBase64)});
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: ${scale} });

    const canvas = document.getElementById("page");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: context, viewport }).promise;
    doc.destroy();
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  })()`;
}

// Scale 2 (144 dpi on A4) is chosen from recognition, not render cost: rendering is flat
// across scales, while scale 1 loses six regions and scale 3 recovers none for 4 s more
// detection.
async function renderFirstPage(filePath, { scale = 2, outDir } = {}) {
  const started = performance.now();
  const dir = outDir || path.join(app.getPath("temp"), "norn-render");
  fs.mkdirSync(dir, { recursive: true });

  const pdf = fs.readFileSync(filePath);
  const digest = crypto.createHash("sha256").update(pdf).digest("hex").slice(0, 16);
  const imagePath = path.join(dir, `${digest}.png`);

  // Keyed on content, not path: the same document arriving twice under two names renders
  // once, and this digest is what duplicate detection will key on later.
  if (fs.existsSync(imagePath)) {
    const { width, height } = nativeImage.createFromPath(imagePath).getSize();
    return { imagePath, width, height, cached: true, ms: Math.round(performance.now() - started) };
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });

  try {
    // loadFile rather than a file:// template, which breaks on any install path
    // containing a space.
    await win.loadFile(PAGE);
    const out = await win.webContents.executeJavaScript(bootstrap({
      pdfjs: fs.readFileSync(PDFJS, "utf8"),
      worker: fs.readFileSync(PDFJS_WORKER, "utf8"),
      pdfBase64: pdf.toString("base64"),
      scale,
    }));

    fs.writeFileSync(imagePath, Buffer.from(out.dataUrl.slice("data:image/png;base64,".length), "base64"));
    return {
      imagePath,
      width: out.width,
      height: out.height,
      cached: false,
      ms: Math.round(performance.now() - started),
    };
  } finally {
    // Leaking offscreen windows leaks GPU memory quietly, and a throw here is the
    // likeliest way it happens.
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { renderFirstPage };
