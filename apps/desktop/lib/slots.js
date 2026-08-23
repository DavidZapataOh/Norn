"use strict";
const { formatMinor } = require("./money");

// Where a value came from is part of its type. An amount the document asserts and an amount a
// stored record attests are not interchangeable, and a reference set that cannot tell them
// apart cannot stop the model reaching for the wrong one.
const PROVENANCE = ["document-asserted", "source-attested", "host-computed"];

const show = (slot) => (slot.type === "amount" ? formatMinor(slot.value) : String(slot.value));

function createSlots() {
  const slots = new Map();

  return {
    put(key, { type, value, provenance }) {
      if (!PROVENANCE.includes(provenance)) {
        throw new Error(`slot "${key}" has no valid provenance: ${JSON.stringify(provenance)}`);
      }
      // Append-only within a run. An overwritten slot makes a trace unable to say what the
      // step actually read.
      if (slots.has(key)) throw new Error(`slot "${key}" was already written`);
      slots.set(key, { key, type, value, provenance });
      return key;
    },

    get(key) {
      const slot = slots.get(key);
      // A dereference that silently yields undefined puts a missing value into a host
      // function, which is the failure this design removes.
      if (!slot) throw new Error(`no slot named "${key}"`);
      return slot;
    },

    // The grammar is compiled from this, so a key excluded here is a key the model cannot
    // emit. An empty result is what makes an action illegal, which is why there is no
    // fallback to "everything".
    referencesFor({ type, provenance = null }) {
      return [...slots.values()]
        .filter((s) => s.type === type && (provenance === null || s.provenance === provenance))
        .map((s) => s.key);
    },

    // The model is shown the values, because it has to reason about them. Reading a value and
    // emitting one are different permissions and only the second is withdrawn. Insertion
    // order, no timestamps, no locale: a later sprint replays this run and compares digests.
    render() {
      return [...slots.values()]
        .map((s) => `${s.key} : ${s.type} (${s.provenance}) = ${show(s)}`)
        .join("\n");
    },

    keys: () => [...slots.keys()],
    size: () => slots.size,
  };
}

module.exports = { createSlots, PROVENANCE };
