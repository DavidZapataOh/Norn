"use strict";

// The reference task: look a record up, compare its amount against the document's, report.
// Small enough to run a hundred times, and it contains the one shape that matters -- a value
// produced by one step being consumed by the next.
const RECONCILE_ACTIONS = [
  {
    name: "lookup_record",
    describe: "Look up the stored purchase order matching a reference.",
    params: [{ name: "reference", type: "string", provenance: "document-asserted" }],
    produces: { key: "record.amount", type: "amount", provenance: "source-attested" },
    // Ordinary code. The only thing in this design that computes a value.
    run: ({ reference }, { lookup }) => lookup(reference),
  },
  {
    name: "compute_variance",
    describe: "Compute the difference between the document's total and the record's amount.",
    params: [
      { name: "documentAmount", type: "amount", provenance: "document-asserted" },
      { name: "recordAmount", type: "amount", provenance: "source-attested" },
    ],
    produces: { key: "variance", type: "amount", provenance: "host-computed" },
    run: ({ documentAmount, recordAmount }) => documentAmount - recordAmount,
  },
  {
    name: "report",
    describe: "Report the computed variance as the answer.",
    params: [{ name: "variance", type: "amount", provenance: "host-computed" }],
    terminal: true,
    run: ({ variance }) => variance,
  },
];

// Legality is a function of the store, never of the model. An action is offered when every
// parameter has at least one admissible slot and it has not already produced its own.
function legalActions(actions, slots) {
  return actions.filter((action) => {
    if (action.produces && slots.keys().includes(action.produces.key)) return false;
    return action.params.every((p) => slots.referencesFor(p).length > 0);
  });
}

// Two calls per step, because the reference enum depends on which action was chosen and
// cannot be built before the choice exists.
function actionGrammar(legal) {
  return {
    name: "action",
    schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          // The whole guarantee: a name absent here has no token that emits it.
          enum: legal.map((a) => a.name),
          description: legal.map((a) => `${a.name}: ${a.describe}`).join(" | "),
        },
      },
      // strict: true is accepted for OpenAI compatibility and applies none of OpenAI's
      // auto-tightening, so both of these are written out.
      required: ["action"],
      additionalProperties: false,
    },
  };
}

function referenceGrammar(action, slots) {
  const properties = {};
  for (const param of action.params) {
    properties[param.name] = {
      type: "string",
      enum: slots.referencesFor(param),
      description: `${param.name}: a ${param.type} slot`,
    };
  }
  return {
    name: "references",
    schema: {
      type: "object",
      properties,
      required: action.params.map((p) => p.name),
      additionalProperties: false,
    },
  };
}

module.exports = { RECONCILE_ACTIONS, legalActions, actionGrammar, referenceGrammar };
