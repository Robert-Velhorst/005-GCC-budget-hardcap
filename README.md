# Google Cloud Budget Hardcap

[![CI](https://github.com/Robert-Velhorst/005-GCC-budget-hardcap/actions/workflows/ci.yml/badge.svg)](https://github.com/Robert-Velhorst/005-GCC-budget-hardcap/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

Google Cloud Budget Hardcap is a safety-focused system that can automatically stop selected Google Compute Engine virtual machines when a Cloud Billing budget reaches a configured threshold. It also includes a Windows operator application for viewing the project, reviewing the policy, previewing decisions, and inspecting the audit history.

The software is deliberately conservative:

- it starts in read-only `plan` mode;
- automatic cloud actions are disabled by default;
- execution requires explicit budget, currency, and zone allowlists;
- only explicitly labelled virtual machines can be stopped;
- protected or excluded virtual machines are never selected;
- automatic recovery can restart only virtual machines that this system previously recorded as stopped.

> [!IMPORTANT]
> Despite the project name, this is not a guaranteed, instantaneous spending cap. Standard Google Cloud budget notifications are based on delayed billing data and are normally published only several times per day. Costs can therefore exceed the configured amount before this software receives and processes a notification. This project reduces the risk of continued Compute Engine VM charges; it does not replace provider-native spend caps, quota controls, monitoring, or human oversight.

## Contents

- [Who this is for](#who-this-is-for)
- [What the system does](#what-the-system-does)
- [Current scope](#current-scope)
- [How it works](#how-it-works)
- [Safety model](#safety-model)
- [Current implementation status](#current-implementation-status)
- [Windows quick start](#windows-quick-start)
- [Using the dashboard](#using-the-dashboard)
- [Developer setup](#developer-setup)
- [Deploying to Google Cloud](#deploying-to-google-cloud)
- [Configuration reference](#configuration-reference)
- [Operations](#operations)
- [HTTP API](#http-api)
- [HAI read-only connector](#hai-read-only-connector)
- [Data, privacy, and security](#data-privacy-and-security)
- [Testing and verification](#testing-and-verification)
- [Repository structure](#repository-structure)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

## Who this is for

### Non-technical operators

Use the Windows application to answer practical questions such as:

- Is the Google Cloud connection working?
- Which cloud computers exist in the configured project?
- Which computers are eligible for budget protection?
- Is the system planning only, or is live automation enabled?
- What would happen if the budget threshold were reached?
- Which events and stop/start actions have been recorded?
- Is a failure waiting for operator review?

The application uses the term **cloud computer** for a Google Compute Engine virtual machine, also called a **VM** or **instance**.

### Developers and cloud operators

The repository provides:

- a Node.js Cloud Run function, deployed as a second-generation Cloud Function, that consumes Cloud Billing Pub/Sub notifications;
- authenticated Google Compute Engine REST adapters for listing, stopping, starting, and polling virtual machines;
- Firestore-backed event claims, action records, recovery ownership, cooldown state, and retention;
- a local Node.js control plane with a React/Vite dashboard and SQLite storage;
- Terraform for the worker, health function, Pub/Sub, Firestore, service account, and least-privilege IAM;
- separate locked Docker images for the control plane and cloud function;
- a portable Windows x64 package builder;
- an optional authenticated ngrok launcher;
- an optional read-only MCP connector for HAI;
- automated unit, integration, security-boundary, smoke, build, and CI checks.

## What the system does

When Google Cloud publishes a budget notification, the deployed worker:

1. Decodes and validates the Pub/Sub CloudEvent.
2. Rejects the event if its budget name, currency, timestamp, or source is outside the configured scope.
3. Compares actual and forecast spending information with the configured threshold.
4. Produces one of three decisions: `STOP`, `RECOVER`, or `NO_ACTION`.
5. In `plan` mode, reports the proposed result without writing audit data or changing a VM.
6. In `execute` mode, claims the event in Firestore so duplicate delivery is safe.
7. Checks the emergency automation switch, cooldown, action cap, zone allowlist, VM labels, exclusions, state, and recovery ownership.
8. Stores each action intent before calling Google Compute Engine.
9. Sends a deterministic `requestId` with every start/stop request to protect retries from duplicate actions.
10. Polls the Google Compute operation until terminal success or a controlled timeout.
11. Records the final result and optionally publishes an operator notification.

The local dashboard is an operator and preview surface. It can read real Google Cloud inventory with Application Default Credentials, but dashboard policy changes are stored locally in SQLite. They do **not** redeploy or reconfigure the Cloud Function. Deployed worker settings are changed through Terraform or the function's environment configuration.

## Current scope

This distinction is essential:

| Question | Current behavior |
| --- | --- |
| How many Google Cloud projects are configured at one time? | One. `PROJECT_ID` identifies a single project. |
| Which cloud computers are visible? | All Compute Engine VMs returned for that configured project. |
| Which cloud computers can be stopped? | Only eligible, `RUNNING` VMs with the managed label, in an allowed zone, not protected, and not excluded. |
| Which cloud computers can be restarted automatically? | Only eligible, `TERMINATED` VMs that this service previously recorded as successfully stopped, after the recovery delay. |
| Does it manage every project in an organization or billing account? | No. Organization-wide and multi-project orchestration are not implemented. |
| Does it stop Cloud Run, GKE, Cloud SQL, storage, networking, or third-party services? | No. Automated actions are limited to Compute Engine VM start/stop operations. |
| Does the dashboard's local switch change the deployed worker? | No. The dashboard policy is local; production worker configuration is deployed separately. |

### VM eligibility

By default, a VM must have this label to be eligible:

```text
budget-hardcap=true
```

A VM with this label is always protected from this system:

```text
budget-hardcap-protected=true
```

The complete action gate is:

| Gate | Required for stop | Required for automatic start |
| --- | --- | --- |
| Project | Configured `PROJECT_ID` | Configured `PROJECT_ID` |
| Budget notification | Accepted budget name and currency | Accepted budget name and currency |
| Budget decision | Threshold reached or exceeded | Below threshold and recovery enabled |
| Execution controls | `execute` and automation enabled | `execute` and automation enabled |
| Managed label | Exact configured key/value | Exact configured key/value |
| Protected label | Must not match | Must not match |
| Explicit exclusion | Name must not be excluded | Name must not be excluded |
| Zone | Must be allowlisted | Must be allowlisted |
| VM state | `RUNNING` | `TERMINATED` |
| Ownership record | Not applicable | Must show this service stopped the VM successfully |
| Recovery delay | Not applicable | Must have elapsed |

## How it works

```text
Google Cloud Billing budget
        |
        | programmatic notification
        v
Pub/Sub topic
        |
        | Eventarc delivery with retry
        v
Cloud Function worker
        |
        +--> validate source, budget, currency, age, and policy
        +--> list Compute Engine VMs in one configured project
        +--> apply label, protection, exclusion, zone, and state gates
        +--> claim event and store action intent in Firestore
        +--> stop/start eligible VMs through authenticated Compute REST calls
        +--> poll the zone operation and record the terminal result
        +--> write structured logs and optional Pub/Sub notifications

Windows/local control plane
        |
        +--> read Google project and VM inventory through local credentials
        +--> show local or Firestore audit history
        +--> preview a budget decision in forced plan mode
        +--> store local dashboard policy in SQLite
        +--> optionally expose read-only HAI context over MCP
```

### Decision rules

The worker calculates the ratio using the budget amount in the notification. If that amount is absent, it uses `BUDGET_LIMIT` as a fallback.

A `STOP` decision is made when any available value reaches `THRESHOLD_RATIO`:

- actual cost divided by budget amount;
- `alertThresholdExceeded` from Google Cloud Billing;
- `forecastThresholdExceeded` from Google Cloud Billing.

If the threshold is not reached and automatic recovery is enabled, the decision is `RECOVER`. Recovery still selects only eligible, delayed, service-owned stopped VMs. If recovery is disabled, the decision is `NO_ACTION`.

### Execution states

| Mode | Firestore event claim | Compute list | VM start/stop |
| --- | --- | --- | --- |
| `plan` | No | Yes, when a stop plan is needed | Never |
| `execute` + automation disabled | Yes; event is recorded as ignored | No action inventory needed | Never |
| `execute` + automation enabled | Yes | Yes | Only after all gates pass |

Pub/Sub delivery is at least once and notifications can arrive more than once or out of order. Firestore claims, event leases, cooldown state, persisted action intents, pending-operation resumption, and deterministic Google request IDs are used together to make retries controlled and auditable.

## Safety model

### Fail-closed configuration

`EXECUTION_MODE=execute` is rejected unless all of the following are non-empty:

- `ALLOWED_BUDGET_NAMES`
- `EXPECTED_CURRENCY`
- `ALLOWED_ZONES`

Even then, no provider action is allowed until `AUTOMATION_ENABLED=true`.

### Blast-radius controls

- One explicitly configured project.
- Exact accepted budget display names.
- Exact expected ISO currency.
- Explicit zone allowlist.
- Opt-in managed label.
- Opt-out protected label.
- Explicit instance-name denylist.
- Maximum 100 actions per event; default 20.
- Delay between provider requests.
- Repeated-decision cooldown.
- Maximum accepted event age.
- Bounded provider request and operation-poll deadlines.
- Cloud Function instance-count limits in Terraform.

### Audit before action

In execute mode, the worker claims an event before processing it and records each action intent before the Compute API call. A submitted operation remains auditable if polling times out. A retried event resumes polling a previously submitted operation rather than blindly submitting the action again.

### Recovery ownership

Automatic recovery is intentionally stricter than stopping. A currently stopped VM is not enough. Firestore must contain a completed stop record for that exact project, zone, and instance, and the recovery delay must have elapsed. Manually stopped VMs and VMs stopped by another system are not eligible for automatic restart.

### Authentication boundaries

- Local mode accepts only clean loopback requests and is intended for one Windows user.
- Public mode requires a strong operator token, a secure HTTP-only session cookie, origin/CSRF checks for writes, login throttling, and security headers.
- The HAI connector uses a separate token and exposes only two read-only tools.
- The deployed worker uses a dedicated Google service account and a custom Compute role rather than broad Editor or Owner access.
- Application Default Credentials are used locally; service-account key files are neither generated nor required by this repository.

## Current implementation status

The following describes this repository revision, not a promise about any running Google Cloud account.

| Area | Status | Evidence or boundary |
| --- | --- | --- |
| Budget event parser and policy | Implemented and automated-test covered | Malformed, stale, wrong-budget, wrong-currency, actual, forecast, stop, recovery, and no-action paths are covered. |
| Compute Engine adapter | Implemented and automated-test covered | Real authenticated REST list/get/start/stop/operation calls; provider failures and request deadlines are covered. |
| Firestore audit and idempotency | Implemented and automated-test covered | Event claims, leases, actions, pending-operation resumption, managed ownership, control state, and TTL fields. |
| Windows operator application | Implemented and locally verified | Setup, loopback launch, authentication boundary, provider states, preview, policy review, audit views, and portable package were exercised. |
| Public ngrok route | Implemented and acceptance tested | A dedicated authenticated route was tested, including unauthenticated rejection. The repository does not install an always-on tunnel service. |
| HAI MCP connector | Implemented and automated-test covered | Disabled by default, separate bearer token, read-only status and incident tools. |
| Terraform and Docker | Implemented and locally validated | Terraform formatting/init/validation and both non-root Docker runtime paths were checked. |
| GitHub Actions | Implemented | CI installs locked dependencies, checks syntax, runs coverage, builds the web client, runs smoke tests, audits dependencies, and builds both images. |
| Current dependency audit | Action required | A fresh audit on 2026-09-05 reports one high and one moderate transitive advisory in the three lockfile sets. Fixed transitive versions are available, but dependency files are outside this README-only change. |
| Live Google Cloud deployment | Not completed | Billing-project quota prevented activation of the isolated test project. No production project deployment is claimed. |
| Destructive disposable-VM acceptance | Not completed | No real VM was stopped or restarted. It requires account-owner credentials, billing, IAM, a disposable labelled VM, and explicit operator approval. |
| Multi-project or organization-wide operation | Not implemented | The current architecture accepts one `PROJECT_ID`. |
| Live load and quota baseline | Not completed | Automated bounds exist, but provider-scale behavior has not been measured in a live account. |

The latest recorded full implementation baseline contains 66 passing tests, coverage above the configured thresholds, a successful production web build, a test-only smoke run, a clean dependency audit at that time, Terraform validation, Docker runtime checks, browser checks, and Windows package checks. A fresh audit must always be treated as authoritative; the 2026-09-05 audit now reports one high and one moderate transitive advisory. See [Testing and verification](#testing-and-verification) and [docs/FINAL_VERIFICATION_REPORT.md](docs/FINAL_VERIFICATION_REPORT.md). The verification report records the original ngrok endpoint conflict; a later commit added and verified dedicated-domain support.

## Windows quick start

This section runs the local dashboard in read-only mode. It does not deploy anything or stop a cloud computer.

### Requirements

- Windows 11.
- Node.js 22, 23, or 24; Node.js 22 LTS is recommended. Node.js 25 is intentionally rejected.
- npm, included with Node.js.
- Google Cloud CLI only if you want real project and VM information.
- Permission to view the selected Google Cloud project.

### 1. Prepare the application

Open PowerShell in the repository folder and run:

```powershell
.\scripts\setup-local.ps1
```

The setup script:

- verifies the Node.js version;
- installs exactly the dependencies in `package-lock.json`;
- builds the web dashboard;
- creates `.env.local` from `.env.example` if needed;
- generates separate operator and HAI tokens in `.runtime\control.env`;
- restricts that token file to the current Windows account;
- does not print the generated secrets.

Both `.env.local` and `.runtime` are excluded from Git.

### 2. Select the Google Cloud project

Open `.env.local` and replace:

```text
PROJECT_ID=your-project-id
```

Keep these safety defaults during setup:

```text
EXECUTION_MODE=plan
AUTOMATION_ENABLED=false
```

The budget name, currency, and zones should match the intended deployment even in plan mode so the preview is meaningful.

### 3. Sign in for read-only Google Cloud information

If the Google Cloud CLI is installed:

```powershell
gcloud auth application-default login
```

Use an identity that can read the project and list Compute Engine instances. The local application reports `setup_required` or `unavailable` when credentials or provider access are missing; it does not invent project, spending, or VM data.

### 4. Start the dashboard

```powershell
.\scripts\start-local.ps1
```

The launcher starts on `http://127.0.0.1:8787`, opens the browser, and keeps running until the process is stopped. It refuses to attach to an occupied port. Logs are written under `.runtime`.

To use a different port, change `CONTROL_PORT` in `.env.local` before launching.

### Portable Windows package

Build a portable x64 ZIP with a bundled supported Node.js runtime:

```powershell
npm run build:windows
```

The ZIP and its SHA-256 file are created under `dist`. The archive excludes local tokens, environment files, databases, credentials, and logs. After extraction, launch `Start GCC Budget Hardcap.cmd`; first run creates account-restricted local secrets. No separate Node.js installation is required for the extracted package.

The last recorded verified Windows artifact used bundled Node.js 24.14 and had SHA-256:

```text
cedcf8d57e53f4f21f551c70165acd7dd936f3fe193108b001fd033c191a4eee
```

Always compare a newly built artifact with the newly generated checksum rather than assuming an older checksum still applies.

### Optional authenticated ngrok access

Install and authenticate ngrok separately, then run:

```powershell
.\scripts\start-ngrok.ps1
```

For a reserved ngrok domain:

```powershell
.\scripts\start-ngrok.ps1 -Domain your-domain.ngrok.app
```

The launcher:

- starts the control plane on loopback;
- forces public authentication and trusted-proxy handling;
- requires the generated operator token to be at least 32 characters;
- validates a supplied hostname;
- disables the local ngrok inspection interface;
- stops the local child process when ngrok exits.

The URL is available only while the launcher and ngrok process are running unless the operator separately installs a durable service. Do not expose the local server directly to the internet.

## Using the dashboard

The dashboard provides these main operator views:

- **Overview:** latest observed budget state, local policy, provider status, and audit totals.
- **Instances:** all Compute Engine VMs visible in the configured project, with running/stopped state and the reason each VM is eligible or excluded.
- **Actions:** recent action records from the selected audit source.
- **Policy:** local plan/execute, automation, recovery, budget amount, threshold, and action-cap controls.
- **Integrations:** Google Cloud, database, cloud audit, ngrok, HAI, and notification connection states.

### Important dashboard behavior

- Refreshing the overview can bypass the short provider cache and read Google Cloud again.
- Budget preview always forces `plan` mode and disables automation for that preview.
- Typing `ENABLE EXECUTION` is required before the local policy can switch to execute mode.
- If execute is selected without explicitly enabling automation, automation remains disabled.
- Dashboard policy is persisted to SQLite and affects local previews/status only.
- Dashboard policy does not update Terraform, Cloud Function environment variables, or a Cloud Billing budget.
- Audit history defaults to local SQLite. Set `CONTROL_AUDIT_SOURCE=firestore` to read the deployed worker's Firestore records through local Google credentials.
- When a provider or Firestore source cannot be reached, the UI shows it as unavailable rather than displaying false zero values.

## Developer setup

### Supported runtime

- Node.js `>=22 <25`
- npm with the committed lockfile

The cloud deployment itself uses the Google `nodejs22` runtime.

### Install and verify

On Windows PowerShell:

```powershell
npm ci
npm run verify
npm audit --audit-level=moderate
```

On Linux or macOS:

```sh
npm ci
npm run verify
npm audit --audit-level=moderate
```

`npm run verify` runs syntax checks, coverage-gated tests, the production web build, and the isolated smoke test.

### Run individual components

```sh
npm run lint
npm test
npm run test:coverage
npm run build:web
npm run smoke
```

Start the local control plane after creating `.env.local` and building the web client:

```sh
npm run build:web
npm run start:control
```

Start the React development server:

```sh
npm run dev
```

Start the budget CloudEvent function locally:

```sh
npm start
```

Start the separate HTTP health function locally on port 8081:

```sh
npm run start:health
```

### Configuration checks

Validate configuration without contacting Google Cloud:

```powershell
$env:PROJECT_ID='your-project-id'
npm run doctor
```

With Application Default Credentials, check project, Compute inventory, and Firestore read access without starting or stopping a VM:

```powershell
$env:PROJECT_ID='your-project-id'
npm run doctor -- --provider
```

Equivalent POSIX syntax:

```sh
PROJECT_ID=your-project-id npm run doctor
PROJECT_ID=your-project-id npm run doctor -- --provider
```

### Test isolation

The automated tests and `npm run smoke` use explicit fakes and a clearly labelled test provider. They do not use local Google credentials and cannot mutate a Google Cloud project. Live provider acceptance is a separate manual procedure.

## Deploying to Google Cloud

Terraform is the supported infrastructure path. It creates or configures:

- the required Google APIs;
- a source archive bucket with uniform bucket-level access;
- a Pub/Sub topic for budget notifications;
- an optional Pub/Sub topic for operator notifications;
- an optional default Firestore Native database;
- TTL policies for event and action audit records;
- a dedicated function service account;
- a custom Compute role limited to project/instance reads, VM start/stop, and zone-operation reads;
- the budget CloudEvent function and Eventarc Pub/Sub trigger with retry;
- a separate authenticated health function.

Terraform does **not** create or select the Cloud Billing budget itself. After deployment, an authorized billing operator must connect the intended budget to the Terraform-created Pub/Sub topic in Google Cloud Billing.

> [!WARNING]
> Terraform builds the function source archive from the repository directory and `.gitignore` does not control that archive. Deploy only from a clean checkout that contains no `.env.local`, `.runtime`, credentials, databases, logs, Terraform state, or other secret/untracked files under the repository root. Inspect the generated source archive before every production apply. Hardening the archive input to an explicit deployment-only staging directory remains advisable.

### Prerequisites

- Terraform 1.7.0 or newer.
- Terraform providers within the committed constraints: Google `~> 7.0`, Archive `~> 2.7`, and Random `~> 3.7`.
- Google Cloud credentials authorized to enable APIs and create the declared resources and IAM bindings.
- An active billing account linked to the target project.
- A Cloud Billing budget whose exact display name and currency are known.
- A decision about Firestore location; this cannot be casually changed after creation.
- A remote, access-controlled Terraform backend for team or production use.

### Plan-first deployment

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan -out=budget-hardcap.tfplan
terraform apply budget-hardcap.tfplan
```

Windows PowerShell can create the variables file with:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
```

Keep the first deployment read-only:

```hcl
execution_mode     = "plan"
automation_enabled = false
```

Then:

1. Connect the Terraform output `budget_topic` to the intended Cloud Billing budget.
2. Confirm the budget display name and currency exactly match the allowlists.
3. Label only a disposable test VM with `budget-hardcap=true`.
4. Confirm its zone is allowlisted and that it does not contain important Local SSD-only data or active work.
5. Send a real Google budget test notification.
6. Inspect Cloud Logging, function results, Firestore records, and the generated plan.
7. Obtain explicit operator approval for a destructive test.
8. Change `execution_mode` to `execute` while leaving automation disabled, deploy, and verify the ignored event path.
9. Only after sign-off, set `automation_enabled = true`, apply, and test the disposable VM.
10. Verify terminal stop and owned recovery behavior before expanding the label scope.

### Terraform variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `project_id` | Yes | none | Single project containing the functions and managed VMs. |
| `region` | No | `europe-west4` | Function and supporting resource region. |
| `budget_topic_name` | No | `budget-alerts` | Pub/Sub topic that receives budget notifications. |
| `allowed_budget_names` | Yes | none | Exact accepted Cloud Billing budget display names. |
| `expected_currency` | Yes | none | Expected ISO 4217 currency. |
| `allowed_zones` | Yes | none | Zones where VM actions may occur. |
| `execution_mode` | No | `plan` | `plan` or `execute`. |
| `automation_enabled` | No | `false` | Emergency provider-action switch. |
| `enable_automatic_recovery` | No | `true` | Permit owned, delayed recovery below threshold. |
| `budget_limit` | No | `10` | Fallback amount when an event has no budget amount. |
| `threshold_ratio` | No | `1` | Ratio that triggers stop planning/execution. |
| `max_actions_per_event` | No | `20` | Per-event action cap. |
| `operation_timeout_seconds` | No | `180` | Maximum operation polling time per invocation; 10 to 480. |
| `operation_poll_interval_ms` | No | `2000` | Delay between zone-operation status reads. |
| `provider_request_timeout_ms` | No | `8000` | Per-request provider deadline; 1,000 to 60,000. |
| `firestore_prefix` | No | `budgetHardcap` | Firestore collection prefix. |
| `audit_retention_days` | No | `90` | Event/action TTL; 1 to 3,650 days. |
| `notification_topic_name` | No | empty | Optional operator outcome topic. |
| `create_firestore_database` | No | `true` | Create the default Firestore database. Set false if it already exists. |
| `firestore_location` | No | `eur3` | Location used only when creating Firestore. |
| `health_invoker_members` | No | empty | IAM members allowed to invoke the authenticated health function. |

Terraform outputs the worker name, budget topic, function service-account email, and health URI.

### Docker

The repository has separate locked dependency manifests for each production role:

- `Dockerfile` builds the control plane and excludes Functions Framework.
- `Dockerfile.function` builds the Cloud Function role and excludes SQLite, MCP, React, and Vite.

The Compose configuration runs the control plane as a non-root user, drops Linux capabilities, uses `no-new-privileges`, persists SQLite data in a named volume, mounts Google Cloud CLI credentials read-only, and publishes the port to host loopback only.

```sh
docker compose config
docker compose build
docker compose up
```

Compose expects `.env.local` and `.runtime/control.env`; run the Windows setup script or create equivalent uncommitted files first. Public authentication is enabled inside the container even though the host port is loopback-bound.

## Configuration reference

Copy `.env.example` to `.env.local` for local use. Comma-separated lists are trimmed and deduplicated. Boolean values must be exactly `true` or `false`.

### Worker and shared policy

| Variable | Default | Valid range or format | Purpose |
| --- | --- | --- | --- |
| `PROJECT_ID` | Google runtime aliases | Non-empty project ID | Compute Engine project. `GOOGLE_CLOUD_PROJECT` and `GCP_PROJECT` are fallback aliases. |
| `EXECUTION_MODE` | `plan` | `plan`, `execute` | Select read-only planning or the execute workflow. |
| `AUTOMATION_ENABLED` | `false` | boolean | Emergency switch for external VM actions. |
| `ALLOWED_BUDGET_NAMES` | empty | comma-separated exact names | Accepted budget display names; required in execute mode. |
| `EXPECTED_CURRENCY` | empty | ISO currency code | Accepted event currency; required in execute mode and normalized to uppercase. |
| `ALLOWED_ZONES` | empty | comma-separated zones | Action zone allowlist; required in execute mode. |
| `BUDGET_LIMIT` | `10` | number greater than 0 | Fallback budget amount. |
| `THRESHOLD_RATIO` | `1` | greater than 0, at most 10 | Stop threshold; `1` means 100 percent. |
| `MANAGED_LABEL_KEY` | `budget-hardcap` | Google-compatible lowercase label key | Opt-in VM label key. |
| `MANAGED_LABEL_VALUE` | `true` | Google-compatible lowercase label value | Required opt-in VM label value. |
| `PROTECTED_LABEL_KEY` | `budget-hardcap-protected` | Google-compatible lowercase label key | Never-stop label key. |
| `PROTECTED_LABEL_VALUE` | `true` | Google-compatible lowercase label value | Never-stop label value. |
| `EXCLUDED_INSTANCES` | empty | comma-separated exact VM names | Explicit VM denylist. |
| `MAX_ACTIONS_PER_EVENT` | `20` | integer 1 to 100 | Per-event action cap. |
| `ACTION_DELAY_MS` | `250` | integer 0 to 60,000 | Delay between provider requests. |
| `OPERATION_TIMEOUT_SECONDS` | `180` | integer 10 to 480 | Per-invocation operation polling limit. |
| `OPERATION_POLL_INTERVAL_MS` | `2000` | integer 250 to 30,000 | Delay between operation status reads. |
| `PROVIDER_REQUEST_TIMEOUT_MS` | `8000` | integer 1,000 to 60,000 | Deadline for each Google request. |
| `COOLDOWN_SECONDS` | `300` | integer 0 to 86,400 | Minimum interval between repeated decisions. |
| `MAX_EVENT_AGE_SECONDS` | `86400` | integer 60 to 2,592,000 | Reject notifications older than this. |
| `EVENT_LEASE_SECONDS` | `600` | integer 30 to 3,600 | Processing lease for duplicate-event control. |
| `ENABLE_AUTOMATIC_RECOVERY` | `true` | boolean | Allow owned recovery when below threshold. |
| `RECOVERY_DELAY_SECONDS` | `3600` | integer 0 to 2,592,000 | Minimum age of a completed stop before restart. |
| `FIRESTORE_DATABASE_ID` | `(default)` | database ID | Firestore database used by the worker/audit reader. |
| `FIRESTORE_PREFIX` | `budgetHardcap` | non-empty string | Prefix for Firestore collections. |
| `AUDIT_RETENTION_DAYS` | `90` | integer 1 to 3,650 | TTL assigned to event and action records. |
| `NOTIFICATION_TOPIC` | empty | Pub/Sub topic name | Optional completion/failure notification target. |

### Local control plane

| Variable | Default | Valid range or format | Purpose |
| --- | --- | --- | --- |
| `CONTROL_HOST` | `127.0.0.1` | loopback unless public mode is enabled | HTTP listener. |
| `CONTROL_PORT` | `8787` | integer 1 to 65,535 | HTTP port. |
| `LOCAL_DATABASE_PATH` | `.runtime/budget-hardcap.db` | filesystem path | SQLite policy and local audit database. |
| `CONTROL_AUDIT_SOURCE` | `local` | `local`, `firestore` | Select local or deployed-worker audit reads. |
| `PUBLIC_ACCESS_ENABLED` | `false` | boolean | Enforce public-mode authentication controls. |
| `TRUST_PROXY` | `false` | boolean | Honor the intended proxy boundary; launcher enables it for ngrok. |
| `CONTROL_PLANE_TOKEN` | empty | at least 32 characters for public mode | Operator login/bearer secret. |
| `SESSION_TTL_MINUTES` | `480` | integer 15 to 1,440 | Operator session lifetime. |
| `PROVIDER_CACHE_SECONDS` | `30` | integer 5 to 300 | Google inventory cache lifetime. |
| `HAI_CONNECTOR_ENABLED` | `false` | boolean | Enable the MCP endpoint. |
| `HAI_CONNECTOR_TOKEN` | empty | at least 32 characters when enabled | Separate HAI bearer secret; must differ from operator token. |

## Operations

### Routine checks

| Task | Command or action | External effect |
| --- | --- | --- |
| Check local configuration | `npm run doctor` | None |
| Check Google project/inventory/Firestore reads | `npm run doctor -- --provider` | Read-only provider calls |
| Run the full local quality gate | `npm run verify` | No Google Cloud calls |
| Review ambiguous actions | `npm run reconcile` | Dry run; no persistence changes |
| Apply reviewed reconciliation | `npm run reconcile -- --apply` | Updates audit state only; does not start/stop VMs |
| Create a diagnostic report | `npm run support:bundle` | Prints a redacted allowlisted report to standard output |

### Emergency stop procedure

For the deployed worker, use the fastest authorized reversible control available:

1. Set `automation_enabled = false` and apply the Terraform change, or update the worker environment to `AUTOMATION_ENABLED=false` through the approved release process.
2. If immediate delivery interruption is required, detach or disable the budget Pub/Sub trigger using an audited operator procedure.
3. Confirm logs show `AUTOMATION_DISABLED` or that no new invocations are arriving.
4. Review submitted/pending Compute operations; disabling new actions cannot undo an operation Google already accepted.
5. Keep the audit data and Terraform state intact for investigation.

Changing the dashboard's local automation switch does not disable a separately deployed Cloud Function.

### Reconciliation

An action can remain `SUBMITTED` when Google accepted it but the worker did not observe terminal completion before its deadline. Run the reconciliation command without `--apply` first. It compares stored action intent with current provider/audit information and shows proposed corrections. Apply only after operator review.

### Logs and diagnostics

- Cloud worker logs are structured JSON in Cloud Logging.
- Local control-plane output and errors are under `.runtime` when started by the PowerShell launchers.
- The support bundle exposes only an allowlisted, redacted configuration summary; inspect its output before sharing it.
- Do not share `.env.local`, `.runtime/control.env`, Application Default Credentials, SQLite files, Terraform state, or raw provider responses publicly.

### Backup and restore

- Store Terraform state in a protected remote backend with versioning and access logging.
- Use managed Firestore export/import for durable worker audit backup when required by the operating policy.
- Back up the local SQLite file only while respecting SQLite WAL consistency; stopping the local control plane first is the simplest safe procedure.
- Test restoration in an isolated project before relying on the backup process.

### Retiring the service

Before destroying infrastructure:

1. Disable automation and verify no operation is pending.
2. Disconnect the Cloud Billing budget from the Pub/Sub topic.
3. Export required Firestore audit records and preserve Cloud Logging evidence according to policy.
4. Record the state of VMs this system marked as managed/stopped.
5. Review the Terraform destruction plan. The source bucket is not force-destroyed and the Firestore database uses an abandon deletion policy.
6. Remove labels only after deciding which VMs should remain stopped or running.

See [docs/OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md) for the detailed rollout, incident, rollback, recovery, and retirement procedures.

## HTTP API

The control plane serves the built React application and a versioned JSON API.

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/healthz` | None | Lightweight process health. |
| `GET` | `/readyz` | None | Database/provider readiness state; does not expose inventory. |
| `POST` | `/api/v1/session` | Operator token in JSON body | Create a rate-limited operator session. |
| `GET` | `/api/v1/session` | Operator identity | Inspect session/authentication mode. |
| `DELETE` | `/api/v1/session` | Operator identity + CSRF for session mode | Log out. |
| `GET` | `/api/v1/overview` | Operator identity | Policy, provider inventory, budget summary, audit, and integrations. Add `?refresh=true` to bypass provider cache. |
| `GET` | `/api/v1/policy` | Operator identity | Read effective local policy. |
| `PUT` | `/api/v1/policy` | Operator identity + CSRF for session mode | Update the persisted local policy. |
| `POST` | `/api/v1/budget/preview` | Operator identity + CSRF for session mode | Generate a forced-plan preview using real or test provider inventory. |
| `GET/POST/DELETE` | `/mcp` | Separate HAI bearer identity | Streamable HTTP MCP transport when enabled. |

Security behavior includes:

- 64 KiB JSON request-body limit;
- `application/json` enforcement;
- no-store JSON responses;
- CSP, frame denial, MIME sniffing protection, referrer restrictions, permissions policy, COOP, and CORP headers;
- static-path containment and single-page application fallback;
- HTTP-only, `SameSite=Strict` sessions and `Secure` cookies in public mode;
- CSRF and origin validation on mutating session requests.

The detailed public contract used by HAI is in [hai/openapi.yaml](hai/openapi.yaml).

## HAI read-only connector

The HAI connector is disabled by default. When explicitly enabled, `/mcp` exposes only:

| Tool | Result |
| --- | --- |
| `get_budget_hardcap_status` | Current policy, budget summary, provider readiness, VM counts, audit totals, and bounded recent failures. |
| `list_budget_hardcap_incidents` | Up to ten recent failed actions with bounded operational metadata. |

The connector has `read_only_advisory` authority. It cannot:

- change policy;
- start or stop a VM;
- run a process;
- browse websites;
- send email;
- access arbitrary files;
- retrieve credentials or raw provider responses.

It uses a token separate from the operator token and limits concurrent MCP sessions. See [hai/README.md](hai/README.md) and [hai/connector.json](hai/connector.json).

## Data, privacy, and security

### Stored data

The service stores operational metadata needed for audit and safe retries, including:

- event and message identifiers;
- project ID, budget display name, currency, cost, and budget amounts;
- decision and status;
- VM name, zone, intended action, deterministic request ID, and Google operation name/status;
- timestamps, cooldown state, recovery ownership, and expiry fields;
- normalized error codes and sanitized error messages.

The product does not provide an end-user profile system, file upload, advertising analytics, payment checkout, or autonomous AI action surface. VM names and project metadata can still be sensitive operational information and should be protected accordingly.

### Firestore collections

Collection names use `FIRESTORE_PREFIX` and cover:

- events and event leases;
- action intents, submissions, completions, and failures;
- managed VM ownership used for recovery;
- per-project control/cooldown state.

Terraform configures TTL on event and action `expiresAt` fields. Managed ownership and control records require an explicit lifecycle policy because they are part of recovery safety.

### Local SQLite

The control plane uses SQLite with write-ahead logging and transactional schema migration. It stores local dashboard settings and, by default, local audit information. Selecting Firestore as the audit source does not move local settings to Firestore.

### Secrets

- Never commit `.env.local`, `.runtime`, credentials, tokens, Terraform state, plans, databases, logs, or support bundles.
- Prefer Application Default Credentials for local work and Workload Identity Federation for CI or automation.
- Do not create long-lived service-account keys unless an independently approved operating requirement makes them unavoidable.
- Rotate operator/HAI tokens after exposure and keep them different.
- Treat Terraform plans and state as sensitive because they can contain infrastructure identifiers and configuration.

### IAM

The function's custom role contains only:

```text
compute.instances.get
compute.instances.list
compute.instances.start
compute.instances.stop
compute.projects.get
compute.zoneOperations.get
```

Separate predefined roles allow Firestore access, Eventarc receipt, logging, and Pub/Sub subscription; notification publishing is added only when configured. The health function has no public invoker by default. Review every Terraform IAM change before applying it.

### Reporting a security issue

Do not open a public issue containing credentials, tokens, project identifiers, VM names, Terraform state, or exploitable details. Contact the repository owner privately with a minimal reproduction and affected revision. Revoke exposed credentials before sharing diagnostic material.

The repository threat model and operating boundaries are documented in [docs/SECURITY.md](docs/SECURITY.md).

## Testing and verification

### Local quality gate

```sh
npm ci
npm run verify
npm audit --audit-level=moderate
git diff --check
```

The coverage command enforces at least:

| Metric | Required |
| --- | ---: |
| Lines | 85% |
| Functions | 80% |
| Branches | 75% |

The latest recorded full baseline passed 66 tests with approximately 90.75% line/statement, 87.38% function, and 80.64% branch coverage. Its dependency audit was clean when recorded. On 2026-09-05, a fresh audit reported one high-severity `fast-uri` advisory group and one moderate-severity `qs` advisory group. npm reports patched transitive versions are available; all root and deployment lockfiles must be updated and the complete verification matrix rerun before describing the current dependency audit as clean.

### What automated verification covers

- configuration validation and fail-closed execute requirements;
- budget event decoding, source validation, and stale/wrong-scope rejection;
- actual and forecast threshold decisions;
- managed/protected/excluded/zone/state filtering;
- Google REST pagination, request IDs, errors, and deadlines;
- event claims, leases, cooldowns, action lifecycle, recovery ownership, and TTL;
- retryable versus non-retryable worker behavior;
- operation resumption after polling timeout;
- optional notification success/failure behavior;
- local/public authentication, session expiry, rate limits, CSRF, and security headers;
- API validation and static path containment;
- SQLite migration and audit queries;
- HAI authorization and read-only results;
- production web build and an isolated critical-path smoke test.

### GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes. It uses Node.js 22 and performs:

1. locked dependency installation;
2. syntax checks;
3. coverage-gated tests;
4. production dashboard build;
5. isolated smoke test;
6. dependency audit at moderate severity;
7. control-plane Docker image build;
8. function Docker image build.

The last baseline CI run recorded for the implementation was [run 31837943644](https://github.com/Robert-Velhorst/005-GCC-budget-hardcap/actions/runs/31837943644) on commit `fa2c412`.

### What automated verification does not prove

Passing tests do not prove that a specific Google Cloud account has correct billing, quotas, IAM, budget-topic linkage, Firestore location, or disposable VM setup. They also do not prove a live VM can be stopped safely. Those are provider and operator acceptance gates.

## Repository structure

```text
.
|-- .github/workflows/ci.yml       GitHub Actions quality gate
|-- deploy/
|   |-- control/                   Locked control-plane production dependencies
|   `-- function/                  Locked function production dependencies
|-- docs/                          Design, audits, runbooks, tests, and status
|-- hai/                           Read-only MCP metadata and documentation
|-- infra/terraform/               Google Cloud infrastructure
|-- scripts/                       Setup, launch, verification, diagnosis, recovery
|-- src/
|   |-- control/                   HTTP API, auth, SQLite/Firestore reads, MCP
|   |-- compute.js                 Compute gateway and VM selection
|   |-- config.js                  Worker configuration and validation
|   |-- event.js                   Cloud Billing event parsing and source checks
|   |-- handler.js                 End-to-end budget workflow
|   |-- policy.js                  Stop/recover/no-action policy
|   `-- store.js                   Firestore event/action/ownership persistence
|-- test/                          Node.js automated test suite
|-- web/                           React/Vite operator dashboard
|-- windows/                       Portable Windows launchers and instructions
|-- Dockerfile                     Control-plane image
|-- Dockerfile.function            Cloud Function image
|-- compose.yaml                   Local container deployment
|-- index.js                       Cloud Function exports
`-- package.json                   Commands, supported runtime, and dependencies
```

## Known limitations

1. **Not an instantaneous financial cap.** Standard Cloud Billing budget data and notifications are delayed. Google states that Pub/Sub budget status is sent multiple times per day and the first notification can take hours. Set alert thresholds below the absolute financial limit and use additional controls.
2. **Compute Engine VMs only.** The automation does not stop Cloud Run, GKE, Cloud SQL, storage, network egress, managed services, subscriptions, commitments, or third-party charges.
3. **One project per deployment/configuration.** Multi-project, folder, organization, and whole-billing-account orchestration are not implemented.
4. **Selective action, broad visibility.** The dashboard can show every VM in the project, but only explicitly labelled and otherwise eligible VMs can be changed.
5. **Stopping a VM does not remove all related charges.** Persistent disks, static IPs, snapshots, licenses, commitments, and other resources can continue to cost money.
6. **In-flight work can be interrupted.** Stopping a VM may terminate applications or unfinished work. Operators must choose disposable/interruptible workloads and protection labels carefully.
7. **Local SSD and workload-specific risks remain operator responsibilities.** The worker uses the ordinary Compute stop operation and does not implement workload-aware draining, backups, or application shutdown orchestration.
8. **Recovery follows budget notifications.** Because notification data can be delayed or out of order, recovery is conservative but cannot guarantee an exact restart time.
9. **Dashboard policy is not deployment control.** Local changes do not reconfigure the cloud worker.
10. **No completed live provider acceptance.** Automated behavior and the local application have been verified, subject to the separately disclosed dependency advisories, but this revision has not passed an authorized real Google Cloud stop/restart test.
11. **No always-on public service.** The ngrok launcher creates a tunnel for the life of the process; service installation, domain ownership, ngrok account policy, monitoring, and availability remain external operations.
12. **Cloud Logging retention is external.** Logging retention, exports, alerting, and legal/compliance policy must be configured in the Google Cloud account.
13. **No live scale baseline.** Action caps and deadlines are implemented, but live API quota/load behavior has not been benchmarked.
14. **Single-operator local model.** The control plane uses an operator token rather than team accounts, per-user roles, SSO, or tenant isolation.
15. **English operator interface.** Money and dates use locale-aware formatting, but interface copy is not fully internationalized.
16. **Terraform source packaging needs a clean checkout.** The archive uses the repository directory as its source and does not inherit `.gitignore` rules. Ignored local secrets or runtime files can be included unless the operator deploys from a clean checkout and inspects the archive.
17. **Current transitive dependency advisories.** The 2026-09-05 audit reports one high and one moderate advisory group in `fast-uri` and `qs`. Patched transitive releases are available, but this README-only revision does not alter the three lockfile sets.

Google now also documents provider-native spend cap budgets for certain eligible services in Preview. That feature has different scope and behavior from this repository and should be evaluated independently against current Google Cloud documentation and the services used by your project.

## Troubleshooting

### The dashboard says Google Cloud setup is required

Check that:

1. `PROJECT_ID` in `.env.local` is a real project ID, not the project display name.
2. Application Default Credentials exist: `gcloud auth application-default login`.
3. The signed-in identity can read the project and list Compute Engine instances.
4. The Compute Engine API is enabled.
5. `npm run doctor -- --provider` reports the exact failing check.

### The port is already in use

The launcher intentionally refuses to connect to another process. Stop the existing process or set a different `CONTROL_PORT` in `.env.local`, then start again.

### The web application is missing

Run:

```powershell
npm run build:web
```

The production control plane returns `WEB_BUILD_MISSING` when `web/dist/index.html` is absent.

### Public login fails

- Run `.\scripts\setup-local.ps1` to generate a strong operator token.
- Confirm `.runtime\control.env` exists and is readable only by the intended account.
- Do not make the operator and HAI tokens equal.
- Check `.runtime\public-control.error.log` without sharing its contents publicly.
- Repeated failed logins are deliberately rate-limited.

### ngrok exits immediately

- Confirm ngrok is installed, on `PATH`, and authenticated.
- Confirm the reserved domain belongs to the active ngrok account.
- Supply only a lowercase hostname to `-Domain`, without `https://` or a path.
- Confirm no other endpoint is already using the same reserved domain.
- The launcher stops the local control process when ngrok fails; fix the error and relaunch.

### No VM is eligible

Inspect the dashboard's scope reason for each VM and check:

- the managed label key and value match exactly;
- the protected label is absent;
- the VM name is not in `EXCLUDED_INSTANCES`;
- the zone is in `ALLOWED_ZONES`;
- the VM is `RUNNING` for stop or `TERMINATED` for recovery;
- recovery has a completed service-owned stop record and the delay has elapsed.

### An event is ignored

Expected ignore/rejection causes include:

- plan mode;
- automation disabled;
- duplicate or active event lease;
- active cooldown;
- stale event;
- wrong budget display name;
- wrong currency;
- malformed Pub/Sub data;
- action count above the configured cap.

Use structured logs and the audit record, not only the absence of a VM action, to determine the cause.

### An action remains submitted

Google might have accepted the operation while the worker's polling deadline expired. Do not manually resubmit immediately. Retry delivery can resume the known operation, and `npm run reconcile` provides a dry-run review path.

### Terraform reports that Firestore already exists

Set:

```hcl
create_firestore_database = false
```

Confirm that the existing database is Firestore Native and that its location and data-governance policy are acceptable before deployment.

## Documentation

| Document | Audience and purpose |
| --- | --- |
| [Operator runbook](docs/OPERATOR_RUNBOOK.md) | Deployment, approval gates, incidents, rollback, backup, recovery, and retirement. |
| [Security model](docs/SECURITY.md) | Threats, trust boundaries, secrets, IAM, network exposure, and residual risks. |
| [Critical path](docs/CRITICAL_PATH.md) | End-to-end product outcome and invariants. |
| [Acceptance tests](docs/ACCEPTANCE_TESTS.md) | Automated and live-account acceptance matrix. |
| [Final verification report](docs/FINAL_VERIFICATION_REPORT.md) | Evidence captured during the full implementation baseline and external blockers at that time. |
| [Goal completion matrix](docs/GOAL_COMPLETION_MATRIX.md) | Detailed implementation coverage and remaining provider gates. |
| [Technical audit](docs/TECHNICAL_AUDIT.md) | Repository risks and engineering decisions. |
| [API usage audit](docs/API_USAGE_AUDIT.md) | Google API call inventory and purpose. |
| [UI action audit](docs/UI_ACTION_AUDIT.md) | Dashboard controls mapped to actual behavior. |
| [HAI guide](hai/README.md) | Read-only MCP setup and authority limits. |
| [Changelog](CHANGELOG.md) | Version history. |

Useful current Google Cloud references:

- [Create and manage Cloud Billing budgets](https://cloud.google.com/billing/docs/how-to/budgets)
- [Set up programmatic budget notifications](https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications)
- [Stop or restart a Compute Engine instance](https://cloud.google.com/compute/docs/instances/stop-start-instance)
- [Compute Engine `instances.stop` REST method and retry request IDs](https://cloud.google.com/compute/docs/reference/rest/v1/instances/stop)
- [Google Cloud spend cap budgets (Preview)](https://cloud.google.com/billing/docs/how-to/budgets-spend-caps)

## License

This project is licensed under the [ISC License](LICENSE).
