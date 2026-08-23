"use strict";
const { parseAmount } = require("./money");
const { rows, union } = require("./geometry");
const { coerceDate } = require("./schema");

// Collapses the differences a recogniser introduces without collapsing the differences that
// matter: "Northwind Paper Supply" and "Northwind Paper Supply SL" stay distinct.
const loose = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matches(regionText, coerced) {
  if (coerced.value === null || coerced.value === undefined) return false;

  if (coerced.type === "amount") {
    const parsed = parseAmount(regionText);
    return parsed !== null && parsed.minor === coerced.value;
  }
  if (coerced.type === "date") {
    // The model answers in ISO because the schema coerces to it, while the page prints the
    // spelled form. Comparing them as strings never matches, and a date sitting in plain
    // sight comes back unbound.
    return coerceDate(regionText) === coerced.value;
  }
  if (coerced.type === "integer") {
    return /^-?\d+$/.test(regionText.trim()) && Number(regionText.trim()) === coerced.value;
  }
  return loose(regionText) === loose(coerced.value);
}

// A value the recogniser fused to its label still counts as carried by the region. The
// whitespace boundary is what stops "523,14" binding inside "2.523,14", which is a
// different value rather than a longer reading.
function containsValue(text, coerced) {
  if (coerced.type === "amount" || coerced.type === "integer") {
    return text.split(/\s+/).some((token) => matches(token, coerced));
  }
  if (coerced.type === "date") {
    // A printed date is one token ("2026-05-18") or three ("18 May 2026"), and the parser
    // is anchored, so the label in front of it has to be slid off before it will read.
    const tokens = text.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      for (const width of [1, 3]) {
        if (i + width > tokens.length) continue;
        if (coerceDate(tokens.slice(i, i + width).join(" ")) === coerced.value) return true;
      }
    }
    return false;
  }
  const want = loose(coerced.value);
  const haystack = loose(text);
  return want.length > 0 && (haystack === want ||
    haystack.startsWith(`${want} `) || haystack.endsWith(` ${want}`) ||
    haystack.includes(` ${want} `));
}

// The recogniser fuses a value to its label and splits it across a line. Measured on the
// reference corpus that is 10 of 44 fields, not an edge case. The search widens in order
// and stops at the first success, so a value that binds narrowly is never reported at a
// coarser width than it deserves.
function bindWithin(coerced, row) {
  for (let start = 0; start < row.length; start++) {
    for (let end = start; end < row.length; end++) {
      const members = row.slice(start, end + 1);
      const text = members.map((r) => r.text).join(" ");
      if (!matches(text, coerced) && !containsValue(text, coerced)) continue;
      return {
        status: "span",
        bbox: members.map((r) => r.bbox).reduce(union),
        // A span is only as trustworthy as its weakest region.
        confidence: Math.min(...members.map((r) => r.confidence ?? 1)),
        text,
      };
    }
  }
  return null;
}

function bindField(coerced, regions) {
  if (coerced.value === null || coerced.value === undefined) {
    return { status: "unbound", reason: "declared absent by the model" };
  }

  const hit = regions.find((r) => matches(r.text, coerced));
  if (hit) {
    return { status: "region", bbox: hit.bbox, confidence: hit.confidence, text: hit.text };
  }

  for (const row of rows(regions.filter((r) => Array.isArray(r.bbox)))) {
    const span = bindWithin(coerced, row);
    if (span) return span;
  }

  // The model produced a value that is not on the page. This is the fabrication the whole
  // design exists to surface, so it is never given a nearby box to look complete.
  return { status: "unbound", reason: "value not found on the page" };
}

function bindAll(values, regions, { labels = {} } = {}) {
  const out = {};
  const placed = regions.filter((r) => Array.isArray(r.bbox));

  for (const [key, coerced] of Object.entries(values)) {
    if (placed.length === 0) {
      out[key] = {
        status: "unbound",
        // Distinguished from a value that is genuinely absent from the page: this document
        // produced no geometry at all, which is a property of the path, not the value.
        reason: coerced.value === null || coerced.value === undefined
          ? "declared absent by the model"
          : "no regions were recognised for this document",
      };
      continue;
    }

    const candidates = placed.filter((r) => matches(r.text, coerced));
    if (candidates.length > 1) {
      const label = labels[key];
      const clustered = rows(placed);
      const preferred = label
        ? candidates.find((c) => clustered.some((row) =>
            row.includes(c) && row.some((r) => loose(r.text).includes(loose(label)))))
        : null;
      const chosen = preferred ?? candidates[0];
      out[key] = {
        status: "region", bbox: chosen.bbox, confidence: chosen.confidence, text: chosen.text,
        // Recorded rather than hidden: an arbitrary box under a highlight is worse than a
        // note that the value was ambiguous.
        contested: candidates.length,
      };
      continue;
    }

    out[key] = bindField(coerced, placed);
  }

  return out;
}

module.exports = { bindField, bindAll, matches };
