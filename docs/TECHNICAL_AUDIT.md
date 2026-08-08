# Technical Audit

## Starting point

- Branch and default branch: `main`.
- Starting commit: `51a6644` (`removed images`).
- Initial tracked files: `README.md`, `index.js`, `package.json`.
- Initial test command always failed and no lockfile, CI, infrastructure-as-code, persistence, or operator tooling existed.
- Existing local changes from the prior hardening pass were preserved as design input and replaced only where the expanded specification required stronger boundaries.

## Material findings resolved

| Finding | Resolution |
| --- | --- |
| Every VM was selected regardless of status | Status, label, protection, zone, and exclusion filters |
| Project and threshold were hard-coded | Validated environment configuration |
| Under-budget messages restarted all stopped VMs | Recovery is opt-in and audit-backed |
| Errors were swallowed | Errors are classified, audited, logged, and rethrown |
| Duplicate Pub/Sub delivery could repeat actions | Firestore claims plus deterministic Compute request IDs |
| API acceptance was logged as success | Outcomes are called `SUBMITTED` with provider operation identifiers |
| No scope cap or cooldown | Fail-closed action cap, cooldown, request delay, stale-event rejection |
| No durable audit or recovery ownership | Firestore event, action, managed-instance, and control records |
| Broad IAM guidance | Terraform custom role with list/get/start/stop/project-get only |
| Unauthenticated deployment guidance | Authenticated Eventarc Pub/Sub trigger; no public invoker grant |
| No tests or reproducible install | Lockfile, CI, 35 tests, coverage gate, dependency audit |

## Architecture decision

The product remains a small event-driven Node.js service. A frontend, general API, relational database, user accounts, uploads, and scheduler would increase attack surface without advancing the budget-control workflow. Firestore is used only for idempotency, action audit, cooldown state, and recovery ownership.

Provider adapters are isolated from parsing, policy, and orchestration. Tests use explicit in-memory/fake adapters that are labelled test-only and cannot be selected through production configuration.

## Remaining external validation

The repository has not been deployed into the operator's Google Cloud account. Provider IAM, Eventarc delivery, billing-budget topic wiring, Firestore location, quotas, and stop/start behavior must be verified in that account with a disposable labelled VM. See `docs/ACCEPTANCE_TESTS.md`.
