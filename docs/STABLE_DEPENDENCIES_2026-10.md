# Stable dependency and SQLite baseline - 2026-10-23

## Changes

All three manifests and locks now use stable Firestore 9.4.0 and UUID 14.0.3. The root frontend uses Vite 8.3.5 and Lucide 1.61.0. Node floors are patched 24.22.1 / 26.12.1, and both self-hosted images target pinned Node 26.12.1. The separate runtime draft #110 remains untouched.

The latest better-sqlite3 13.0.3 package bundles SQLite 3.53.4; the Node 26.12.1 built-in SQLite reports 3.54.0. Neither is the latest stable SQLite 3.54.1. The explicit build downloads the official amalgamation, checks the archive SHA3-256 and sqlite3.c SHA3-256, and builds it with node-gyp 13.1.0. The application selects that artifact explicitly and checks SELECT sqlite_version() before running schema setup. It does not fall back to the vendor prebuild. Native artifacts are ignored by Git and source Docker contexts.

Native compilation is an explicit project build step; npm install-script approvals were not broadened. Windows packaging includes the verified native binding, validates the bundled runtime, uses .NET SHA-256 hashing and refuses an existing output path. Existing build artifacts and historical verification records are preserved.

## Verification

- Full Windows verify command passed: 70 reported Node results, including the Windows runtime-floor case; all coverage thresholds passed (91.34% lines, 80.68% branches, 88.39% functions), plus syntax, production web build and synthetic smoke.
- The explicit Linux test/*.test.js suite reported 68 passed, one Windows-only skip and zero failures in a read-only, network-disabled container. Unlike default Windows discovery, that glob does not count the empty test/helpers.js file as a separate result.
- Actual Firestore SDK control writes and transactional event claims passed through a loopback REST fixture, including merge fields, dates, lease timestamps and transaction identity. The same test passed in a read-only, network-disabled Linux container.
- A synthetic SQLite 3.53.4 audit database retained its settings, completed event, Unicode, exact decimal text and BLOB under 3.54.1. Integrity/foreign-key checks passed; the closed pre-upgrade backup remained readable. No real database was used.
- Both Linux images built. In network-disabled, read-only runtime fixtures, control health/static delivery and SQLite 3.54.1 integrity passed; the function returned HTTP 200 with PLAN_NO_ACTION, NO_ACTION and zero actions for a synthetic zero-cost event. Owned fixtures were removed.
- Desktop 1440x900 and mobile 390x900 browser flows passed against actual production assets, the real backend and SQLite 3.54.1, with an injected synthetic provider. Budget preview returned one planned scoped action; provider mutation count stayed zero and local policy was unchanged. Page identity/content, overlay, console and overflow checks passed. Browser plugin unavailable; repository Playwright used.
- The Windows archive's SHA-256, all ZIP CRCs, native binary receipt, bundled Node 26.12.1 and SQLite 3.54.1 were verified. Database/runtime configuration/credential files were absent. This is a local artifact, not a published installer or deployed service.

## Managed platform and upstream limits

Google's managed runtime table lists Node 24 as generally available and Node 26 as Preview. Terraform therefore advances the optional managed functions from nodejs22 to nodejs24. The public deployment directive remains Hetzner. No Terraform apply or Google Cloud resource change occurred.

The optional function-source archive now includes only index.js, the dedicated function manifest and lock, and src/*.js worker modules. An HCL parser and a 14-file ZIP rehearsal confirmed the explicit allowlist and the closed worker require graph. The previous whole-repository source_dir is removed, keeping local state, credentials, control UI and native/build artifacts outside this payload. Terraform init/validate/plan/apply were not run. CI action releases are pinned to their verified commit hashes.

The current cloudevents 10.0.0 metadata declares Node >=20 <=24. Its Node 26 container path passed the isolated no-action HTTP check, but that does not establish upstream Node 26 support. The managed Node 24 target fits that declaration. No engine checks, audit thresholds, auth boundaries or budget gates were disabled. Deprecated glob/node-domexception transitive packages remain under current upstream dependencies; no full transitive-newest claim is made.

Production provider credentials, real billing, VM stop/start, managed runtime patch versions, actual operator data migration/restore, TLS/IAM and live deployment remain unverified. First-run portable operator UX was not exercised.

## Primary sources

- https://sqlite.org/changes.html
- https://sqlite.org/download.html
- https://docs.cloud.google.com/run/docs/runtimes/function-runtimes
- https://registry.npmjs.org/%40google-cloud%2Ffirestore/latest
- https://registry.npmjs.org/cloudevents/latest
