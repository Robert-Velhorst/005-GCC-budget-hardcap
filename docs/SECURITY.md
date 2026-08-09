# Security and Threat Model

## Assets and trust boundaries

The protected assets are Compute Engine availability, billing-control integrity, Firestore and SQLite audit history, operator/HAI tokens, and the function service account. Trust boundaries are Eventarc/Pub/Sub delivery, budget payload parsing, runtime configuration, the local/public HTTP boundary, HAI MCP, Google credentials, Firestore, SQLite, and Compute Engine.

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
| False operator confidence | Terminal operation polling, explicit submitted/completed/failed states, live-provider caveats |
| Public dashboard takeover | Strong generated token, HttpOnly secure session, SameSite, CSRF/origin check, login throttling |
| Forwarded request bypasses local auth | Loopback bypass rejects all forwarded/real-IP headers and is disabled in public mode |
| HAI gains mutation authority | Separate bearer token, two read-only tools, bounded responses, no generic execution surface |
| Wrong local service is tunnelled | Port ownership preflight and child-exit-aware health startup |

## Authentication and authorization

The cloud worker is authenticated by Eventarc and Application Default Credentials. The local control plane permits a clean loopback request only when public access is disabled. Public requests require an operator bearer token or short-lived in-memory session; mutations additionally require CSRF and same-origin checks. HAI requires a separate bearer token and cannot use operator sessions.

Do not add `roles/editor`, `roles/owner`, public invoker access, or service-account keys. Prefer Workload Identity Federation for CI. Rotate access by replacing identities and revoking IAM bindings; there are no secrets in repository configuration.

## Data and privacy

Stored records contain project ID, budget display name, currency, cost values, event identifiers, VM names/zones, decisions, operation identifiers, timestamps, and sanitized errors. They contain operational metadata, not end-user personal data. Restrict Firestore and logs because project/VM names may still be commercially sensitive.

Event and action records receive an `expiresAt` timestamp and Terraform enables Firestore TTL, defaulting to 90 days. Managed-instance/control records remain until recovery/reconciliation because they define safe restart ownership. Configure Cloud Logging retention at the platform level after organizational approval. Export before deletion when longer audit retention is required.

## Supply chain

Dependencies are pinned and locked for development, the control runtime, and the function runtime. CI runs `npm ci` and `npm audit --audit-level=moderate`. Dependabot monitors all three npm manifests and GitHub Actions. The UUID override removes the currently reported transitive advisory and must be revalidated when Functions Framework updates.

Report vulnerabilities privately to the repository owner. Do not include credentials, project data, or exploitable production details in public issues.
