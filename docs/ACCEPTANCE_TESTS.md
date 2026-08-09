# Acceptance Tests

## Automated results

| Scenario | Command | Expected | Current result |
| --- | --- | --- | --- |
| Syntax | `npm run lint` | All JavaScript parses | Passed |
| Unit/integration | `npm test` | All tests pass | Passed, 65 tests |
| Coverage | `npm run test:coverage` | >=85 lines, >=80 functions, >=75 branches | Passed: 90.73 / 87.38 / 80.64 |
| Test-only critical path | `npm run smoke` | One read-only stop plan | Passed |
| Web production build | `npm run build:web` | Production assets compile | Passed |
| Browser workflow | Playwright desktop/mobile | No unexpected errors/overflow; login, policy, preview, logout work | Passed at 1440x1000 and 390x844 |
| Windows setup/launch | PowerShell 5.1 with Node 24 | Restricted secrets and healthy loopback app | Passed |
| Portable Windows release | `npm run build:windows` | Bundled runtime; no state/secrets in ZIP | Passed, 57.13 MiB ZIP and verified SHA-256 |
| MCP connector | Protocol initialize/list/call | Separate HAI bearer and read-only tools | Passed |
| Dependency audit | `npm audit --audit-level=moderate` | No findings at threshold | Passed |
| Control container | `docker build .` plus runtime probe | Native SQLite, non-root health/session/API | Passed, 100,526,874 bytes |
| Function container | `docker build -f Dockerfile.function .` plus health probe | Minimal non-root Node 22 function runtime | Passed, 87,782,484 bytes |
| Compose configuration | `docker compose config --quiet` | Configuration resolves on Windows | Passed |
| Terraform validation | `terraform validate` | Valid configuration | Passed with Terraform 1.14.3 |

## Live provider acceptance matrix

These tests are intentionally not marked complete without the operator's Google Cloud project and approval.

| Test | Expected |
| --- | --- |
| Authenticated Eventarc delivery | Function receives the intended topic only |
| Wrong budget name/currency | Event rejected; no Compute call |
| Stale event | Event rejected; no Compute call |
| Plan mode over threshold | Exact disposable VM appears; no mutation |
| Missing managed label | VM absent from plan |
| Protection label | VM absent from plan |
| Wrong zone/excluded name | VM absent from plan |
| Action count above cap | Entire plan fails closed |
| Execute disposable stop | One action intent, one Compute operation, `SUBMITTED` audit |
| Duplicate event | No second Compute request |
| Firestore unavailable | No provider request before intent persistence |
| Compute unavailable | Failed action/event audit and retryable error |
| Emergency switch off | Configuration/readiness rejects execution |
| Recovery disabled | Under-budget event does not start VMs |
| Recovery enabled | Only audit-owned terminated disposable VM starts after delay |
| Ambiguous intent reconciliation | Dry-run reports actual state; apply records reviewed state |

## Human readiness sign-off

Sign-off must record project, region, function revision, test VM, budget/topic, timestamps, log query, Firestore document IDs, Compute operation IDs, approver, and rollback confirmation. Do not place credentials or sensitive raw logs in the repository.

Ngrok acceptance additionally requires the owning account to stop its already-online assigned endpoint (`ERR_NGROK_334` observed), then verify public login, secure cookie, authenticated overview, and teardown. Pooling is not an acceptable workaround because it may route to another local service.
