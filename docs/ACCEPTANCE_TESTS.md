# Acceptance Tests

## Automated results

| Scenario | Command | Expected | Current result |
| --- | --- | --- | --- |
| Syntax | `npm run lint` | All JavaScript parses | Passed |
| Unit/integration | `npm test` | All tests pass | Passed, 36 tests |
| Coverage | `npm run test:coverage` | >=85 lines, >=80 functions, >=75 branches | Passed: 96.63 / 94.8 / 84.63 |
| Test-only critical path | `npm run smoke` | One read-only stop plan | Passed |
| Dependency audit | `npm audit --audit-level=moderate` | No findings at threshold | Passed |
| Container build | `docker build .` | Image builds as non-root runtime | Passed; health endpoint returned `ok` |
| Terraform validation | `terraform validate` | Valid configuration | Passed via Terraform 1.14.3 container |

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
