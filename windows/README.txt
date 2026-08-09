GCC Budget Hardcap - Windows x64 portable release

1. Extract the complete folder to a location your Windows account can write to.
2. Double-click "Start GCC Budget Hardcap.cmd".
3. On first launch, review data\app.env and replace your-project-id.
4. Authenticate Google Application Default Credentials to load live Compute and Firestore data.
5. Set CONTROL_AUDIT_SOURCE=firestore in data\app.env to read deployed worker history.

The application includes its own supported Node runtime. No Node.js installation is required.
Local mode listens on 127.0.0.1 only and does not require a login.

Public ngrok access:
- Install and authenticate ngrok for the owning account.
- Double-click "Start Public Tunnel.cmd".
- Sign in with CONTROL_PLANE_TOKEN from data\control.env.
- Never paste that token into a URL, issue, source file, or chat.

HAI:
- Set HAI_CONNECTOR_ENABLED=true in data\app.env.
- Configure HAI for bearer-authenticated Streamable HTTP at http://127.0.0.1:8787/mcp.
- Read HAI_CONNECTOR_TOKEN from data\control.env through the connector's secret environment.

Stop the application or tunnel with Ctrl+C in its launcher window.
Logs and the SQLite database stay under data. They are not included in the release archive.
