# Codex Worklog

## 2026-05-27 - initial hardening

Reviewed the three-file repository, replaced hard-coded project/threshold behavior, added status/label filtering, disabled unsafe automatic restart by default, improved failure behavior, added initial tests, and rewrote deployment documentation.

## 2026-08-08 - giant goal implementation

- Read the complete 124-page goal document and classified the 116 phases by applicability.
- Recorded branch/default branch and starting commit; confirmed remote `main` matched.
- Rebuilt the function into isolated config, event, policy, Compute, Firestore, logging, notification, health, and orchestration modules.
- Added fail-closed production settings, source validation, action caps, cooldowns, stale-event handling, deterministic request IDs, durable event claims, intent-before-action audit, recovery ownership, and reconciliation.
- Added doctor, support bundle, test-only smoke lab, non-root Docker image, CI, Dependabot, and Terraform.
- Pinned/locked dependencies and applied a transitive UUID security override.
- Added unit, adapter contract, integration, adversarial, and smoke tests.
- Added required technical audit, critical path, acceptance, security, runbook, API/UI audit, task graph, checkpoint, matrix, and verification documents.

External work remaining: initialize/deploy Terraform in the operator account and execute the live acceptance matrix with an approved disposable VM.

## 2026-08-09 - Windows operator control plane

- Added React/Vite dashboard, native authenticated API, SQLite WAL/migrations/retention, cached provider status, and request deadlines.
- Added Windows setup/local/ngrok scripts with restricted generated tokens, port ownership checks, and child-aware health startup.
- Added separate HAI bearer authority and real read-only MCP Streamable HTTP tools.
- Split control-plane and function container images, added Compose, and upgraded CI/Terraform runtimes to Node 22.
- Fixed defects found by execution: missing policy fields causing `NaN`, PowerShell 5.1 token API incompatibility, indefinite provider probes, wrong-process tunnel startup, and missing native SQLite container toolchain.
- At that checkpoint, passed 58 tests, coverage, production web build, smoke, audit, Terraform, Compose, Windows launcher, and desktop/mobile browser QA.

External work remaining at that checkpoint: live Google Cloud disposable-VM acceptance and owner resolution of ngrok `ERR_NGROK_334`.

## 2026-08-09 - production completion pass

- Added optional Firestore audit reads to the Windows control plane while keeping settings in local SQLite and degrading unavailable cloud audit truthfully.
- Replaced generated Google clients with lightweight authenticated REST adapters and added fixed-host/path/deadline tests.
- Split locked production dependency manifests for control and function runtimes; both Node 22 images built and passed non-root health/runtime checks.
- Added a portable Windows x64 release builder, bundled Node runtime, first-run restricted secrets, public/local launchers, ZIP, and SHA-256 verification.
- Added real logout and plan-only budget preview, corrected stale threshold recomputation, hardened proxy-aware login throttling and static routing, and completed MCP GET/POST/DELETE support.
- Fixed mobile closed-drawer shadow and fixed-header section navigation defects found by rendered QA.
- Passed 65 tests, enforced coverage, production build, smoke, dependency audits, container runtime checks, portable runtime checks, and desktop/mobile browser workflows.

External work remaining: approved live Google Cloud disposable-VM acceptance and owner resolution of the already-online ngrok endpoint. The repository cannot safely stop or pool with an endpoint owned by another running process.
