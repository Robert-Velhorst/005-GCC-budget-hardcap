"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuth, safeEqual } = require("../src/control/auth");

const operatorToken = "o".repeat(32);
const haiToken = "h".repeat(32);

test("auth allows clean loopback requests only in local mode", () => {
  const auth = createAuth(config());
  assert.equal(auth.authenticate(request()).mode, "local");
  assert.equal(auth.authenticate(request({ "x-forwarded-for": "1.2.3.4" })).authenticated, false);
});

test("public sessions require token, set CSRF, and expire", () => {
  let now = 1000;
  const auth = createAuth(config({ publicAccessEnabled: true, sessionTtlMs: 100 }), () => now);
  assert.equal(auth.login(request(), "wrong").ok, false);
  const login = auth.login(request(), operatorToken);
  assert.equal(login.ok, true);
  const identity = auth.authenticate(request({ cookie: `gcc_session=${login.id}` }));
  assert.equal(identity.mode, "session");
  assert.equal(auth.validCsrf(request({ "x-csrf-token": login.csrf, origin: "https://example.test", host: "example.test", cookie: `gcc_session=${login.id}` }), identity), true);
  assert.equal(auth.validCsrf(request({ "x-csrf-token": "wrong", cookie: `gcc_session=${login.id}` }), identity), false);
  now += 201;
  assert.equal(auth.authenticate(request({ cookie: `gcc_session=${login.id}` })).authenticated, false);
});

test("operator and HAI bearer tokens are role separated", () => {
  const auth = createAuth(config({ publicAccessEnabled: true }));
  assert.equal(auth.authenticate(request({ authorization: `Bearer ${operatorToken}` })).role, "operator");
  assert.equal(auth.authenticate(request({ authorization: `Bearer ${operatorToken}` }), "hai").authenticated, false);
  assert.equal(auth.authenticate(request({ authorization: `Bearer ${haiToken}` }), "hai").role, "hai");
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("short", "different"), false);
});

test("login throttling ignores spoofed forwarding headers unless proxy trust is enabled", () => {
  const direct = createAuth(config({ publicAccessEnabled: true, trustProxy: false }));
  for (let index = 0; index < 5; index += 1) {
    assert.equal(direct.login(request({ "x-forwarded-for": `198.51.100.${index}` }), "wrong").ok, false);
  }
  assert.equal(direct.login(request({ "x-forwarded-for": "203.0.113.1" }), "wrong").rateLimited, true);

  const proxied = createAuth(config({ publicAccessEnabled: true, trustProxy: true }));
  for (let index = 0; index < 6; index += 1) {
    assert.notEqual(proxied.login(request({ "x-forwarded-for": `198.51.100.${index}` }), "wrong").rateLimited, true);
  }
});

function config(overrides = {}) {
  return { publicAccessEnabled: false, trustProxy: false, controlPlaneToken: operatorToken, haiConnectorToken: haiToken, sessionTtlMs: 1000, ...overrides };
}

function request(headers = {}) {
  return { headers, socket: { remoteAddress: "127.0.0.1" } };
}
