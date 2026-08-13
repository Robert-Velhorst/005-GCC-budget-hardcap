# Codex Checkpoints

## Resume state

- Repository: `Noodzakelijk-Online/005-GCC-budget-hardcap`
- Working branch: `main`
- Starting commit: `51a6644`; implementation checkpoint: `a4f906c`.
- Product: Node.js 22 Cloud Function plus Windows/web control plane, Pub/Sub input, Compute provider, Firestore cloud audit, SQLite local audit.
- Default safety posture: `plan` and automation disabled; automatic restart is configured but cannot act until the full automation is approved.
- Test-only behavior: `scripts/smoke.js` and test fakes only; production code has no fake-provider switch.
- Required next external step: operator-reviewed `terraform plan`, plan-mode deployment, then disposable-VM acceptance.

## Safe resume commands

```sh
git status --short
npm ci
npm run lint
npm run test:coverage
npm run smoke
npm run build:web
npm audit --audit-level=moderate
docker compose config --quiet
```

Before enabling execution, reread `docs/OPERATOR_RUNBOOK.md`, verify the Terraform variables and IAM diff, and complete both the disposable stop and owned-restart acceptance checks.
