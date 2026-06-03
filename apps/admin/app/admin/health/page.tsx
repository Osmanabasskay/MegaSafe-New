import { KpiCard } from '@/components/kpi-card';
import { DataTable } from '@/components/data-table';
import { getSystemHealth } from '@/lib/admin-data';

export default async function SystemHealthPage() {
  const health = await getSystemHealth();
  const tableCounts = (health.table_counts ?? {}) as Record<string, number>;
  const authErr = (health.auth_error_rate_24h ?? { failed: 0, total: 0 }) as { failed: number; total: number };
  const errRate = authErr.total > 0 ? Math.round((authErr.failed / authErr.total) * 100) : 0;
  const dbOk = health.db_connection === 'ok';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-slate-900">System Health</h2>
        <p className="text-sm text-slate-500">Operational status from <span className="font-mono">get_system_health_summary()</span>.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Supabase Connection" value={dbOk ? 'Online' : 'Error'} accent={dbOk ? 'green' : 'red'} />
        <KpiCard label="Webhook Failures (24h)" value={String(health.webhook_failures_24h ?? 0)} accent={Number(health.webhook_failures_24h) > 0 ? 'red' : 'slate'} />
        <KpiCard label="Auth Error Rate (24h)" value={`${errRate}%`} sub={`${authErr.failed}/${authErr.total} attempts`} accent={errRate > 30 ? 'red' : 'slate'} />
        <KpiCard label="RLS Denials (24h)" value={String(health.rls_denials_24h ?? 0)} accent={Number(health.rls_denials_24h) > 0 ? 'orange' : 'slate'} />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Database Table Counts</h3>
        <DataTable
          headers={['Table', 'Row Count']}
          rows={Object.entries(tableCounts).map(([t, c]) => [
            <span key={`${t}-n`} className="font-mono text-xs">{t}</span>,
            <span key={`${t}-c`} className="font-semibold tabular-nums">{Number(c).toLocaleString()}</span>,
          ])}
          emptyText="No table counts available."
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Migration & Runtime</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest Migration</dt>
            <dd className="font-mono text-sm text-slate-800">{String(health.latest_migration ?? 'unknown')}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated At</dt>
            <dd className="text-sm text-slate-800">{health.generated_at ? new Date(String(health.generated_at)).toLocaleString() : '—'}</dd>
          </div>
        </dl>
        {health.error ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">Error: {String(health.error)}</p> : null}
      </section>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        Edge Function / RPC / storage failure telemetry surfaces here as it is captured via <span className="font-mono">security_events</span> and webhook tables. Latency metrics require an APM integration (not yet configured).
      </div>
    </div>
  );
}
