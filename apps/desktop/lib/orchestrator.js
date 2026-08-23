"use strict";
const { legalActions, actionGrammar, referenceGrammar } = require("./actions");

const DEFAULT_MAX_TURNS = 12;

const SYSTEM =
  "You are choosing the next step of a bookkeeping procedure. You never compute values and " +
  "you never write numbers: you choose a step by name, and you choose which stored value " +
  "each input refers to by name. The host performs the work. /no_think";

function createSelector({ audit, modelId, seed, system = SYSTEM }) {
  let call = 0;

  return async function select({ kind, grammar, prompt }) {
    // Per call, not per run: two calls in one step must not repeat each other, and the run as
    // a whole must still be reproducible from its starting seed.
    const thisSeed = seed + call++;
    const { text } = await audit.auditCompletion({
      modelId,
      history: [
        { role: "system", content: system },
        { role: "user", content: `Current state:\n\n${prompt}\n\nChoose the ${kind}.` },
      ],
      stream: true,
      // Every step is a fresh question about a changed state. A shared cache bleeds the
      // previous step into this one and produces a plausible wrong choice rather than an
      // error.
      kvCache: false,
      responseFormat: { type: "json_schema", json_schema: grammar },
      generationParams: { temp: 0, seed: thisSeed, predict: 120 },
    }, { model: "orchestrator", event: `select-${kind}` });

    try {
      return JSON.parse(String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim());
    } catch {
      // The grammar should make this unreachable. If it happens the grammar was not applied,
      // and a loop that recovered here would hide that.
      throw new Error(
        `selection is not valid JSON, so the grammar was not applied: ${String(text).slice(0, 120)}`);
    }
  };
}

async function runLoop({ actions, slots, select, host, maxTurns = DEFAULT_MAX_TURNS }) {
  const steps = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const legal = legalActions(actions, slots);
    if (legal.length === 0) {
      return { stopReason: "no-legal-action", answer: null, steps, turns: turn - 1 };
    }

    const grammar = actionGrammar(legal);
    const chosen = await select({ kind: "action", grammar, prompt: slots.render() });
    const action = legal.find((a) => a.name === chosen.action);
    // Unreachable through the grammar. Checked anyway: a loop that trusts its input has no
    // way to notice when the grammar stops being applied.
    if (!action) throw new Error(`selected action "${chosen.action}" is not legal in this state`);

    let references = {};
    if (action.params.length) {
      const refGrammar = referenceGrammar(action, slots);
      references = await select({ kind: "references", grammar: refGrammar, prompt: slots.render() });
      for (const param of action.params) {
        const admissible = refGrammar.schema.properties[param.name].enum;
        if (!admissible.includes(references[param.name])) {
          throw new Error(`selected slot "${references[param.name]}" is not admissible for ${param.name}`);
        }
      }
    }

    // The host does the dereference. This is the whole guarantee of this design, and it is
    // worth resisting any refactor that moves it: a model that never holds a value cannot
    // substitute one.
    const args = {};
    for (const [name, key] of Object.entries(references)) args[name] = slots.get(key).value;

    const produced = await action.run(args, host);
    if (action.produces) {
      slots.put(action.produces.key, { ...action.produces, value: produced });
    }

    // The key, not the value. A reviewer reading a wrong reference sees which slot was used;
    // a recorded value shows a plausible number and nothing else.
    steps.push({ turn, action: action.name, references, produced: action.produces?.key ?? null });

    if (action.terminal) {
      return { stopReason: "terminal", answer: produced, steps, turns: turn };
    }
  }

  return { stopReason: "turn-cap", answer: null, steps, turns: maxTurns };
}

module.exports = { runLoop, createSelector, SYSTEM, DEFAULT_MAX_TURNS };
