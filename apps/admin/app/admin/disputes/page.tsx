import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { getDisputes } from '@/lib/admin-data';

const DisputeActions = (params: { disputeId: string; complainantId: string; status: string }) => {
  if (params.status === 'resolved' || params.status === 'rejected') {
    return <span className="text-xs text-slate-400">Closed</span>;
  }
  return (
    <div className="flex gap-1">
      <form action="/api/admin/action" method="post" className="inline">
        <input type="hidden" name="action"         value="resolve_dispute" />
        <input type="hidden" name="targetUserId"   value={params.complainantId} />
        <input type="hidden" name="targetRecordId" value={params.disputeId} />
        <input type="hidden" name="reason"         value="Resolved by admin after review." />
        <button type="submit" className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
          Resolve
        </button>
      </form>
      <form action="/api/admin/action" method="post" className="inline">
        <input type="hidden" name="action"         value="reject_dispute" />
        <input type="hidden" name="targetUserId"   value={params.complainantId} />
        <input type="hidden" name="targetRecordId" value={params.disputeId} />
        <input type="hidden" name="reason"         value="Dispute rejected after admin review." />
        <button type="submit" className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
          Reject
        </button>
      </form>
    </div>
  );
};

export default async function AdminDisputesPage(params: {
  searchParams?: Promise<{ status?: string; category?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const { disputes, total } = await getDisputes({
    status: sp.status || undefined,
    category: sp.category || undefined,
    page,
  });

  const buildUrl = (p: number) => {
    const q = new URLSearchParams();
    if (sp.status)   q.set('status', sp.status);
    if (sp.category) q.set('category', sp.category);
    q.set('page', String(p));
    return `/admin/disputes?${q.toString()}`;
  };

  const openCount       = disputes.filter((d) => d.status === 'open').length;
  const underReviewCount= disputes.filter((d) => d.status === 'under_review').length;
  const resolvedCount   = disputes.filter((d) => d.status === 'resolved').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Disputes</h2>
        <p className="text-sm text-slate-500">
          Review, resolve, or reject disputes. Users cannot self-resolve. Every action is audited.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Open (this page)"       value={openCount.toLocaleString()}        accent={openCount > 0 ? 'red' : 'slate'} />
        <KpiCard label="Under Review (this page)" value={underReviewCount.toLocaleString()} accent={underReviewCount > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Resolved (this page)"   value={resolvedCount.toLocaleString()}    accent="green" />
      </section>

      {/* Filters */}
      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <select name="status" defaultValue={sp.status ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under Review</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
          </select>
          <input
            name="category"
            defaultValue={sp.category ?? ''}
            placeholder="Category (e.g. payment)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
            Filter
          </button>
        </div>
      </form>

      <DataTable
        headers={['Title', 'Category', 'Priority', 'Complainant', 'Status', 'Created', 'Resolution', 'Actions']}
        rows={disputes.map((d) => [
          <span key={`${d.id}-t`} className="font-semibold text-slate-900">{d.title}</span>,
          d.category,
          <StatusBadge key={`${d.id}-p`} value={d.priority} />,
          <span key={`${d.id}-c`} className="font-mono text-xs">{d.complainantId.slice(0, 12)}…</span>,
          <StatusBadge key={`${d.id}-s`} value={d.status} />,
          new Date(d.createdAt).toLocaleDateString(),
          d.resolutionNote
            ? <span key={`${d.id}-r`} className="max-w-xs truncate text-xs text-slate-500">{d.resolutionNote}</span>
            : <span key={`${d.id}-r`} className="text-xs text-slate-400">—</span>,
          <DisputeActions
            key={`${d.id}-act`}
            disputeId={d.id}
            complainantId={d.complainantId}
            status={d.status}
          />,
        ])}
        emptyText="No disputes match the selected filters."
      />

      <Pagination total={total} page={page} pageSize={50} buildUrl={buildUrl} />
    </div>
  );
}
