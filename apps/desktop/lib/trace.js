"use strict";
const crypto = require("node:crypto");
const { canonical } = require("./canonical");

// Not the empty string and not sixty-four zeroes: a root that is falsy, or that looks like a
// placeholder, invites a verifier to treat "nothing happened" as "nothing to check".
const GENESIS = crypto.createHash("sha256").update("norn-trace-genesis").digest("hex");

// Keys, not values. The trace is a record of decisions, so it can be read by someone entitled
// to check the process but not the figures. That is a rule the code has to hold rather than
// the author remembering it, so an unknown key is an error and there is nowhere to put a
// value. `head` is the one key a record may carry that is not linked over, because a record
// that chained to its own head could not be checked.
const REQUIRED = ["stage", "action", "reads", "writes", "digest"];

function normalise(record) {
  for (const key of Object.keys(record)) {
    if (key === "head") continue;
    if (!REQUIRED.includes(key)) {
      throw new Error(`trace record has an unknown key "${key}"; the trace records keys and ` +
        "digests, never values");
    }
  }
  for (const key of REQUIRED) {
    if (record[key] === undefined) throw new Error(`trace record is missing "${key}"`);
  }
  if (!Array.isArray(record.reads)) throw new Error("trace record's reads must be an array");
  return { stage: record.stage, action: record.action, reads: record.reads,
           writes: record.writes, digest: record.digest };
}

const link = (head, record) =>
  crypto.createHash("sha256").update(head).update(canonical(record)).digest("hex");

function createTrace() {
  const records = [];
  let head = GENESIS;

  return {
    append(record) {
      const entry = normalise(record);
      head = link(head, entry);
      // The head travels with the record. Without it a verifier recomputing from edited
      // records gets a different root and no way to say which record was edited, which is the
      // difference between "something is wrong" and a finding.
      records.push({ ...entry, head });
      return head;
    },
    records: () => records.map((r) => ({ ...r })),
    root: () => head,
    length: () => records.length,
  };
}

function verifyChain(records) {
  let head = GENESIS;
  for (const [i, record] of records.entries()) {
    let recomputed;
    try {
      recomputed = link(head, normalise(record));
    } catch {
      return { ok: false, root: head, brokenAt: i };
    }
    if (recomputed !== record.head) return { ok: false, root: head, brokenAt: i };
    head = recomputed;
  }
  return { ok: true, root: head, brokenAt: null };
}

module.exports = { createTrace, verifyChain, GENESIS };
