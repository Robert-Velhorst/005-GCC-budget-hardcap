# Critical Path

## State flow

| Stage | Evidence | Failure behavior |
| --- | --- | --- |
| Receive | CloudEvent and legacy Pub/Sub envelopes accepted | Missing/invalid data rejected |
| Verify | Name allowlist, currency, timestamp, numeric fields | Non-retryable validation error |
| Decide | STOP, RECOVER, or NO_ACTION state | Deterministic pure policy |
| Plan | Status/labels/protection/zones/exclusions applied | Action cap fails closed |
| Claim | Firestore event lease and terminal-state check | Duplicate ignored; store outage retried |
| Gate | Emergency switch, cooldown, execution mode | No provider mutation |
| Intent | Action and stop ownership persisted | No provider call if persistence fails |
| Submit | Compute start/stop with deterministic UUID | Provider error audited and rethrown |
| Submit | Operation ID and `SUBMITTED` state persisted | Timeout remains resumable |
| Verify | Zone operation polled to successful `DONE` | Terminal error audited; transient read/timeout retried |
| Audit | `COMPLETED` action and recovery ownership persisted | Ambiguity retained for reconciliation |
| Notify | Structured log and optional Pub/Sub message | Notification failure warns without replaying actions |
| Recover | Only terminated, audit-owned, delay-eligible VMs | Disabled by default |

## Smoke verification

`npm run smoke` executes receive -> verify -> decide -> plan -> scoped action output against a visibly labelled test-only adapter. It asserts one expected stop plan and performs no cloud mutation.

The full execution path is covered by `test/handler.test.js` using an in-memory store and fake Compute adapter. Live verification is a separate operator-owned acceptance step because it changes real infrastructure.

## Operator control path

Windows setup -> restricted local tokens -> loopback listener -> session/CSRF gate when public -> SQLite migration and retention -> cached provider read with deadline -> truthful dashboard state -> review-gated local policy. HAI follows a separate bearer-authenticated MCP path and receives read-only bounded context only.
