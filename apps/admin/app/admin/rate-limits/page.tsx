import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { getRateLimitEvents } from '@/lib/admin-data';

export default async function RateLimitsPage(params: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const { events, total, last24h } = await getRateLimitEvents({ page });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Rate Limits</h2>
        <p className="text-sm text-slate-500">Rate-limit & abuse telemetry from <span className="font-mono">rate_limit_log</span>.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Events (24h)" value={last24h.toLocaleString()} accent={last24h > 10 ? 'red' : 'slate'} />
        <KpiCard label="Total Logged" value={total.toLocaleString()} accent="slate" />
        <KpiCard label="Status" value={last24h > 50 ? 'Elevated' : 'Normal'} accent={last24h > 50 ? 'red' : 'green'} />
      </section>

      <DataTable
        headers={['User', 'IP Address', 'Action', 'Timestamp']}
        rows={events.map((e) => [
          e.userId ? <span key={`${e.id}-u`} className="font-mono text-xs">{e.userId.slice(0, 12)}…</span> : <span key={`${e.id}-u`} className="text-xs text-slate-400">Anonymous</span>,
          <span key={`${e.id}-ip`} className="font-mono text-xs">{e.ipAddress ?? '—'}</span>,
          <span key={`${e.id}-a`} className="font-mono text-xs">{e.action}</span>,
          new Date(e.createdAt).toLocaleString(),
        ])}
        emptyText="No rate-limit events recorded."
      />
      <Pagination total={total} page={page} pageSize={50} buildUrl={(p) => `/admin/rate-limits?page=${p}`} />
    </div>
  );
}
