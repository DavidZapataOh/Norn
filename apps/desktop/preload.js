"use strict";
const { contextBridge } = require("electron");

// The only surface the renderer gets. Every later capability is added here
// explicitly, so this file reads as the list of what the renderer may do.
contextBridge.exposeInMainWorld("norn", {
  version: process.versions.electron,
});
