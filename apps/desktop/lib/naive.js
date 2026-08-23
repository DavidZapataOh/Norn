"use strict";

// Flat parameters: this SDK's tool schemas take a type, a description and an optional enum,
// with no nested objects and no array item types.
const NAIVE_TOOLS = [
  {
    type: "function",
    function: {
      name: "lookup_record",
      description: "Look up the stored purchase order matching a reference. Returns its amount.",
      parameters: {
        type: "object",
        properties: { reference: { type: "string", description: "The invoice reference." } },
        required: ["reference"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_variance",
      description: "Subtract b from a and return the difference. Use this instead of computing.",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number", description: "The document's total, in minor units." },
          b: { type: "number", description: "The amount lookup_record returned, in minor units." },
        },
        required: ["a", "b"],
      },
    },
  },
];

// Written to win. A baseline beaten by a prompt nobody wrote properly proves nothing.
const NAIVE_SYSTEM =
  "You reconcile an invoice against a stored purchase order. Follow this procedure exactly:\n" +
  "1. Call lookup_record with the invoice reference.\n" +
  "2. Call compute_variance with a = the document's total and b = the amount lookup_record " +
  "returned. Use the value the tool returned, not a value from this conversation.\n" +
  "3. Report the variance compute_variance returned.\n" +
  "You never perform arithmetic yourself. Every number in your answer comes from a tool.";

async function runNaive({ audit, modelId, seed, host, maxTurns = 6, task }) {
  const history = [
    { role: "system", content: NAIVE_SYSTEM },
    { role: "user", content: task ?? "Reconcile invoice NW-2026-0117. Its total is 52381 minor units." },
  ];
  const calls = [];
  const errors = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const out = await audit.auditCompletion({
      modelId, history, stream: true, tools: NAIVE_TOOLS,
      // Deliberately non-zero. A deployed system does not get to assume greedy decoding, and
      // a result that held only at zero would not characterise the regime.
      generationParams: { temp: 0.7, seed: seed + turn, predict: 400 },
    }, { model: "naive", event: `turn-${turn}` });

    // Recorded, never retried: a retry hides the rate this arm exists to measure.
    for (const error of out.toolErrors) errors.push({ turn, ...error });

    if (out.toolCalls.length === 0) {
      return { answer: out.text, calls, errors, turns: turn, stopReason: "answered", transcript: history };
    }

    for (const call of out.toolCalls) {
      const fn = host[call.name];
      if (!fn) {
        calls.push({ turn, name: call.name, arguments: call.arguments, returned: null,
                     error: `no tool named ${call.name}` });
        continue;
      }
      const returned = fn(call.arguments);
      // What the tool actually returned in this trial. Substitution is detected against this,
      // not against the expected answer.
      calls.push({ turn, name: call.name, arguments: call.arguments, returned });
      history.push({ role: "assistant", content: `Called ${call.name}.` });
      history.push({ role: "user", content: `${call.name} returned ${JSON.stringify(returned)}.` });
    }
  }

  return { answer: null, calls, errors, turns: maxTurns, stopReason: "turn-cap", transcript: history };
}

module.exports = { runNaive, NAIVE_TOOLS, NAIVE_SYSTEM };
