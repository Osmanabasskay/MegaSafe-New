import { DataTable } from '@/components/data-table';
import { RiskScoreBadge } from '@/components/risk-badge';
import { StatusBadge } from '@/components/status-badge';
import { getAdminActivity } from '@/lib/admin-data';

export default async function AdminActivityPage(params: {
  searchParams?: Promise<{ action?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const rows = await getAdminActivity({ action: sp.action });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Admin Activity</h2>
          <p className="text-sm text-slate-500">Every super-admin action, recorded to <span className="font-mono">admin_actions</span> for insider-fraud protection.</p>
        </div>
        <a href="/api/admin/reports/export?format=csv&type=admin_activity" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50">Export</a>
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <input name="action" defaultValue={sp.action ?? ''} placeholder="Filter by action (e.g. suspend_user)" className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">Filter</button>
      </form>

      <DataTable
        headers={['Admin', 'Action', 'Target', 'Reason / Note', 'Risk', 'Status', 'IP', 'When']}
        rows={rows.map((r) => [
          <span key={`${r.id}-a`} className="font-semibold text-slate-800">{r.adminName ?? 'Admin'}</span>,
          <span key={`${r.id}-ac`} className="font-mono text-xs">{r.action}</span>,
          <span key={`${r.id}-t`} className="text-xs text-slate-600">{r.targetName ?? (r.targetUserId ? `${r.targetUserId.slice(0, 8)}…` : (r.targetTable ?? '—'))}</span>,
          <span key={`${r.id}-r`} className="text-xs text-slate-600">{r.reason ?? '—'}</span>,
          <RiskScoreBadge key={`${r.id}-rs`} score={r.riskScore} showLabel={false} />,
          <StatusBadge key={`${r.id}-s`} value={r.status} />,
          <span key={`${r.id}-ip`} className="font-mono text-xs text-slate-500">{r.ipAddress ?? '—'}</span>,
          <span key={`${r.id}-w`} className="whitespace-nowrap text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>,
        ])}
        emptyText="No admin actions recorded yet."
      />
    </div>
  );
}
