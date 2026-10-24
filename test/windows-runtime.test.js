"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
test("Windows launcher enforces patched stable runtime floors", { skip: process.platform !== "win32" }, () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-File", path.resolve(__dirname, "../scripts/test-windows-runtime.ps1")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, 9);
});
