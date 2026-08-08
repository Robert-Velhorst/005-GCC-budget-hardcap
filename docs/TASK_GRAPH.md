# Task Graph

```text
repository audit
  -> event/config contract
  -> policy state machine
  -> scoped Compute inventory
  -> Firestore idempotency/audit
  -> action orchestration and recovery ownership
  -> operator controls and diagnostics
  -> test/provider labs
  -> CI/container/Terraform
  -> security/runbook/acceptance evidence
  -> final verification
  -> live account acceptance (external approval required)
```

The live acceptance node depends on real Google Cloud credentials, a billing budget, Pub/Sub/Eventarc wiring, Firestore, IAM approval, quota, and a disposable VM. No repository-only task can truthfully satisfy that node.
