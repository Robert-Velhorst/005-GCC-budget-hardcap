# Operator Runbook

## Windows control plane

1. Install Node.js 22 LTS, run `scripts\setup-local.ps1`, and review `.env.local` before connecting provider credentials.
2. Start with `scripts\start-local.ps1`; it binds loopback and prints the actual URL and log paths.
3. Use Application Default Credentials for read-only project verification. Treat `setup required` or `unavailable` as a real provider state, not a completed connection.
4. Keep local policy in plan mode until the Terraform worker deployment has passed the disposable-VM acceptance sequence below.
5. For ngrok, run `scripts\start-ngrok.ps1`. Enter the generated operator token in the public login; never place it in the URL or logs.
6. If ngrok reports `ERR_NGROK_334`, stop the existing endpoint through the owning account/session. Do not enable pooling because it can route traffic to an unverified local service.
7. Enable HAI only with `HAI_CONNECTOR_ENABLED=true` and a connector adapter that supports bearer-authenticated Streamable HTTP. HAI authority is read-only.

## Initial rollout

1. Review `terraform plan` and confirm project, region, budget names, currency, zones, topic, custom IAM role, and Firestore location.
2. Deploy with `execution_mode = "plan"`, `automation_enabled = false`, and recovery disabled.
3. Configure the Cloud Billing budget to publish to Terraform's `budget_topic` output.
4. Label one disposable VM `budget-hardcap=true`. Never begin with production-critical VMs.
5. Publish/trigger a real budget notification and confirm the plan lists only the disposable VM.
6. Test rejection using the wrong budget name, currency, old timestamp, wrong zone, missing label, and protection label.
7. Set `execution_mode = "execute"` while leaving `automation_enabled = false`; confirm deployment fails its readiness/config check as expected.
8. Obtain change approval, set `automation_enabled = true`, and perform the disposable-VM stop test.
9. Confirm Firestore event/action/managed-instance records, Compute operation ID, and terminal `COMPLETED` state.
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

Validation, safety, configuration, and terminal provider errors return `REJECTED_NON_RETRYABLE`, allowing the trigger to acknowledge them without a poison-message retry loop. Transient provider reads, operation timeouts, and unexpected infrastructure errors are thrown for retry. Completed/ignored/terminal-failed event records suppress duplicates; an active lease suppresses concurrent processing; retryable failed records can be reclaimed.

Compute request UUIDs are deterministic for event/action/instance, so a retried identical request is deduplicated by Compute Engine. A timed-out poll resumes the stored operation before inventory planning. Provider acceptance followed by an audit-write failure remains an explicit ambiguous intent and requires reconciliation.

## Backup and restore

Use managed Firestore export to a restricted Cloud Storage bucket on an organization-approved schedule. Test import into a non-production project. Do not copy production audit data into local fixtures. Terraform state must use an encrypted, versioned remote backend with restricted IAM.

## Retention and cleanup

Terraform applies Firestore TTL policies for event/action records using `AUDIT_RETENTION_DAYS`. Before deleting a function or project, disable event delivery, wait for in-flight invocations, reconcile ambiguous intents, export required audit records, remove budget-topic wiring, and then retire IAM bindings. Never delete managed-instance ownership before confirming no VM recovery depends on it.

## Support bundle

`npm run support:bundle` prints runtime and allowlisted configuration only. Redirect it to an approved secure location if needed. It deliberately excludes credentials, arbitrary environment variables, cloud records, and raw event bodies.

## Rollback

The fastest rollback is `automation_enabled=false`. Code rollback should deploy a previously verified source artifact while retaining Firestore collections. Do not roll back to the original implementation because it lacks scope, idempotency, audit, and safe recovery controls.
