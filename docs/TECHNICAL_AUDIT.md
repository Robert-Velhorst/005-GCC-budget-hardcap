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
| API acceptance was logged as success | Submitted operations are polled; only successful `DONE` becomes `COMPLETED` |
| No scope cap or cooldown | Fail-closed action cap, cooldown, request delay, stale-event rejection |
| No durable audit or recovery ownership | Firestore event, action, managed-instance, and control records |
| Poison events could retry forever | Non-retryable validation/safety/provider failures are audited and acknowledged |
| Retention existed only in prose | Event/action expiry timestamps and Terraform TTL field policies |
| Broad IAM guidance | Terraform custom role with list/get/start/stop/project-get only |
| Unauthenticated deployment guidance | Authenticated Eventarc Pub/Sub trigger; no public invoker grant |
| No tests or reproducible install | Lockfile, Node 22 CI, 58 tests, coverage gate, dependency audit |
| No operator surface or local persistence | Authenticated API, responsive dashboard, SQLite WAL, migrations, retention |
| Provider calls could hang the dashboard | Request deadlines, bounded probe timeout, cached/in-flight provider reads |
| Umbrella Google client delayed cold dashboard requests | Lazy provider initialization and Compute-only client import |
| Windows launchers could attach to the wrong process | Exclusive port preflight and child-process startup ownership checks |
| No controlled AI integration | Separate-token, read-only MCP connector with two bounded HAI tools |

## Architecture decision

The product has two explicit runtimes. The event-driven Node.js worker uses Firestore for cloud idempotency, action audit, cooldown state, and recovery ownership. The local control plane uses a native HTTP server, React static bundle, and SQLite WAL for local review history and settings. It does not claim to synchronize the two stores.

The control plane has no general plugin or mutation API. Loopback mode needs no login only when there are no forwarding headers; public mode requires a strong operator token, secure session cookie, CSRF/origin validation, and rate limiting. HAI uses a different bearer token and read-only MCP authority.

Provider adapters are isolated from parsing, policy, and orchestration. Tests use explicit in-memory/fake adapters that are labelled test-only and cannot be selected through production configuration.

## Remaining external validation

The repository has not been deployed into the operator's Google Cloud account. Provider IAM, Eventarc delivery, billing-budget topic wiring, Firestore location, quotas, and stop/start behavior must be verified in that account with a disposable labelled VM. The ngrok account also reported `ERR_NGROK_334` because its assigned endpoint was already online; pooling was deliberately not enabled. See `docs/ACCEPTANCE_TESTS.md`.
