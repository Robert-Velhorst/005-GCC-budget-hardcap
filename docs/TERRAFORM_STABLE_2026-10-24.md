# Stable Terraform configuration qualification

This follow-up includes PR #111 unchanged and advances the infrastructure
toolchain to public stable Terraform 1.17.0. The provider selections are
Google 8.8.1, Archive 2.8.1 and Random 3.9.1. Exact constraints and the native
Terraform dependency lock record the selected cohort. These were the latest
stable versions returned by the public registry on 2026-10-24.

The lock is generated using the original publisher's Terraform CLI and
provider signatures/checksums for Linux amd64, Windows amd64 and macOS arm64.
The local CLI archive matched the publisher's HTTPS SHA-256 manifest; its
detached GPG signature was not independently verified. No global SDK or PATH
was changed. The metadata commands use an empty CLI configuration and isolated
profile without cloud credentials.

The added workflow checks formatting, initializes the locked provider plugins
with `-backend=false -lockfile=readonly`, validates configuration against their
schemas, and records actual SDK/provider versions. It does not run Terraform
plan, apply, refresh, import or destroy. No cloud token or cloud login is
configured. Passing validation does not prove a live infrastructure plan is
safe, billing limits work, existing data has migrated, or cloud resources have
changed.

The existing Google infrastructure still describes the optional Google Cloud
budget-control integration. This proposal does not apply or delete it. The
portfolio deployment target is Hetzner Cloud, with this application's dedicated
subdomain under noodzakelijkonline.de. Review the retained Google function and
Firestore architecture as part of that migration; a new provider version does
not establish Hetzner cutover or retire external resources.

No application source, application test cases or security gate is changed by
this follow-up. PR #111 remains independently reviewable and unmerged.

## Primary sources

- [Terraform stable release](https://releases.hashicorp.com/terraform/1.17.0/)
- [Terraform provider lock command](https://developer.hashicorp.com/terraform/cli/commands/providers/lock)
- [Terraform init options](https://developer.hashicorp.com/terraform/cli/commands/init)
- [Google provider registry](https://registry.terraform.io/providers/hashicorp/google/8.8.1)
- [Archive provider registry](https://registry.terraform.io/providers/hashicorp/archive/2.8.1)
- [Random provider registry](https://registry.terraform.io/providers/hashicorp/random/3.9.1)
