import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { SeverityBadge } from '@/components/risk-badge';
import { StatusBadge } from '@/components/status-badge';
import { AdminActionButton } from '@/components/action-button';
import { getFraudCases } from '@/lib/admin-data';

const STATUSES = ['open', 'investigating', 'escalated', 'resolved', 'false_positive'];

export default async function FraudCasesPage(params: {
  searchParams?: Promise<{ status?: string; severity?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const { cases, counts } = await getFraudCases({ status: sp.status, severity: sp.severity });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Fraud Cases</h2>
          <p className="text-sm text-slate-500">Investigation workflow for confirmed or suspected fraud.</p>
        </div>
        <a href="/api/admin/reports/export?format=csv&type=risk_events" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50">Export Risk Events</a>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Open" value={String(counts.open ?? 0)} accent={Number(counts.open) > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Investigating" value={String(counts.investigating ?? 0)} accent="orange" />
        <KpiCard label="Escalated" value={String(counts.escalated ?? 0)} accent="red" />
        <KpiCard label="Resolved" value={String(counts.resolved ?? 0)} accent="green" />
        <KpiCard label="False Positive" value={String(counts.false_positive ?? 0)} accent="slate" />
      </section>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <select name="status" defaultValue={sp.status ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select name="severity" defaultValue={sp.severity ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All Severities</option>
          {['low', 'medium', 'high', 'critical', 'extreme'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">Filter</button>
        <Link href="/admin/fraud" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">Reset</Link>
      </form>

      <DataTable
        headers={['Case #', 'Title', 'Severity', 'Subject', 'Status', 'Opened', 'Actions']}
        rows={cases.map((c) => [
          <span key={`${c.id}-n`} className="font-mono text-xs font-bold">{c.caseNumber}</span>,
          <span key={`${c.id}-t`} className="text-slate-800">{c.title}</span>,
          <SeverityBadge key={`${c.id}-sv`} severity={c.severity} />,
          c.subjectUserId
            ? <Link key={`${c.id}-u`} href={`/admin/users/${c.subjectUserId}`} className="text-blue-700 hover:underline">{c.subjectUserId.slice(0, 8)}…</Link>
            : <span key={`${c.id}-u`} className="text-xs text-slate-400">—</span>,
          <StatusBadge key={`${c.id}-st`} value={c.status} />,
          <span key={`${c.id}-o`} className="whitespace-nowrap text-xs text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</span>,
          <div key={`${c.id}-act`} className="flex flex-wrap gap-1.5">
            {c.status === 'open' ? <AdminActionButton action="update_fraud_case" label="Investigate" targetRecordId={c.id} newStatus="investigating" tone="primary" /> : null}
            {!['resolved', 'false_positive'].includes(c.status) ? <AdminActionButton action="update_fraud_case" label="Escalate" targetRecordId={c.id} newStatus="escalated" tone="warning" /> : null}
            {!['resolved', 'false_positive'].includes(c.status) ? <AdminActionButton action="update_fraud_case" label="Resolve" targetRecordId={c.id} newStatus="resolved" tone="neutral" requireReason confirm="Resolve this fraud case?" /> : null}
          </div>,
        ])}
        emptyText="No fraud cases. Open one from the Live Risk Monitor or a user profile."
      />
    </div>
  );
}
