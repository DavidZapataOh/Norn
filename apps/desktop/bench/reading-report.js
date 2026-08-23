"use strict";
const { parseAmount } = require("../lib/money");
const { rows } = require("../lib/geometry");

// A box two pixels off is the same reading, so localisation is scored by overlap rather
// than by coordinates the detector never promised to reproduce.
const IOU_SAME_REGION = 0.5;

function iou(a, b) {
  const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = x * y;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

// Two amounts are the same reading when they carry the same value, whatever convention or
// currency prefix they were written in. Everything else compares as normalised text.
function sameText(a, b) {
  const amountA = parseAmount(a);
  const amountB = parseAmount(b);
  if (amountA && amountB) return amountA.minor === amountB.minor;
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

// A recogniser fuses a value to its label, and separating the two is the extraction
// stage's job. Requiring whitespace or an edge on both sides is what stops "523,14"
// matching inside "2.523,14", which is a different value rather than a longer reading.
function covers(regionText, wantText) {
  if (sameText(regionText, wantText)) return true;
  const escaped = wantText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(regionText);
}

function scoreRegions(expected, regions) {
  let correct = 0, mislocated = 0, missed = 0;
  // The extraction stage is shown row-major text, not the region list, so a value the
  // recogniser split across several regions on one line is still available to it. Scoring
  // only whole regions would report such a value as unread when it was merely unlocalised.
  const rowTexts = rows(regions).map((row) => row.map((r) => r.text).join(" "));

  for (const want of expected) {
    const located = regions.some((r) =>
      covers(r.text, want.text) && Array.isArray(r.bbox) && iou(r.bbox, want.bbox) >= IOU_SAME_REGION);
    if (located) { correct++; continue; }

    // Right characters, wrong place or no single place, still breaks provenance while
    // reading correctly in plain text, so it is counted apart from both a hit and a miss.
    const readable = regions.some((r) => covers(r.text, want.text)) ||
      rowTexts.some((t) => covers(t, want.text));
    if (readable) mislocated++;
    else missed++;
  }

  return { found: regions.length, correct, mislocated, missed };
}

function aggregate(results) {
  const totals = { correct: 0, mislocated: 0, missed: 0, found: 0 };
  const correctConf = [], incorrectConf = [];

  for (const r of results) {
    for (const k of Object.keys(totals)) totals[k] += r[k] ?? 0;
    correctConf.push(...(r.confidences?.correct ?? []));
    incorrectConf.push(...(r.confidences?.incorrect ?? []));
  }

  const stat = (xs) => xs.length
    ? { n: xs.length, min: Math.min(...xs), max: Math.max(...xs),
        mean: xs.reduce((a, b) => a + b, 0) / xs.length }
    : { n: 0, min: null, max: null, mean: null };

  const correct = stat(correctConf);
  const incorrect = stat(incorrectConf);

  return {
    ...totals,
    confidence: {
      correct,
      incorrect,
      // Whether a single threshold could split correct from incorrect readings. When this
      // is false, no confidence cutoff is a safety mechanism.
      separable: correct.n > 0 && incorrect.n > 0 ? correct.min > incorrect.max : null,
    },
  };
}

module.exports = { scoreRegions, aggregate, iou, sameText, covers, IOU_SAME_REGION };
