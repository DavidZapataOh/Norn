"use strict";
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = path.join(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", "test", "renderer", "fixtures", ".git"]);

function sourceFiles(dir = APP_DIR, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), found);
    } else if (entry.name.endsWith(".js")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function filesMatching(pattern, root = APP_DIR) {
  return sourceFiles(root)
    .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(APP_DIR, file));
}

module.exports = { sourceFiles, filesMatching, APP_DIR };
