"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { Firestore } = require("@google-cloud/firestore");
const { OAuth2Client } = require("google-auth-library");
const { createFirestoreStore, safeDocumentId } = require("../src/store");
const { config } = require("./helpers");

test("Firestore 9.4 preserves control writes and transactional event claims over an isolated REST fixture", { timeout: 15000 }, async t => {
  const documents = new Map(), calls = [], unexpected = [];
  const time = "2026-10-23T00:00:00.000000Z";
  const transaction = Buffer.from("synthetic-transaction").toString("base64");
  const server = http.createServer(async (request, response) => {
    try {
      let body = ""; for await (const chunk of request) body += chunk;
      const data = body ? JSON.parse(body) : {};
      const rpc = new URL(request.url, "http://fixture").pathname;
      calls.push({ path: request.url, data });
      assert.equal(request.headers.authorization, "Bearer owner");
      response.setHeader("content-type", "application/json");
      if (rpc.endsWith(":beginTransaction")) return response.end(JSON.stringify({ transaction }));
      if (rpc.endsWith(":batchGet")) {
        const rows = data.documents.map(name => documents.has(name)
          ? { found: { name, fields: documents.get(name), createTime: time, updateTime: time }, readTime: time }
          : { missing: name, readTime: time });
        if (data.newTransaction && rows.length) rows[0].transaction = transaction;
        return response.end(JSON.stringify(rows));
      }
      if (rpc.endsWith(":commit")) {
        for (const write of data.writes || []) documents.set(write.update.name, { ...documents.get(write.update.name), ...write.update.fields });
        return response.end(JSON.stringify({ commitTime: time, writeResults: (data.writes || []).map(() => ({ updateTime: time })) }));
      }
      if (rpc.endsWith(":rollback")) return response.end("{}");
      unexpected.push(request.url); response.statusCode = 400; response.end('{"error":{"code":400,"message":"Unexpected fixture RPC"}}');
    } catch (error) { unexpected.push(error.message); response.statusCode = 400; response.end('{"error":{"code":400,"message":"Fixture rejected request"}}'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: "owner", expiry_date: Date.now() + 3600000 });
  const firestore = new Firestore({ projectId: "synthetic-project", databaseId: "synthetic-database",
    host: `127.0.0.1:${server.address().port}`, ssl: false, preferRest: true, authClient });
  t.after(async () => { await firestore.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const appConfig = config({ PROJECT_ID: "synthetic-project" });
  const store = createFirestoreStore(appConfig, () => firestore);
  const now = new Date("2026-10-23T00:00:00.000Z");
  await store.updateControlState("synthetic-project", { lastDecision: "STOP" }, now);
  assert.equal((await store.getControlState("synthetic-project")).lastDecision, "STOP");
  assert.deepEqual(await store.claimEvent({ eventId: "synthetic-event", projectId: "synthetic-project" }, now), { claimed: true, reason: "NEW" });
  const prefix = "projects/synthetic-project/databases/synthetic-database/documents/";
  const event = documents.get(prefix + appConfig.firestorePrefix + "_events/" + safeDocumentId("synthetic-event"));
  assert.equal(event.status.stringValue, "PROCESSING");
  assert.equal(event.attempts.integerValue, "1");
  assert.equal(new Date(event.leaseUntil.timestampValue).getTime(), now.getTime() + appConfig.eventLeaseSeconds * 1000);
  assert.ok(calls.some(call => new URL(call.path, "http://fixture").pathname.endsWith(":commit") && call.data.transaction === transaction));
  assert.deepEqual(unexpected, []);
});
