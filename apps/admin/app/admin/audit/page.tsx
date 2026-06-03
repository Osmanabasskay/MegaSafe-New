import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { getAuditRows } from '@/lib/admin-data';

export default async function AdminAuditPage(params: {
  searchParams?: Promise<{
    user?: string;
    action?: string;
    table?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const { rows, total } = await getAuditRows({
    userId:    sp.user,
    action:    sp.action,
    tableName: sp.table,
    from:      sp.from,
    to:        sp.to,
    page,
  });

  const buildUrl = (p: number) => {
    const q = new URLSearchParams();
    if (sp.user)   q.set('user', sp.user);
    if (sp.action) q.set('action', sp.action);
    if (sp.table)  q.set('table', sp.table);
    if (sp.from)   q.set('from', sp.from);
    if (sp.to)     q.set('to', sp.to);
    q.set('page', String(p));
    return `/admin/audit?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Audit Logs</h2>
          <p className="text-sm text-slate-500">
            Immutable, read-only stream. {total.toLocaleString()} records match the current filters.
          </p>
        </div>
        <a
          href="/api/admin/reports/export?format=csv&type=summary"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
          <input
            name="user"
            defaultValue={sp.user ?? ''}
            placeholder="Actor UUID"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="action"
            defaultValue={sp.action ?? ''}
            placeholder="Action keyword"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="table"
            defaultValue={sp.table ?? ''}
            placeholder="Table name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input name="from" type="date" defaultValue={sp.from ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="to"   type="date" defaultValue={sp.to ?? ''}   className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
          Apply Filters
        </button>
      </form>

      <DataTable
        headers={['Actor', 'Action', 'Table', 'Record', 'IP', 'Date']}
        rows={rows.map((e) => [
          <span key={`${e.id}-a`} className="font-mono text-xs">{e.actor}</span>,
          <span key={`${e.id}-ac`} className="font-mono text-xs text-slate-700">{e.action}</span>,
          e.tableName,
          e.recordId ? <span key={`${e.id}-r`} className="font-mono text-xs text-slate-500">{e.recordId.slice(0, 12)}…</span> : '-',
          e.ipAddress ?? '-',
          new Date(e.createdAt).toLocaleString(),
        ])}
        emptyText="No audit records match the selected filters."
      />

      <Pagination total={total} page={page} pageSize={50} buildUrl={buildUrl} />
    </div>
  );
}
