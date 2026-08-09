# API Usage Audit

## Google Cloud Billing and Pub/Sub

The service consumes Pub/Sub CloudEvents emitted from a dedicated budget topic. It does not call the Billing API. Payload fields used are `budgetDisplayName`, `costAmount`, `budgetAmount`, `currencyCode`, `alertThresholdExceeded`, `forecastThresholdExceeded`, and event timestamps/IDs.

Trust comes from authenticated Eventarc delivery to the deployed function plus exact budget-name, currency, and freshness checks. Budget payloads are signals, not proof of final invoiced spend.

## Compute Engine API

- `instances.aggregatedList`: inventory and current state.
- `instances.stop`: scoped stop request.
- `instances.start`: audit-backed recovery request.
- `zoneOperations.get`: terminal action verification and retry resumption.
- `projects.get`: optional doctor credential check.

No delete, reset, disk, network, image, or IAM mutation API is used. Provider acceptance is recorded as `SUBMITTED`, then the zone operation is polled. Only a successful `DONE` operation becomes `COMPLETED`; timeout remains resumable and terminal provider errors become audited failures.

Compute and Pub/Sub use the shared `google-auth-library` transport with fixed Google API hosts, encoded path segments, and request deadlines. The application does not ship the generated `googleapis` umbrella client.

## Firestore API

Collections use the configured prefix and store event claims, action intents/outcomes, managed-instance recovery ownership, and cooldown control state. Terraform enables TTL on event/action `expiresAt` fields. The control plane can read bounded event/action/managed-instance lists and aggregate counts when `CONTROL_AUDIT_SOURCE=firestore`; local settings remain in SQLite. No personal data, credentials, message raw payloads, or access tokens are stored.

## Pub/Sub publish API

Used only when `NOTIFICATION_TOPIC` is configured. Notification failure is logged but does not turn an already-submitted Compute action into a retry loop.

## Local operator API

The native HTTP control plane exposes health/readiness, session, overview, policy, and plan-only preview routes. Policy mutation writes only local SQLite settings and never deploys Terraform or directly mutates Compute Engine. Static paths are resolved under the built web root, request bodies are capped, and security headers are applied globally.

## HAI MCP

`/mcp` implements authenticated MCP Streamable HTTP sessions with a bounded session count. The only tools return a compact status summary and recent failure records. No MCP tool can change policy, call Compute mutations, access credentials, or invoke generic process/filesystem/browser capabilities.
