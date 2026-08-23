"use strict";

const height = (b) => b[3] - b[1];
const midY = (b) => (b[1] + b[3]) / 2;

function union(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

// Both measures are normalised by text height so one threshold holds across font sizes and
// capture resolutions.
function vOverlap(a, b) {
  const shared = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const shorter = Math.min(height(a), height(b));
  return shorter <= 0 ? 0 : Math.max(0, shared) / shorter;
}

// Deliberately signed. Page skew makes adjacent fragments overlap in x, and a gap clamped
// at zero cannot tell "touching" from "overlapping".
function hGap(a, b) {
  const gap = b[0] - a[2];
  const h = Math.max(height(a), height(b));
  return h <= 0 ? Infinity : gap / h;
}

const DECIMAL_TAIL = /[.,]\s*$/;
// Either half of a decimal ("491," + "40") or the rest of a number split at its thousands
// mark ("3." + "014,30"). Four unseparated digits is a value in its own right, not a
// continuation, which is what keeps a label from swallowing the next column.
const CONTINUATION = /^\d{1,2}$|^\d{3}(?:[.,]\d{1,2})?$/;

// The recogniser returns regions in its own order, not the page's. Sorting first is what
// makes "the previous region" mean the one to the left rather than whichever came back
// first. Regions without geometry cannot be placed, so they follow, unmerged.
function readingOrder(regions) {
  const placed = [], unplaced = [];
  for (const r of regions) (Array.isArray(r.bbox) ? placed : unplaced).push(r);
  return [...rows(placed).flat(), ...unplaced];
}

// Conservative on purpose. A false join corrupts a financial figure, which is worse than
// leaving a split for the abstention gate to catch.
function joinSplitNumbers(regions) {
  const out = [];
  for (const region of readingOrder(regions)) {
    const prev = out[out.length - 1];
    const joinable =
      prev && Array.isArray(prev.bbox) && Array.isArray(region.bbox) &&
      DECIMAL_TAIL.test(prev.text) && CONTINUATION.test(region.text.trim()) &&
      vOverlap(prev.bbox, region.bbox) > 0.5 &&
      hGap(prev.bbox, region.bbox) < 0.6;

    if (joinable) {
      out[out.length - 1] = {
        text: prev.text.trim() + region.text.trim(),
        bbox: union(prev.bbox, region.bbox),
        // The minimum, never the mean: a repair may not raise certainty.
        confidence: Math.min(prev.confidence ?? 1, region.confidence ?? 1),
      };
      continue;
    }
    out.push(region);
  }
  return out;
}

// Clustering by vertical overlap rather than by a y-band is what survives skew: two cells
// on the same row of a rotated table have different centres but still overlap.
// 0.2 is measured, and centred rather than merely sufficient. On a real skewed page the
// correct 16 rows hold for any threshold in [0.06, 0.38]: below that two rows merge, above
// it one row splits. A skewed table's far column overlaps its row anchor by only 0.32,
// which caps the usable range at 0.32 rather than 0.38. Both bounds move with page density
// and skew, so the default sits mid-range instead of near either failure.
function rows(regions, minOverlap = 0.2) {
  const placed = regions.filter((r) => Array.isArray(r.bbox)).sort((a, b) => midY(a.bbox) - midY(b.bbox));
  const out = [];
  for (const region of placed) {
    const row = out.find((r) => vOverlap(r[0].bbox, region.bbox) >= minOverlap);
    if (row) row.push(region);
    else out.push([region]);
  }
  return out.map((r) => r.sort((x, y) => x.bbox[0] - y.bbox[0]));
}

function toText(regions) {
  return rows(regions).map((r) => r.map((x) => x.text).join("  ")).join("\n");
}

module.exports = { height, midY, union, vOverlap, hGap, readingOrder, joinSplitNumbers, rows, toText };
