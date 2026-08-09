# Changelog

## 3.0.0 - 2026-08-09

- Added a responsive React operator dashboard backed by a native authenticated control API.
- Added durable local SQLite WAL persistence, schema migration, retention cleanup, and provider-state caching.
- Added Windows 11 setup, loopback launcher, fail-closed ngrok launcher, Docker Compose, and separate control/function images.
- Added a bearer-authenticated, read-only MCP connector for HAI with bounded status and incident tools.
- Upgraded deployment and CI to Node.js 22 and added provider request deadlines.
- Expanded the suite to 58 tests, including sessions, CSRF, SQLite, API, provider timeout, and real MCP protocol coverage.

## 2.1.0 - 2026-08-09

- Added terminal Compute zone-operation polling and resumable pending operations.
- Added explicit non-retryable acknowledgement to prevent poison-event retry storms.
- Added event/action expiry timestamps and Terraform-managed Firestore TTL policies.
- Expanded provider diagnostics, least-privilege polling IAM, and retry/retention tests.

## 2.0.0 - 2026-08-08

- Added fail-closed plan/execute configuration and explicit production allowlists.
- Added CloudEvent parsing, source/freshness validation, formal stop/recovery/no-action policy, and scoped VM selection.
- Added Firestore event idempotency, action audit, cooldown state, and recovery ownership.
- Added deterministic Compute request IDs, action caps, rate delay, structured logging, notifications, and reconciliation.
- Added health, doctor, support-bundle, smoke, CI, Docker, Terraform, security, runbook, traceability, and verification artifacts.
- Added comprehensive automated coverage and pinned dependencies.

## 1.1.0 - 2026-05-27

- Added initial configuration, VM status/label filtering, safe recovery default, and unit tests.

## 1.0.0

- Initial budget-triggered VM management function.
