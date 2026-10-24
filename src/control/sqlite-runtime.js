"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { version: SQLITE_VERSION } = require("../../sqlite-build.json");
const nativeBinding = path.resolve(__dirname, "../../.native", `${process.platform}-${process.arch}`, "better_sqlite3.node");

function assertSqliteVersion(database) {
  const actual = database.prepare("SELECT sqlite_version() AS version").get().version;
  if (actual !== SQLITE_VERSION) throw new Error(`SQLite ${SQLITE_VERSION} is required; found ${actual}`);
  return actual;
}
function openDatabase(filename, options = {}) {
  if (!fs.existsSync(nativeBinding)) throw new Error("Pinned SQLite binding is missing; run npm run build:sqlite with the required C++ and Python build tools");
  const database = new Database(filename, { ...options, nativeBinding });
  try { assertSqliteVersion(database); return database; }
  catch (error) { database.close(); throw error; }
}
module.exports = { SQLITE_VERSION, nativeBinding, assertSqliteVersion, openDatabase };
