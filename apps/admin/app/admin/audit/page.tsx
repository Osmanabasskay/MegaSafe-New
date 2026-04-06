import { DataTable } from '@/components/data-table';
import { getAuditRows } from '@/lib/admin-data';

export default async function AdminAuditPage(params: {
  searchParams?: Promise<{
    user?: string;
    action?: string;
    table?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const search = params.searchParams ? await params.searchParams : {};
  const rows = await getAuditRows({
    userId: search?.user,
    action: search?.action,
    tableName: search?.table,
    from: search?.from,
    to: search?.to,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Audit Log Viewer</h2>
        <p className="text-sm text-slate-500">
          Immutable read-only stream. Mutation endpoints are not exposed for audit log records.
        </p>
      </div>

      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            name="user"
            defaultValue={search?.user ?? ''}
            placeholder="User ID"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="action"
            defaultValue={search?.action ?? ''}
            placeholder="Action"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="table"
            defaultValue={search?.table ?? ''}
            placeholder="Table"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="from"
            type="date"
            defaultValue={search?.from ?? ''}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="to"
            type="date"
            defaultValue={search?.to ?? ''}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white"
        >
          Apply filters
        </button>
      </form>

      <DataTable
        headers={['Actor', 'Action', 'Table', 'Date', 'User ID']}
        rows={rows.map((entry) => [
          entry.actor,
          entry.action,
          entry.tableName,
          new Date(entry.createdAt).toLocaleString(),
          entry.userId ?? 'system',
        ])}
        emptyText="No audit records found for the selected filters."
      />
    </div>
  );
}
