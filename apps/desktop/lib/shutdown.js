"use strict";

function createShutdown() {
  const handlers = [];
  let ran = null;

  return {
    register(name, fn) {
      handlers.push({ name, fn });
    },

    async run() {
      // Electron fires both `window-all-closed` and `before-quit` on a normal exit.
      if (ran) return ran;

      const results = [];
      for (let i = handlers.length - 1; i >= 0; i--) {
        const { name, fn } = handlers[i];
        try {
          await fn();
          results.push({ name, ok: true });
        } catch (error) {
          // One handler failing must not strand the others: a store that will not
          // close cannot be allowed to leave a model resident.
          results.push({ name, ok: false, error });
        }
      }

      ran = results;
      return results;
    },

    get size() {
      return handlers.length;
    },
  };
}

module.exports = { createShutdown };
