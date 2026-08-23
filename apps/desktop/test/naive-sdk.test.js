"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sdk } = require("../lib/sdk");
const { NAIVE_TOOLS } = require("../lib/naive");

test("the declared tools parse against the SDK's own tool schema", async () => {
  // Written from memory in an OpenAI shape, these were accepted by every unit test and threw
  // inside the SDK on the first real call. The schema is the only thing that knows, so the
  // test asks it rather than restating what it is believed to say.
  const { toolSchema } = await sdk();

  for (const tool of NAIVE_TOOLS) {
    const result = toolSchema.safeParse(tool);
    assert.ok(result.success,
      `${tool.name ?? JSON.stringify(tool)} is not a tool this SDK accepts: ` +
      `${result.error?.issues?.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
});
