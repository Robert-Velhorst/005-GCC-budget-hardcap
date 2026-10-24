"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const pin = require("../sqlite-build.json");
const root = path.resolve(__dirname, "..");
const hash = value => crypto.createHash("sha3-256").update(value).digest("hex");

async function main() {
  const driver = path.dirname(require.resolve("better-sqlite3/package.json"));
  if (require("better-sqlite3/package.json").version !== pin.driverVersion) throw new Error("SQLite driver does not match the reviewed build pin");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gcc-sqlite-source-"));
  const archive = path.join(work, "source.zip");
  const source = path.join(work, "amalgamation");
  const response = await fetch(pin.archiveUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || new URL(response.url).origin !== "https://sqlite.org") throw new Error("SQLite source download failed or changed origin");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 16 * 1024 * 1024) throw new Error("SQLite source archive exceeds its size limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (hash(bytes) !== pin.archiveSha3) throw new Error("SQLite archive checksum mismatch");
  fs.writeFileSync(archive, bytes, { flag: "wx" });
  fs.mkdirSync(source);
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const extract = "import pathlib,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); out=pathlib.Path(sys.argv[2]); prefix=sys.argv[3]; [(out/name).write_bytes(z.read(prefix+'/'+name)) for name in ('sqlite3.c','sqlite3.h','sqlite3ext.h')]";
  run(python, ["-c", extract, archive, source, pin.archivePrefix]);
  if (hash(fs.readFileSync(path.join(source, "sqlite3.c"))) !== pin.sourceSha3) throw new Error("SQLite amalgamation checksum mismatch");
  const gyp = require.resolve("node-gyp/bin/node-gyp.js");
  run(process.execPath, [gyp, "rebuild", "--release", "--force_build=1", `--sqlite3=${source}`], driver);
  const compiled = path.join(driver, "build", "Release", "better_sqlite3.node");
  const Database = require("better-sqlite3");
  const probe = new Database(":memory:", { nativeBinding: compiled });
  let actual;
  try { actual = probe.prepare("SELECT sqlite_version() AS version").get().version; }
  finally { probe.close(); }
  if (actual !== pin.version) throw new Error(`Compiled SQLite ${actual} does not match ${pin.version}`);
  const output = path.join(root, ".native", `${process.platform}-${process.arch}`);
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(compiled, path.join(output, "better_sqlite3.node"));
  fs.writeFileSync(path.join(output, "build.json"), JSON.stringify({ sqlite: actual, driver: pin.driverVersion,
    node: process.version, platform: process.platform, arch: process.arch,
    sourceSha3: pin.sourceSha3, archiveSha3: pin.archiveSha3,
    binarySha256: crypto.createHash("sha256").update(fs.readFileSync(compiled)).digest("hex") }, null, 2) + "\n");
  console.log(`Verified native SQLite ${actual} (${process.platform}-${process.arch})`);
  // Delete only known files in this process-owned temporary source directory.
  for (const name of ["sqlite3.c", "sqlite3.h", "sqlite3ext.h"]) fs.unlinkSync(path.join(source, name));
  fs.rmdirSync(source); fs.unlinkSync(archive); fs.rmdirSync(work);
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`SQLite build tool failed: ${path.basename(command)}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
