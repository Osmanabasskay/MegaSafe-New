import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { SeverityBadge, RiskScoreBadge } from '@/components/risk-badge';
import { StatusBadge } from '@/components/status-badge';
import { AdminActionButton } from '@/components/action-button';
import { getLiveRiskEvents, getOverviewMetrics } from '@/lib/admin-data';

const SEVERITIES = ['low', 'medium', 'high', 'critical', 'extreme'];
const STATUSES = ['open', 'investigating', 'resolved', 'false_positive'];
const EVENT_TYPES = [
  'repeated_failed_login', 'password_spraying_pattern', 'otp_spam', 'device_change',
  'duplicate_payment_reference', 'duplicate_payment_proof', 'duplicate_contribution_period',
  'negative_amount_attempt', 'payout_request_abuse', 'collector_many_manual_edits',
  'admin_role_change', 'rls_denial_spike', 'rate_limit_spike', 'kyc_repeated_document',
  'same_phone_multiple_accounts', 'same_device_multiple_accounts', 'unusual_vault_activity',
  'suspicious_group_creation', 'contribution_backdating_attempt',
];

export default async function LiveRiskMonitorPage(params: {
  searchParams?: Promise<{ severity?: string; status?: string; type?: string; search?: string; from?: string; to?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const [events, metricsRaw] = await Promise.all([
    getLiveRiskEvents({
      severity: sp.severity, status: sp.status, eventType: sp.type, search: sp.search,
      from: sp.from ? new Date(sp.from).toISOString() : undefined,
      to: sp.to ? new Date(sp.to).toISOString() : undefined,
    }),
    getOverviewMetrics(),
  ]);
  const risk = (metricsRaw.risk ?? {}) as Record<string, number>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Live Risk Monitor</h2>
          <p className="text-sm text-slate-500">Real-time fraud & attack signal feed from <span className="font-mono">risk_events</span>.</p>
        </div>
        <a href="/api/admin/reports/export?format=csv&type=risk_events" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50">
          Export Risk Events
        </a>
      </div>

      <section className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Open Events" value={String(risk.open_events ?? 0)} accent={Number(risk.open_events) > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Low"      value={String(risk.low ?? 0)}      accent="green" />
        <KpiCard label="Medium"   value={String(risk.medium ?? 0)}   accent="orange" />
        <KpiCard label="High"     value={String(risk.high ?? 0)}     accent="orange" />
        <KpiCard label="Critical" value={String(risk.critical ?? 0)} accent="red" />
        <KpiCard label="Extreme"  value={String(risk.extreme ?? 0)}  accent="red" />
      </section>

      {/* Filters */}
      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input name="search" defaultValue={sp.search ?? ''} placeholder="Search reason / user" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select name="severity" defaultValue={sp.severity ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select name="type" defaultValue={sp.type ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Event Types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <input type="date" name="from" defaultValue={sp.from ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input type="date" name="to" defaultValue={sp.to ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">Apply Filters</button>
          <Link href="/admin/risk" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">Reset</Link>
        </div>
      </form>

      <DataTable
        headers={['Severity', 'Score', 'Event', 'Target', 'Reason', 'Status', 'When', 'Actions']}
        rows={events.map((e) => [
          <SeverityBadge key={`${e.id}-sv`} severity={e.severity} />,
          <RiskScoreBadge key={`${e.id}-sc`} score={e.riskScore} showLabel={false} />,
          <span key={`${e.id}-t`} className="font-mono text-xs">{e.eventType}</span>,
          e.targetUserId
            ? <Link key={`${e.id}-u`} href={`/admin/users/${e.targetUserId}`} className="text-blue-700 hover:underline">{e.targetName ?? e.targetUserId.slice(0, 8)}</Link>
            : <span key={`${e.id}-u`} className="text-xs text-slate-400">—</span>,
          <span key={`${e.id}-r`} className="text-xs text-slate-600">{e.reason ?? '—'}</span>,
          <StatusBadge key={`${e.id}-st`} value={e.status} />,
          <span key={`${e.id}-w`} className="whitespace-nowrap text-xs text-slate-500">{new Date(e.createdAt).toLocaleString()}</span>,
          <div key={`${e.id}-act`} className="flex flex-wrap gap-1.5">
            {e.status !== 'resolved' ? (
              <AdminActionButton action="mark_risk_reviewed" label="Reviewed" targetRecordId={e.id} tone="primary" confirm="Mark this risk event reviewed/resolved?" />
            ) : null}
            <AdminActionButton action="create_fraud_case" label="Open Case" targetUserId={e.targetUserId ?? undefined} targetRecordId={e.relatedRecordId ?? undefined} tone="warning" severity={e.severity} requireReason confirm="Open a fraud case from this event?" />
            {e.targetUserId ? (
              <AdminActionButton action="suspend_user" label="Suspend" targetUserId={e.targetUserId} tone="danger" requireReason confirm="Suspend this user? This blocks their access." />
            ) : null}
          </div>,
        ])}
        emptyText="No risk events match these filters. The risk engine records signals here as they occur."
      />

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        Destructive actions require confirmation and are written to the <span className="font-mono">admin_actions</span> ledger.
        Severity colours — <span className="font-semibold text-emerald-700">low</span>, <span className="font-semibold text-amber-700">medium</span>, <span className="font-semibold text-orange-700">high</span>, <span className="font-semibold text-rose-700">critical</span>, <span className="font-semibold text-purple-800">extreme</span>.
      </div>
    </div>
  );
}
