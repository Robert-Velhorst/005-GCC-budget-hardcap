# Google Cloud Budget Hardcap

A fail-safe Google Cloud Function that consumes Cloud Billing budget notifications from Pub/Sub and submits scoped Compute Engine stop actions when a configured threshold is reached.

The service starts in read-only `plan` mode. Production execution is impossible until the operator explicitly enables it and supplies budget, currency, and zone allowlists. It never manages an unlabelled VM, never restarts a VM it did not record as stopped, and persists event/action history in Firestore before changing cloud state.

## Safety model

- Default mode is `plan`; no VM action is submitted.
- `execute` mode requires `ALLOWED_BUDGET_NAMES`, `EXPECTED_CURRENCY`, and `ALLOWED_ZONES`; provider actions additionally require `AUTOMATION_ENABLED=true`.
- Only `RUNNING` VMs with `budget-hardcap=true` can be stopped.
- `budget-hardcap-protected=true`, excluded names, wrong zones, and wrong states are rejected.
- Every event is claimed in Firestore and every action intent is stored before the Compute API call.
- Deterministic Compute `requestId` values protect retries from duplicate provider actions.
- A cooldown, maximum action count, action delay, and stale-event limit constrain blast radius.
- Recovery is disabled by default and only targets `TERMINATED` VMs previously recorded as stopped by this service.
- Provider failures are rethrown so Eventarc/Pub/Sub retry policy can act.

## Workflow

```text
Pub/Sub CloudEvent
  -> decode and validate payload
  -> verify budget name, currency, and freshness
  -> evaluate stop/recovery/no-action policy
  -> generate a scoped plan
  -> claim event and enforce cooldown/action cap
  -> persist action intent
  -> submit Compute Engine request with deterministic requestId
  -> persist provider operation and managed-instance state
  -> structured Cloud Logging record and optional Pub/Sub notification
```

## Local setup

Requirements: Node.js 20 and npm.

```sh
npm ci
```

Create local configuration from `.env.example`. Environment files are ignored by Git. A local smoke test uses a clearly labelled test-only provider and cannot touch Google Cloud:

```sh
npm run lint
npm test
npm run test:coverage
npm run smoke
```

Validate configuration without provider access:

```sh
PROJECT_ID=your-project-id npm run doctor
```

With Application Default Credentials, verify read-only Compute project access:

```sh
PROJECT_ID=your-project-id npm run doctor -- --provider
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROJECT_ID` | Runtime project | Compute Engine project |
| `EXECUTION_MODE` | `plan` | `plan` or `execute` |
| `AUTOMATION_ENABLED` | `false` | Emergency execution switch |
| `ALLOWED_BUDGET_NAMES` | empty | Exact accepted budget display names; required for execution |
| `EXPECTED_CURRENCY` | empty | Expected ISO currency; required for execution |
| `ALLOWED_ZONES` | empty | Permitted VM zones; required for execution |
| `BUDGET_LIMIT` | `10` | Absolute fallback when no budget amount is present |
| `THRESHOLD_RATIO` | `1` | Actual/forecast threshold ratio |
| `MANAGED_LABEL_KEY/VALUE` | `budget-hardcap=true` | Required VM scope label |
| `PROTECTED_LABEL_KEY/VALUE` | `budget-hardcap-protected=true` | VM protection label |
| `EXCLUDED_INSTANCES` | empty | Comma-separated instance names denied explicitly |
| `MAX_ACTIONS_PER_EVENT` | `20` | Fail-closed per-event action cap |
| `ACTION_DELAY_MS` | `250` | Delay between provider requests |
| `COOLDOWN_SECONDS` | `300` | Repeated-decision cooldown |
| `MAX_EVENT_AGE_SECONDS` | `86400` | Reject stale budget events |
| `EVENT_LEASE_SECONDS` | `600` | Event-processing lease |
| `ENABLE_AUTOMATIC_RECOVERY` | `false` | Enable audit-backed restart policy |
| `RECOVERY_DELAY_SECONDS` | `3600` | Minimum time before recovery |
| `FIRESTORE_DATABASE_ID` | `(default)` | Firestore database |
| `FIRESTORE_PREFIX` | `budgetHardcap` | Collection prefix |
| `NOTIFICATION_TOPIC` | empty | Optional operator notification topic |

## Deploy

Terraform is the supported deployment path. It enables required APIs, creates the budget topic, service account, least-privilege custom VM role, optional Firestore database, source package, and second-generation Cloud Function.

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -out=budget-hardcap.tfplan
terraform apply budget-hardcap.tfplan
```

Keep the first deployment at `execution_mode = "plan"` and `automation_enabled = false`. Connect the emitted Pub/Sub topic to the intended Cloud Billing budget, label a disposable test VM, publish a real budget test notification, and inspect structured logs. Only then change both execution controls.

If a default Firestore database already exists, set `create_firestore_database = false`. Terraform state and plans are ignored and must be stored in an access-controlled remote backend for team use.

## Operations

- `npm run doctor -- --provider`: read-only credential/project check.
- `npm run reconcile`: dry-run review of ambiguous stop intents.
- `npm run reconcile -- --apply`: persist reconciled states after operator review.
- `npm run support:bundle`: print a redacted diagnostic bundle.
- `AUTOMATION_ENABLED=false`: emergency stop for new external actions.
- `EXECUTION_MODE=plan`: retain read-only planning and logging.

Detailed procedures are in [docs/OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md), security boundaries in [docs/SECURITY.md](docs/SECURITY.md), and implementation status in [docs/GOAL_COMPLETION_MATRIX.md](docs/GOAL_COMPLETION_MATRIX.md).

## Limitations

- Budget notifications are not real-time hard spending caps; Google documents delivery delay and costs may continue to accrue.
- Compute start/stop calls return long-running operations. The service records `SUBMITTED`, not false success.
- A live Google Cloud deployment and destructive disposable-VM acceptance test require the operator's project, billing budget, credentials, and approval. They are not simulated as completed.
- There is no frontend, session system, database migration layer, upload surface, AI provider, or SaaS billing surface because they are not part of this worker.
