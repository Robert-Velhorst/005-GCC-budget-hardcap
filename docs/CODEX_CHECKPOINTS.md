# Codex Checkpoints

## Resume state

- Repository: `Noodzakelijk-Online/005-GCC-budget-hardcap`
- Working branch: `main`
- Starting commit: `51a6644`
- Product: Node.js 20 Cloud Function, Pub/Sub CloudEvent input, Compute Engine provider, Firestore audit/state.
- Default safety posture: `plan`, automation disabled, recovery disabled.
- Test-only behavior: `scripts/smoke.js` and test fakes only; production code has no fake-provider switch.
- Required next external step: operator-reviewed `terraform plan`, plan-mode deployment, then disposable-VM acceptance.

## Safe resume commands

```sh
git status --short
npm ci
npm run lint
npm run test:coverage
npm run smoke
npm audit --audit-level=moderate
```

Before enabling execution, reread `docs/OPERATOR_RUNBOOK.md`, verify the Terraform variables and IAM diff, and keep `ENABLE_AUTOMATIC_RECOVERY=false`.
