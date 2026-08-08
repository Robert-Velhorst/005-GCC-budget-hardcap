# Operator Runbook

## Initial rollout

1. Review `terraform plan` and confirm project, region, budget names, currency, zones, topic, custom IAM role, and Firestore location.
2. Deploy with `execution_mode = "plan"`, `automation_enabled = false`, and recovery disabled.
3. Configure the Cloud Billing budget to publish to Terraform's `budget_topic` output.
4. Label one disposable VM `budget-hardcap=true`. Never begin with production-critical VMs.
5. Publish/trigger a real budget notification and confirm the plan lists only the disposable VM.
6. Test rejection using the wrong budget name, currency, old timestamp, wrong zone, missing label, and protection label.
7. Set `execution_mode = "execute"` while leaving `automation_enabled = false`; confirm deployment fails its readiness/config check as expected.
8. Obtain change approval, set `automation_enabled = true`, and perform the disposable-VM stop test.
9. Confirm Firestore event/action/managed-instance records and Compute operation ID.
10. Keep automatic recovery disabled until a separate start test is approved.

## Emergency stop

Set `AUTOMATION_ENABLED=false` or Terraform `automation_enabled=false` and redeploy. For a stricter platform stop, detach the billing budget Pub/Sub topic or disable the function. These controls prevent new actions; they do not cancel already-submitted Compute operations.

## Incident triage

1. Record event ID, budget name, decision, instance, zone, action ID, request ID, and operation name from structured logs/Firestore.
2. Check the actual VM state in Compute Engine before retrying manually.
3. Run `npm run reconcile` with Application Default Credentials to inspect `STOP_INTENT` records.
4. Review the dry-run output. Use `npm run reconcile -- --apply` only after states are verified.
5. Keep ambiguous/not-found instances in `MANUAL_REVIEW_REQUIRED`; do not assume success.

## Retry behavior

Validation and safety errors are non-retryable in application semantics, although platform retry configuration may redeliver them. Provider and unexpected infrastructure errors are retryable. Completed/ignored event records suppress duplicates; an active lease suppresses concurrent processing; expired/failed records can be reclaimed.

Compute request UUIDs are deterministic for event/action/instance, so a retried identical request is deduplicated by Compute Engine. Provider acceptance followed by an audit-write failure remains an explicit ambiguous intent and requires reconciliation.

## Backup and restore

Use managed Firestore export to a restricted Cloud Storage bucket on an organization-approved schedule. Test import into a non-production project. Do not copy production audit data into local fixtures. Terraform state must use an encrypted, versioned remote backend with restricted IAM.

## Retention and cleanup

Apply Firestore TTL policies according to `docs/SECURITY.md`. Before deleting a function or project, disable event delivery, wait for in-flight invocations, reconcile ambiguous intents, export required audit records, remove budget-topic wiring, and then retire IAM bindings. Never delete the audit trail before confirming no VM recovery ownership depends on it.

## Support bundle

`npm run support:bundle` prints runtime and allowlisted configuration only. Redirect it to an approved secure location if needed. It deliberately excludes credentials, arbitrary environment variables, cloud records, and raw event bodies.

## Rollback

The fastest rollback is `automation_enabled=false`. Code rollback should deploy a previously verified source artifact while retaining Firestore collections. Do not roll back to the original implementation because it lacks scope, idempotency, audit, and safe recovery controls.
