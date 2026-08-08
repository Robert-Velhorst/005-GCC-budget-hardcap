"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const roots = ["index.js", "src", "scripts", "test"];
const files = roots.flatMap((root) => collectJavaScript(path.resolve(root)));
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

if (failed) process.exitCode = 1;
else console.log(`Syntax check passed for ${files.length} JavaScript files.`);

function collectJavaScript(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith(".js") ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    collectJavaScript(path.join(target, entry.name)),
  );
}
