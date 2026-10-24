"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const LegacyDatabase = require("better-sqlite3");
const { openDatabase, assertSqliteVersion } = require("../src/control/sqlite-runtime");
const { createSqliteStore } = require("../src/control/sqlite-store");
const { config } = require("./helpers");

test("the application selects pinned SQLite 3.54.1 and rejects an older engine", () => {
  const current = openDatabase(":memory:");
  try { assert.equal(assertSqliteVersion(current), "3.54.1"); } finally { current.close(); }
  const previous = new LegacyDatabase(":memory:");
  try { assert.throws(() => assertSqliteVersion(previous), /SQLite 3.54.1 is required; found 3.53.4/); }
  finally { previous.close(); }
});

test("a synthetic 3.53.4 audit database and its closed backup retain data under 3.54.1", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gcc-sqlite-upgrade-"));
  const filename = path.join(directory, "audit.db"), backup = path.join(directory, "before.db");
  let store;
  t.after(() => {
    store?.close();
    const resolved = fs.realpathSync(directory), parent = fs.realpathSync(os.tmpdir());
    assert.ok(resolved.startsWith(parent + path.sep));
    for (const name of ["audit.db", "audit.db-wal", "audit.db-shm", "before.db", "before.db-wal", "before.db-shm"]) {
      try { fs.unlinkSync(path.join(directory, name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    fs.rmdirSync(directory);
  });
  const old = new LegacyDatabase(filename);
  assert.equal(old.prepare("SELECT sqlite_version() AS version").get().version, "3.53.4");
  const appConfig = { ...config(), databasePath: filename };
  store = createSqliteStore(appConfig, { database: old });
  const now = new Date("2026-10-23T00:00:00.000Z");
  await store.claimEvent({ eventId: "synthetic-upgrade-event", projectId: appConfig.projectId, costAmount: 10.25 }, now);
  await store.completeEvent("synthetic-upgrade-event", { status: "PLAN" }, now);
  await store.setSetting("policy", { executionMode: "plan", note: "é 漢字 🔒", values: [1, 2, 3] }, now);
  old.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY, amount TEXT, payload BLOB)");
  old.prepare("INSERT INTO fixture VALUES (?, ?, ?)").run(1, "12345.6700", Buffer.from([0, 255, 1, 128]));
  store.close(); store = null;
  fs.copyFileSync(filename, backup);
  store = createSqliteStore(appConfig);
  assert.equal((await store.getStats()).eventCount, 1);
  assert.equal((await store.listEvents())[0].status, "COMPLETED");
  assert.deepEqual(await store.getSetting("policy"), { executionMode: "plan", note: "é 漢字 🔒", values: [1, 2, 3] });
  store.close(); store = null;
  const current = openDatabase(filename);
  try {
    assert.equal(current.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(current.pragma("foreign_key_check"), []);
    const row = current.prepare("SELECT amount, payload FROM fixture").get();
    assert.equal(row.amount, "12345.6700"); assert.deepEqual(row.payload, Buffer.from([0, 255, 1, 128]));
  } finally { current.close(); }
  const before = new LegacyDatabase(backup, { readonly: true });
  try { assert.equal(before.prepare("SELECT count(*) AS count FROM events").get().count, 1); assert.equal(before.pragma("integrity_check", { simple: true }), "ok"); }
  finally { before.close(); }
});
