# API Usage Audit

## Google Cloud Billing and Pub/Sub

The service consumes Pub/Sub CloudEvents emitted from a dedicated budget topic. It does not call the Billing API. Payload fields used are `budgetDisplayName`, `costAmount`, `budgetAmount`, `currencyCode`, `alertThresholdExceeded`, `forecastThresholdExceeded`, and event timestamps/IDs.

Trust comes from authenticated Eventarc delivery to the deployed function plus exact budget-name, currency, and freshness checks. Budget payloads are signals, not proof of final invoiced spend.

## Compute Engine API

- `instances.aggregatedList`: inventory and current state.
- `instances.stop`: scoped stop request.
- `instances.start`: audit-backed recovery request.
- `projects.get`: optional doctor credential check.

No delete, reset, disk, network, image, or IAM mutation API is used. Long-running operation acceptance is recorded as `SUBMITTED`; the code does not claim the VM reached the target state synchronously.

## Firestore API

Collections use the configured prefix and store event claims, action intents/outcomes, managed-instance recovery ownership, and cooldown control state. No personal data, credentials, message raw payloads, or access tokens are stored.

## Pub/Sub publish API

Used only when `NOTIFICATION_TOPIC` is configured. Notification failure is logged but does not turn an already-submitted Compute action into a retry loop.
