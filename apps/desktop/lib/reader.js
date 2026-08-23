"use strict";
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);

function isImagePath(p) { return IMAGE_EXT.has(path.extname(p).toLowerCase()); }
function isPdfPath(p) { return path.extname(p).toLowerCase() === ".pdf"; }

// Below this many characters a "text" PDF is really a scan with a junk text layer,
// so the pixels are worth more than the extraction.
const MIN_USEFUL_CHARS = 120;
const MAX_TEXT_CHARS = 6000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function pdfText(filePath) {
  const pdfParse = require("pdf-parse");
  const { size } = fs.statSync(filePath);
  if (size > MAX_PDF_BYTES) {
    throw new Error(`PDF is ${(size / 1e6).toFixed(0)} MB, too large to parse safely`);
  }
  // Node allocates small Buffers from a shared pool and pdf.js reads past the logical
  // end of the view, picking up bytes from a previous allocation. The symptom is a
  // random "bad XRef entry": the same file parses in one process and fails in another.
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const out = await pdfParse(bytes, { max: 1 });   // page one carries the header
  return String(out.text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function inspect(filePath) {
  if (!fs.existsSync(filePath)) return { kind: "unsupported", reason: "file not found" };
  if (isImagePath(filePath)) return { kind: "image", imagePath: filePath, signal: "image" };

  if (isPdfPath(filePath)) {
    let text = null, failure = null;
    try { text = await pdfText(filePath); }
    catch (e) { failure = String((e && e.message) || e); }

    if (text && text.length >= MIN_USEFUL_CHARS) {
      return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS), signal: "pdf-text" };
    }
    // A parse failure is a routing decision, not an error: real invoices come from
    // every generator there is, and one malformed file must not end a folder.
    return {
      kind: "pdf-needs-render",
      filePath,
      signal: "pdf-scan",
      reason: failure
        ? `text extraction failed (${failure})`
        : `only ${text ? text.length : 0} characters of text, treating it as a scan`,
    };
  }

  return {
    kind: "unsupported",
    reason: `unsupported file type ${path.extname(filePath) || "(none)"}`,
  };
}

module.exports = { inspect, pdfText, isImagePath, isPdfPath, MIN_USEFUL_CHARS, MAX_PDF_BYTES };
