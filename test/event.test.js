"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseBudgetEvent, validateEventSource } = require("../src/event");
const { ValidationError } = require("../src/errors");
const { cloudEvent, config } = require("./helpers");

const now = new Date("2026-08-08T10:01:00.000Z");

test("parses CloudEvent Pub/Sub envelopes", () => {
  const parsed = parseBudgetEvent(cloudEvent({ costAmount: 0 }), {}, now);
  assert.equal(parsed.eventId, "message-1");
  assert.equal(parsed.costAmount, 0);
  assert.equal(parsed.currencyCode, "EUR");
  assert.equal(parsed.budgetDisplayName, "Production hardcap");
});

test("parses legacy background Pub/Sub envelopes", () => {
  const payload = Buffer.from(JSON.stringify({
    budgetDisplayName: "Production hardcap",
    costAmount: 5,
    currencyCode: "EUR",
  })).toString("base64");
  const parsed = parseBudgetEvent({ data: payload }, { eventId: "legacy-1" }, now);
  assert.equal(parsed.eventId, "legacy-1");
  assert.equal(parsed.costAmount, 5);
});

test("rejects malformed, incomplete, and nonsensical payloads", () => {
  assert.throws(() => parseBudgetEvent({}, {}, now), ValidationError);
  assert.throws(
    () => parseBudgetEvent({ data: { message: { data: "not-json" } } }, {}, now),
    ValidationError,
  );
  assert.throws(() => parseBudgetEvent(cloudEvent({ costAmount: -1 }), {}, now), ValidationError);
  assert.throws(() => parseBudgetEvent(cloudEvent({ currencyCode: "" }), {}, now), ValidationError);
  assert.throws(() => parseBudgetEvent(cloudEvent({ budgetAmount: 0 }), {}, now), ValidationError);
});

test("validates source allowlist, currency, and event age", () => {
  const parsed = parseBudgetEvent(cloudEvent(), {}, now);
  validateEventSource(parsed, config(), now);
  assert.throws(
    () => validateEventSource(parsed, config({ ALLOWED_BUDGET_NAMES: "Other" }), now),
    ValidationError,
  );
  assert.throws(
    () => validateEventSource(parsed, config({ EXPECTED_CURRENCY: "USD" }), now),
    ValidationError,
  );
  assert.throws(
    () => validateEventSource(parsed, config({ MAX_EVENT_AGE_SECONDS: "60" }), new Date("2026-08-08T10:02:01Z")),
    ValidationError,
  );
  assert.throws(
    () => validateEventSource(parsed, config(), new Date("2026-08-08T09:50:00Z")),
    ValidationError,
  );
});
