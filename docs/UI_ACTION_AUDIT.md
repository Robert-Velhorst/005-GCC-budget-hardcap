# UI Action Audit

Status: Implemented and browser-verified.

| Surface | Action | Real behavior |
| --- | --- | --- |
| Header | Refresh | Invalidates provider cache and reloads live overview |
| Sidebar/mobile nav | Navigate | Scrolls to the real section; mobile targets are at least 44 px high |
| Instances | Search/filter | Filters provider records already returned by the authenticated API |
| Policy mode | Plan/execute | Changes a local draft only; execute requires exact typed confirmation on apply |
| Automation/recovery switches | Toggle | Changes a local draft only |
| Apply local policy | Save | Authenticated, CSRF-protected `PUT /api/v1/policy` to SQLite |
| Budget chart | Preview | Authenticated, CSRF-protected plan-only evaluation; never submits Compute mutations |
| Public login | Sign in | Rate-limited token exchange for HttpOnly secure session |
| Header | Sign out | CSRF-protected session deletion and immediate return to login |

No visible command is a placeholder. No UI action deploys Terraform or directly calls a Compute mutation. Browser verification covered truthful empty/setup states, a real policy save and immediate threshold update, preview result, logout invalidation, desktop/mobile overflow, fixed navigation offsets, drawer closure, and expected-versus-unexpected console/network errors.
