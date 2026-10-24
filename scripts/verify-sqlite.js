"use strict";
const { openDatabase, assertSqliteVersion } = require("../src/control/sqlite-runtime");
const database = openDatabase(":memory:");
try { console.log(JSON.stringify({ sqlite: assertSqliteVersion(database), node: process.version, platform: process.platform })); }
finally { database.close(); }
