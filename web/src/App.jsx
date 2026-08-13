import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CircleDollarSign,
  Cloud,
  Database,
  ExternalLink,
  History,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { api, setCsrfToken } from "./api";

const NAV_ITEMS = [
  ["overview", "Overview", Activity],
  ["instances", "Instances", Server],
  ["actions", "Actions", Zap],
  ["policy", "Policy", Shield],
  ["integrations", "Integrations", Link2],
];

export default function App() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [authenticated, setAuthenticated] = useState(true);
  const [sessionMode, setSessionMode] = useState("local");
  const [activeSection, setActiveSection] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async (refresh = false) => {
    try {
      setError(null);
      const data = await api(`/api/v1/overview${refresh ? "?refresh=true" : ""}`);
      startTransition(() => {
        setOverview(data);
        setAuthenticated(true);
      });
    } catch (requestError) {
      if (requestError.status === 401) setAuthenticated(false);
      else setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    void api("/api/v1/session")
      .then((session) => {
        setCsrfToken(session.csrfToken);
        setSessionMode(session.mode || "local");
        return load();
      })
      .catch((requestError) => {
        if (requestError.status === 401) setAuthenticated(false);
        else setError(requestError.message);
      });
  }, [load]);

  if (!authenticated) return <Login onSuccess={(data) => {
    setCsrfToken(data.csrfToken);
    setSessionMode(data.mode || "session");
    setAuthenticated(true);
    void load();
  }} />;

  if (!overview && !error) return <LoadingScreen />;
  if (!overview) return <FatalState message={error} onRetry={() => void load(true)} />;

  const selectSection = (section) => {
    setActiveSection(section);
    setMenuOpen(false);
    document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const logout = async () => {
    try {
      await api("/api/v1/session", { method: "DELETE" });
      setCsrfToken("");
      setOverview(null);
      setAuthenticated(false);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="app-shell">
      <Header overview={overview} onRefresh={() => void load(true)} refreshing={isPending} onMenu={() => setMenuOpen((value) => !value)} onLogout={sessionMode === "session" ? () => void logout() : null} />
      <Sidebar active={activeSection} onSelect={selectSection} open={menuOpen} version={overview.version} policy={overview.policy} />
      <main className="workspace">
        {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
        <section id="overview" className="overview-grid" aria-label="Budget overview">
          <div className="main-column">
            <StatusStrip overview={overview} />
            <SpendChart budget={overview.budget} audit={overview.audit} policy={overview.policy} />
            <InstancesSection overview={overview} />
            <div className="lower-grid">
              <ActionsSection actions={overview.actions} audit={overview.audit} />
              <IntegrationsSection integrations={overview.integrations} />
            </div>
          </div>
          <PolicyPanel policy={overview.policy} onSaved={(policy) => setOverview((value) => ({
            ...value,
            policy,
            budget: { ...value.budget, thresholdAmount: value.budget.limit * policy.thresholdRatio },
          }))} />
        </section>
      </main>
      <MobileNav active={activeSection} onSelect={selectSection} />
    </div>
  );
}

function Header({ overview, onRefresh, refreshing, onMenu, onLogout }) {
  const connected = overview.provider.state === "connected";
  return (
    <header className="topbar">
      <button className="icon-button mobile-only" type="button" onClick={onMenu} aria-label="Open navigation"><Menu /></button>
      <div className="brand"><ShieldCheck aria-hidden="true" /><strong>GCC Budget Hardcap</strong></div>
      <div className="project-label"><span>Project</span><strong>{overview.policy.projectId}</strong></div>
      <div className="topbar-spacer" />
      <StatusLabel icon={Cloud} state={overview.provider.state} label={connected ? "Cloud connected" : "Cloud setup needed"} />
      <StatusLabel icon={Database} state="connected" label="Local database" />
      <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh provider data" title="Refresh provider data">
        <RefreshCw className={refreshing ? "spin" : ""} />
      </button>
      {onLogout ? <button className="icon-button" type="button" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut /></button> : null}
    </header>
  );
}

function Sidebar({ active, onSelect, open, version, policy }) {
  return (
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <nav aria-label="Primary navigation">
        {NAV_ITEMS.map(([id, label, Icon]) => (
          <button key={id} type="button" className={active === id ? "active" : ""} onClick={() => onSelect(id)}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-meta">
        <span>Version {version}</span>
        <span className={policy.executionMode === "plan" ? "safe-text" : "danger-text"}>
          <Shield aria-hidden="true" /> {policy.executionMode === "plan" ? "Plan mode" : "Execute mode"}
        </span>
      </div>
    </aside>
  );
}

function StatusStrip({ overview }) {
  const { audit, budget, policy, events } = overview;
  const auditUnavailable = audit?.state === "unavailable";
  const ratio = budget.ratio == null ? null : Math.round(budget.ratio * 100);
  const latestEvent = events[0];
  const withinBudget = ratio == null || ratio < policy.thresholdRatio * 100;
  return (
    <div className="status-strip">
      <Metric label="Spend" value={ratio == null ? "No data" : `${ratio}%`} detail={budget.latest ? formatMoney(budget.latest.costAmount, budget.latest.currencyCode) : "Waiting for budget event"} />
      <Metric label="Threshold" value={`${Math.round(policy.thresholdRatio * 100)}%`} detail={formatMoney(budget.thresholdAmount, policy.expectedCurrency)} />
      <Metric label="Protection state" value={withinBudget ? "Within budget" : "Threshold reached"} detail={`${capitalize(policy.executionMode)} mode`} tone={withinBudget ? "safe" : "danger"} />
      <Metric label="Last event" value={auditUnavailable ? "Unavailable" : latestEvent ? formatDate(latestEvent.updatedAt) : "None received"} detail={auditUnavailable ? "Audit source could not be read" : latestEvent?.status || "Audit is empty"} />
      <Metric label="Pending" value={auditUnavailable ? "Unknown" : String(overview.stats.pendingActions)} detail={auditUnavailable ? "Audit source unavailable" : `${overview.stats.failedActions} failed actions`} />
    </div>
  );
}

function Metric({ label, value, detail, tone }) {
  return <div className="metric"><span>{label}</span><strong className={tone ? `${tone}-text` : ""}>{value}</strong><small>{detail}</small></div>;
}

function SpendChart({ budget, audit, policy }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const points = budget.points;
  const width = 920;
  const height = 260;
  const max = Math.max(budget.limit || 1, ...points.map((point) => point.costAmount), 1) * 1.08;
  const polyline = points.map((point, index) => {
    const x = points.length <= 1 ? 40 : 40 + (index / (points.length - 1)) * (width - 80);
    const y = height - 28 - (point.costAmount / max) * (height - 56);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const thresholdY = height - 28 - (budget.thresholdAmount / max) * (height - 56);
  const limitY = height - 28 - (budget.limit / max) * (height - 56);

  return (
    <section className="panel chart-panel" aria-labelledby="spend-title">
      <div className="panel-heading"><div><h2 id="spend-title">Spend over observed events</h2><p>{budget.caveat}</p></div><div className="heading-actions"><span className={`data-state ${budget.state}`}>{budget.state === "observed" ? "Observed" : "No events"}</span><button className="secondary-button compact" type="button" onClick={() => setPreviewOpen(true)}><Zap />Preview</button></div></div>
      {audit?.state === "unavailable" ? (
        <EmptyState icon={AlertTriangle} title="Audit history unavailable" detail="Check Firestore credentials, project access, and the configured audit source." />
      ) : points.length === 0 ? (
        <EmptyState icon={CircleDollarSign} title="No budget events yet" detail="The chart will use the event audit after the first Billing notification or local preview." />
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Observed spend, warning threshold, and hard limit">
            {[0.25, 0.5, 0.75, 1].map((value) => <line key={value} x1="40" x2={width - 40} y1={height - 28 - value * (height - 56)} y2={height - 28 - value * (height - 56)} className="grid-line" />)}
            <line x1="40" x2={width - 40} y1={thresholdY} y2={thresholdY} className="threshold-line" />
            <line x1="40" x2={width - 40} y1={limitY} y2={limitY} className="limit-line" />
            <polyline points={polyline} className="spend-line" />
            <text x={width - 44} y={Math.max(14, thresholdY - 6)} textAnchor="end" className="threshold-label">Threshold</text>
            <text x={width - 44} y={Math.max(14, limitY - 6)} textAnchor="end" className="limit-label">Limit</text>
          </svg>
        </div>
      )}
      {previewOpen ? <BudgetPreview policy={policy} onClose={() => setPreviewOpen(false)} /> : null}
    </section>
  );
}

function BudgetPreview({ policy, onClose }) {
  const [form, setForm] = useState({
    budgetDisplayName: policy.allowedBudgetNames[0] || "Manual preview",
    costAmount: "",
    budgetAmount: String(policy.budgetLimit),
    currencyCode: policy.expectedCurrency || "EUR",
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setRunning(true); setError(""); setResult(null);
    try {
      setResult(await api("/api/v1/budget/preview", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          costAmount: Number(form.costAmount),
          budgetAmount: Number(form.budgetAmount),
        }),
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRunning(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title"><div className="modal-heading"><div><h2 id="preview-title">Budget event preview</h2><p>Plan-only evaluation</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close preview"><X /></button></div><form onSubmit={submit}><label><span>Budget name</span><input autoFocus value={form.budgetDisplayName} onChange={(event) => update("budgetDisplayName", event.target.value)} required /></label><div className="preview-grid"><label><span>Observed cost</span><input type="number" min="0" step="0.01" value={form.costAmount} onChange={(event) => update("costAmount", event.target.value)} required /></label><label><span>Budget amount</span><input type="number" min="0.01" step="0.01" value={form.budgetAmount} onChange={(event) => update("budgetAmount", event.target.value)} required /></label></div><label><span>Currency</span><input value={form.currencyCode} onChange={(event) => update("currencyCode", event.target.value.toUpperCase())} maxLength="3" required /></label>{error ? <p className="danger-message" role="alert">{error}</p> : null}{result ? <div className="preview-result" role="status"><strong>{humanState(result.decision || result.status)}</strong><span>{result.actionCount || 0} scoped actions</span><small>{result.reason}</small></div> : null}<button className="primary-button" disabled={running}>{running ? <LoaderCircle className="spin" /> : <Zap />}Run preview</button></form></section></div>;
}

function InstancesSection({ overview }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const queryValue = query.trim().toLowerCase();
  const instances = useMemo(() => overview.provider.instances.filter((instance) => {
    const matchesQuery = !queryValue || instance.name.toLowerCase().includes(queryValue) || instance.zone.toLowerCase().includes(queryValue);
    const matchesState = state === "all" || instance.status === state;
    return matchesQuery && matchesState;
  }), [overview.provider.instances, queryValue, state]);

  return (
    <section id="instances" className="panel data-panel" aria-labelledby="instances-title">
      <div className="panel-heading table-heading">
        <div><h2 id="instances-title">Cloud computers</h2><p>{overview.provider.state === "connected" ? `${overview.provider.instances.length} computers found` : overview.provider.error?.message || "Google Cloud is not connected."}</p></div>
        <div className="table-tools">
          <label className="search-field"><Search aria-hidden="true" /><span className="sr-only">Search cloud computers</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search computers" /></label>
          <select aria-label="Filter by state" value={state} onChange={(event) => setState(event.target.value)}><option value="all">All states</option><option value="RUNNING">Running</option><option value="TERMINATED">Stopped</option></select>
        </div>
      </div>
      {overview.provider.state !== "connected" ? <EmptyState icon={Cloud} title="Google Cloud setup required" detail="Authenticate Application Default Credentials and verify the configured project to load live instances." /> : instances.length === 0 ? <EmptyState icon={Server} title="No matching instances" detail="Change the filters or label instances for budget hardcap management." /> : (
        <div className="table-scroll">
          <table><thead><tr><th>Computer name</th><th>Location</th><th>State</th><th>Budget protection</th><th>Safety</th></tr></thead>
            <tbody>{instances.map((instance) => <tr key={`${instance.zone}/${instance.name}`}><td><span className={`state-dot ${instance.status === "RUNNING" ? "connected" : "neutral"}`} />{instance.name}</td><td>{instance.zone}</td><td>{humanState(instance.status)}</td><td>{instance.managed ? "Selected" : "Not selected"}</td><td className={instance.protected ? "safe-text" : "muted"}>{instance.protected ? "Never stop" : instance.scopeReason}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActionsSection({ actions, audit }) {
  return (
    <section id="actions" className="panel data-panel" aria-labelledby="actions-title">
      <div className="panel-heading"><div><h2 id="actions-title">Action history</h2><p>Durable local audit lifecycle</p></div><History aria-hidden="true" /></div>
      {audit?.state === "unavailable" ? <EmptyState icon={AlertTriangle} title="Action audit unavailable" detail="The selected audit source could not be read; zero actions is not assumed." /> : actions.length === 0 ? <EmptyState icon={History} title="No actions recorded" detail="Intent, submission, completion, and failure records will appear here." /> : (
        <div className="table-scroll compact-table"><table><thead><tr><th>Time</th><th>Instance</th><th>Action</th><th>Result</th></tr></thead><tbody>{actions.map((action) => <tr key={action.actionId}><td>{formatDate(action.updatedAt)}</td><td>{action.instanceName}</td><td>{capitalize(action.action)}</td><td><StatusText status={action.status} /></td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function IntegrationsSection({ integrations }) {
  const iconMap = { "google-cloud": Cloud, "cloud-audit": Cloud, "local-database": Database, ngrok: ExternalLink, hai: Link2, notifications: Bell };
  return (
    <section id="integrations" className="panel integrations" aria-labelledby="integrations-title">
      <div className="panel-heading"><div><h2 id="integrations-title">Integrations</h2><p>Configured and live are reported separately</p></div><Link2 aria-hidden="true" /></div>
      <div className="integration-list">{integrations.map((item) => { const Icon = iconMap[item.id] || Link2; return <div key={item.id} className="integration-row"><Icon aria-hidden="true" /><div><strong>{item.name}</strong><small>{item.detail}</small></div><StatusText status={item.state} /></div>; })}</div>
    </section>
  );
}

function PolicyPanel({ policy, onSaved }) {
  const [draft, setDraft] = useState(policy);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(policy), [policy]);

  const update = (name, value) => setDraft((current) => ({ ...current, [name]: value }));
  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api("/api/v1/policy", {
        method: "PUT",
        body: JSON.stringify({
          executionMode: draft.executionMode,
          automationEnabled: draft.automationEnabled,
          enableAutomaticRecovery: draft.enableAutomaticRecovery,
          thresholdRatio: Number(draft.thresholdRatio),
          maxActionsPerEvent: Number(draft.maxActionsPerEvent),
          confirmation,
        }),
      });
      onSaved(saved);
      setConfirmation("");
      setMessage({ tone: "safe", text: "Local policy saved." });
    } catch (error) {
      setMessage({ tone: "danger", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside id="policy" className="policy-panel" aria-labelledby="policy-title">
      <div className="policy-heading"><Shield aria-hidden="true" /><div><h2 id="policy-title">Policy</h2><p>{policy.projectId}</p></div></div>
      <fieldset><legend>Mode</legend><div className="segmented"><button type="button" className={draft.executionMode === "plan" ? "selected" : ""} onClick={() => update("executionMode", "plan")}>Plan</button><button type="button" className={draft.executionMode === "execute" ? "selected danger-choice" : ""} onClick={() => update("executionMode", "execute")}>Execute</button></div><small>Plan mode never mutates Compute Engine.</small></fieldset>
      <Toggle label="Automation" detail="Allow budget events to submit scoped actions." checked={draft.automationEnabled} onChange={(value) => update("automationEnabled", value)} />
      <Toggle label="Automatic restart" detail="Restart only selected computers this tool successfully stopped." checked={draft.enableAutomaticRecovery} onChange={(value) => update("enableAutomaticRecovery", value)} />
      <fieldset><legend>Threshold</legend><label className="numeric-field"><span>Budget ratio</span><div><input type="number" min="0.01" max="10" step="0.01" value={draft.thresholdRatio} onChange={(event) => update("thresholdRatio", event.target.value)} /><span>x</span></div></label><label className="numeric-field"><span>Maximum actions</span><div><input type="number" min="1" max="100" step="1" value={draft.maxActionsPerEvent} onChange={(event) => update("maxActionsPerEvent", event.target.value)} /></div></label></fieldset>
      {draft.executionMode === "execute" ? <label className="confirmation"><span>Confirm live mode</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="ENABLE EXECUTION" autoComplete="off" /><small>Required every time execute mode is applied.</small></label> : null}
      <div className="review-summary"><h3>Review summary</h3><dl><div><dt>Mode</dt><dd>{capitalize(draft.executionMode)}</dd></div><div><dt>Automation</dt><dd>{draft.automationEnabled ? "Enabled" : "Disabled"}</dd></div><div><dt>Automatic restart</dt><dd>{draft.enableAutomaticRecovery ? "Enabled" : "Disabled"}</dd></div><div><dt>Locations</dt><dd>{policy.allowedZones.length}</dd></div></dl></div>
      {message ? <p className={`${message.tone}-message`} role="status">{message.text}</p> : null}
      <button className="primary-button" type="button" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Check />}Apply local policy</button>
      <p className="policy-footnote">Cloud function settings remain controlled by Terraform and require a separate reviewed deployment.</p>
    </aside>
  );
}

function Toggle({ label, detail, checked, onChange }) {
  return <label className="toggle-row"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function MobileNav({ active, onSelect }) {
  return <nav className="mobile-nav" aria-label="Mobile navigation">{NAV_ITEMS.map(([id, label, Icon]) => <button key={id} type="button" className={active === id ? "active" : ""} onClick={() => onSelect(id)}><Icon /><span>{label}</span></button>)}</nav>;
}

function Login({ onSuccess }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setLoading(true); setError("");
    try { onSuccess(await api("/api/v1/session", { method: "POST", body: JSON.stringify({ token }) })); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };
  return <main className="login-screen"><form className="login-panel" onSubmit={submit}><ShieldCheck /><h1>GCC Budget Hardcap</h1><p>Authenticate to access the public operator control plane.</p><label><span>Access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" required /></label>{error ? <p className="danger-message" role="alert">{error}</p> : null}<button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <LogIn />}Sign in</button></form></main>;
}

function StatusLabel({ icon: Icon, state, label }) { return <span className="status-label"><Icon /><span className={`state-dot ${state}`} />{label}</span>; }
function StatusText({ status }) { const tone = ["connected", "COMPLETED", "configured"].includes(status) ? "connected" : String(status).includes("FAIL") || status === "unavailable" ? "failed" : status === "setup_required" ? "warning" : "neutral"; return <span className="status-text"><span className={`state-dot ${tone}`} />{humanState(status)}</span>; }
function EmptyState({ icon: Icon, title, detail }) { return <div className="empty-state"><Icon /><div><strong>{title}</strong><p>{detail}</p></div></div>; }
function InlineAlert({ message, onDismiss }) { return <div className="inline-alert" role="alert"><AlertTriangle /><span>{message}</span><button className="icon-button small" type="button" onClick={onDismiss} aria-label="Dismiss"><X /></button></div>; }
function LoadingScreen() { return <main className="loading-screen"><LoaderCircle className="spin" /><strong>Loading control plane</strong></main>; }
function FatalState({ message, onRetry }) { return <main className="loading-screen"><AlertTriangle /><strong>Control plane unavailable</strong><p>{message}</p><button className="secondary-button" onClick={onRetry}><RefreshCw />Retry</button></main>; }

function formatMoney(value, currency) { if (!Number.isFinite(value)) return "Not available"; try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency || ""}`.trim(); } }
function formatDate(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function capitalize(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "-"; }
function humanState(value) { return String(value || "unknown").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
