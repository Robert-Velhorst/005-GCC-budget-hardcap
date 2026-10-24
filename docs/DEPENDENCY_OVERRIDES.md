# Dependency override boundaries

## fast-uri 4.2.3

The root, control runtime and function runtime manifests select current stable
fast-uri 4.2.3 instead of AJV's declared major 3 range. This is an explicit
major dependency override, requiring the existing schema, budget and MCP checks
to pass; it is not a claim of upstream AJV support for major 4.

The former 3.1.8 lock resolution has scheme/host/path normalization advisories.
The public registry also has patched 3.1.9, but the requested target is current
stable, which is 4.2.3. Version 4 removes deprecated type declarations and fixes
escaping; review the [upstream major release](https://github.com/fastify/fast-uri/releases/tag/v4.0.0).
No application TypeScript code imports the removed fast-uri types.

Keep the override explicit until AJV declares major 4 itself. No audit
suppression, peer bypass, ignored findings, removed tests or weakened gate is
part of this change. Hosted checks must qualify the exact changed lockfiles.

The parser lock refresh also selects body-parser 2.4.0 and qs 6.16.1. The MCP
SDK is updated from 1.32.1 to the public stable 1.32.2 in the root and control
manifests. No provider credentials, cloud budget settings, real database or
Google Cloud resource are accessed by dependency preparation.

The pre-existing UUID 14.0.3 override remains unchanged. This document does not
establish all native libraries, running databases or deployment as current.
