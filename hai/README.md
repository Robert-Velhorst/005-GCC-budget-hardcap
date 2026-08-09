# HAI connector

The control plane exposes a disabled-by-default, authenticated MCP Streamable HTTP endpoint at `/mcp`. It provides two bounded read-only tools:

- `get_budget_hardcap_status`
- `list_budget_hardcap_incidents`

Run `scripts/setup-local.ps1`, set `HAI_CONNECTOR_ENABLED=true` in `.env.local`, and pass the separately generated `HAI_CONNECTOR_TOKEN` to the HAI connector runtime through its secret environment. Do not put the token in HAI source, connector metadata, chat, or logs.

For HAI running in Docker, use `http://host.docker.internal:8787/mcp`. For a native Windows HAI process, use `http://127.0.0.1:8787/mcp`. Import `connector.json` only through a HAI adapter that supports bearer-authenticated Streamable HTTP. HAI's unauthenticated discovery-only preflight is intentionally insufficient for this endpoint.

The connector has no write tools. Any future mutation tool requires a separate HAI authority review, explicit operator approval, idempotency, and an audited execution contract.
