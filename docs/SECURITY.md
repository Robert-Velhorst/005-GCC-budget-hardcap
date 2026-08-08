# Security and Threat Model

## Assets and trust boundaries

The protected assets are Compute Engine availability, billing-control integrity, Firestore audit history, and the function service account. Trust boundaries are Eventarc/Pub/Sub delivery, budget payload parsing, runtime configuration, Google credentials, Firestore, and Compute Engine.

## Threats and controls

| Threat | Control |
| --- | --- |
| Forged or unrelated budget event | Authenticated trigger, exact budget-name/currency allowlists, stale-event rejection |
| Accidental broad shutdown | Required VM label and zone allowlist, protection label, explicit exclusions, action cap |
| Duplicate delivery | Firestore claim/lease, terminal event states, deterministic Compute request UUID |
| Stale alert changes current infrastructure | Maximum event age and future-time validation |
| Retry after ambiguous provider response | Persisted intent, idempotent request UUID, reconciliation queue |
| Unauthorized recovery | Disabled by default; only audit-owned, terminated, delay-eligible VMs |
| Compromised function identity | Custom role limited to get/list/start/stop plus Firestore/logging/Eventarc roles |
| Secret leakage | Application Default Credentials, no credential variables, logger redaction, ignored env/runtime files |
| Denial through large scope | Maximum actions, serialized requests, delay, cooldown, function max instances |
| False operator confidence | `SUBMITTED` terminology, health checks config only, live-provider limitations documented |

## Authentication and authorization

There is no application session model. Authentication is provided by Google Cloud's Eventarc invocation and Application Default Credentials. Authorization is enforced by IAM and again by application-level budget/zone/label/protection boundaries.

Do not add `roles/editor`, `roles/owner`, public invoker access, or service-account keys. Prefer Workload Identity Federation for CI. Rotate access by replacing identities and revoking IAM bindings; there are no secrets in repository configuration.

## Data and privacy

Stored records contain project ID, budget display name, currency, cost values, event identifiers, VM names/zones, decisions, operation identifiers, timestamps, and sanitized errors. They contain operational metadata, not end-user personal data. Restrict Firestore and logs because project/VM names may still be commercially sensitive.

Recommended retention: 90 days for completed events/actions, 365 days for managed-instance/control records or until recovery/reconciliation, whichever is sooner. Configure Firestore TTL policies and Cloud Logging retention at the platform level after organizational approval. Export before deletion when audit retention is required.

## Supply chain

Dependencies are pinned in `package.json` and locked by `package-lock.json`. CI runs `npm ci` and `npm audit --audit-level=moderate`. Dependabot monitors npm and GitHub Actions. The UUID override removes the currently reported transitive advisory and must be revalidated when Functions Framework updates.

Report vulnerabilities privately to the repository owner. Do not include credentials, project data, or exploitable production details in public issues.
