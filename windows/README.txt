GCC Budget Hardcap - Windows x64 portable release

1. Extract the complete folder to a location your Windows account can write to.
2. Double-click "Start GCC Budget Hardcap.cmd".
3. On first launch, review data\app.env and replace your-project-id.
4. Authenticate Google Application Default Credentials to load live Compute and Firestore data.
5. Set CONTROL_AUDIT_SOURCE=firestore in data\app.env to read deployed worker history.

The application includes its own supported Node runtime. No Node.js installation is required.
The Windows launcher is loopback-only and does not create public tunnels.

Public deployment targets Hetzner. Follow the repository-root DEPLOYMENT_TARGET.md and operator runbook for server deployment, HTTPS proxy configuration, and acceptance gates.

HAI:
- Set HAI_CONNECTOR_ENABLED=true in data\app.env.
- Configure HAI for bearer-authenticated Streamable HTTP at http://127.0.0.1:8787/mcp for local use.
- Read HAI_CONNECTOR_TOKEN from data\control.env through the connector's secret environment.

Stop the local application with Ctrl+C in its launcher window.
Logs and the SQLite database stay under data. They are not included in the release archive.
