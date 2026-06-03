import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge } from '@/components/status-badge';
import { SeverityBadge } from '@/components/risk-badge';
import { AdminActionButton } from '@/components/action-button';
import { getSecuritySummary, getSecurityEvents, getOverviewMetrics } from '@/lib/admin-data';

const SEVERITIES = ['low', 'medium', 'high', 'critical', 'extreme'];
const EVENT_TYPES = [
  'login_failed', 'login_success', 'otp_requested', 'password_reset_requested',
  'password_reset_completed', 'device_change', 'session_revoked', 'admin_mfa_failed',
  'role_change_attempt', 'unauthorized_access', 'rls_denied', 'api_abuse',
];

export default async function AdminSecurityPage(params: {
  searchParams?: Promise<{ severity?: string; type?: string; status?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const [{ summary, rateLimitEvents, recentFailedPayments, highValueWithdrawals }, { events }, metricsRaw] =
    await Promise.all([
      getSecuritySummary(),
      getSecurityEvents({ severity: sp.severity, eventType: sp.type, status: sp.status, page }),
      getOverviewMetrics(),
    ]);
  const sec = (metricsRaw.security ?? {}) as Record<string, number>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Security Events</h2>
          <p className="text-sm text-slate-500">Failed logins, OTP, device changes, RLS denials, API abuse & more.</p>
        </div>
        <a href="/api/admin/reports/export?format=csv&type=security_events" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50">Export Security Events</a>
      </div>

      {/* Security intelligence (24h) */}
      <section className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Failed Logins (24h)" value={String(sec.failed_logins ?? 0)} accent={Number(sec.failed_logins) > 0 ? 'red' : 'slate'} />
        <KpiCard label="Rate-Limit (24h)" value={String(sec.rate_limit_events ?? 0)} accent={Number(sec.rate_limit_events) > 10 ? 'red' : 'slate'} />
        <KpiCard label="OTP Requests (24h)" value={String(sec.otp_requests ?? 0)} accent="slate" />
        <KpiCard label="Password Resets (24h)" value={String(sec.password_resets ?? 0)} accent="slate" />
        <KpiCard label="New Devices (24h)" value={String(sec.new_device_logins ?? 0)} accent={Number(sec.new_device_logins) > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Suspicious Sessions" value={String(sec.suspicious_sessions ?? 0)} accent={Number(sec.suspicious_sessions) > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Admin MFA Failures" value={String(sec.admin_mfa_failures ?? 0)} accent={Number(sec.admin_mfa_failures) > 0 ? 'red' : 'slate'} />
        <KpiCard label="RLS Denials (24h)" value={String(sec.rls_denials ?? 0)} accent={Number(sec.rls_denials) > 0 ? 'orange' : 'slate'} />
        <KpiCard label="API Abuse (24h)" value={String(sec.api_abuse ?? 0)} accent={Number(sec.api_abuse) > 0 ? 'red' : 'slate'} />
        <KpiCard label="Extreme Risk Events" value={String(sec.extreme_risk_events ?? 0)} accent={Number(sec.extreme_risk_events) > 0 ? 'red' : 'slate'} />
        <KpiCard label="Suspended Users" value={summary.suspendedUsers.toLocaleString()} accent={summary.suspendedUsers > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Banned Users" value={summary.bannedUsers.toLocaleString()} accent={summary.bannedUsers > 0 ? 'red' : 'slate'} />
      </section>

      {/* Security events feed + filters + actions */}
      <section className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Security Event Feed</h3>
        <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <select name="severity" defaultValue={sp.severity ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="type" defaultValue={sp.type ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Event Types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            <option value="open">open</option>
            <option value="reviewed">reviewed</option>
            <option value="false_positive">false positive</option>
          </select>
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">Filter</button>
          <Link href="/admin/security" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">Reset</Link>
        </form>
        <DataTable
          headers={['Severity', 'Event', 'User', 'IP', 'Reason', 'Status', 'When', 'Actions']}
          rows={events.map((e) => [
            <SeverityBadge key={`${e.id}-sv`} severity={e.severity} />,
            <span key={`${e.id}-t`} className="font-mono text-xs">{e.eventType}</span>,
            e.userId ? <Link key={`${e.id}-u`} href={`/admin/users/${e.userId}`} className="font-mono text-xs text-blue-700 hover:underline">{e.userId.slice(0, 8)}…</Link> : <span key={`${e.id}-u`} className="text-xs text-slate-400">—</span>,
            <span key={`${e.id}-ip`} className="font-mono text-xs text-slate-500">{e.ipAddress ?? '—'}</span>,
            <span key={`${e.id}-r`} className="text-xs text-slate-600">{e.reason ?? '—'}</span>,
            <StatusBadge key={`${e.id}-st`} value={e.status} />,
            <span key={`${e.id}-w`} className="whitespace-nowrap text-xs text-slate-500">{new Date(e.createdAt).toLocaleString()}</span>,
            <div key={`${e.id}-act`} className="flex flex-wrap gap-1.5">
              {e.userId ? <AdminActionButton action="lock_account" label="Lock" targetUserId={e.userId} tone="danger" requireReason confirm="Lock this user account?" /> : null}
              {e.userId ? <AdminActionButton action="force_logout" label="Logout" targetUserId={e.userId} tone="warning" confirm="Force logout this user?" /> : null}
              {e.userId ? <AdminActionButton action="create_fraud_case" label="Case" targetUserId={e.userId} tone="warning" severity={e.severity} requireReason confirm="Open a fraud case?" /> : null}
            </div>,
          ])}
          emptyText="No security events recorded yet. The auth & API layers write here as events occur."
        />
      </section>

      {/* Existing read-only monitors retained */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Rate Limit Events (last 50)</h3>
        <DataTable
          headers={['User ID', 'IP Address', 'Action', 'Timestamp']}
          rows={rateLimitEvents.map((e) => [
            e.userId ? <span key={`${e.id}-u`} className="font-mono text-xs">{e.userId.slice(0, 12)}…</span> : <span key={`${e.id}-u`} className="text-xs text-slate-400">Anonymous</span>,
            <span key={`${e.id}-ip`} className="font-mono text-xs">{e.ipAddress ?? '–'}</span>,
            <span key={`${e.id}-a`} className="font-mono text-xs">{e.action}</span>,
            new Date(e.createdAt).toLocaleString(),
          ])}
          emptyText="No rate limit events."
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Recent Failed Vault Topups (last 20)</h3>
        <DataTable
          headers={['User', 'Amount (NLe)', 'Fee', 'Provider', 'Method', 'Phone', 'Date']}
          rows={recentFailedPayments.map((t) => [
            <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
            t.amount.toFixed(2),
            t.feeAmount.toFixed(2),
            t.provider,
            t.providerMethod ?? '-',
            t.phoneNumber ?? '-',
            new Date(t.createdAt).toLocaleString(),
          ])}
          emptyText="No failed topups."
        />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">High-Value Withdrawal Requests (≥NLe 1,000)</h3>
        <DataTable
          headers={['User', 'Amount (NLe)', 'Provider', 'Destination', 'Status', 'Requested']}
          rows={highValueWithdrawals.map((w) => [
            <span key={`${w.id}-u`} className="font-mono text-xs">{w.userId.slice(0, 12)}…</span>,
            <span key={`${w.id}-a`} className="font-semibold text-slate-900">{w.amount.toFixed(2)}</span>,
            w.destinationProvider,
            <span key={`${w.id}-dn`} className="font-mono text-xs text-slate-500">{w.destinationNumber}</span>,
            <StatusBadge key={`${w.id}-s`} value={w.status} />,
            new Date(w.requestedAt).toLocaleDateString(),
          ])}
          emptyText="No high-value withdrawals."
        />
      </section>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        All data is read from live tables. Destination numbers are masked. Lock / logout / fraud-case actions require confirmation and are audit-logged to <span className="font-mono">admin_actions</span>.
      </div>
    </div>
  );
}
