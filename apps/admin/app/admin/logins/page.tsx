import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { getLoginAttempts } from '@/lib/admin-data';

const OUTCOMES = ['success', 'failed', 'locked', 'mfa_failed'];

export default async function LoginAttemptsPage(params: {
  searchParams?: Promise<{ outcome?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const { attempts, total, failed24h } = await getLoginAttempts({ outcome: sp.outcome, page });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Login Attempts</h2>
        <p className="text-sm text-slate-500">Authentication telemetry — detect brute force, password spraying & account takeover.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Failed (24h)" value={failed24h.toLocaleString()} accent={failed24h > 10 ? 'red' : 'slate'} />
        <KpiCard label="Total Logged" value={total.toLocaleString()} accent="slate" />
        <KpiCard label="Brute-Force Risk" value={failed24h > 20 ? 'High' : 'Low'} accent={failed24h > 20 ? 'red' : 'green'} />
      </section>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <select name="outcome" defaultValue={sp.outcome ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All Outcomes</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">Filter</button>
        <Link href="/admin/logins" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">Reset</Link>
      </form>

      <DataTable
        headers={['Outcome', 'User', 'Email', 'IP', 'Reason', 'When']}
        rows={attempts.map((a) => [
          <StatusBadge key={`${a.id}-o`} value={a.outcome === 'success' ? 'success' : a.outcome === 'locked' ? 'locked' : 'failed'} />,
          a.userId ? <Link key={`${a.id}-u`} href={`/admin/users/${a.userId}`} className="font-mono text-xs text-blue-700 hover:underline">{a.userId.slice(0, 8)}…</Link> : <span key={`${a.id}-u`} className="text-xs text-slate-400">—</span>,
          <span key={`${a.id}-e`} className="text-xs text-slate-600">{a.email ?? '—'}</span>,
          <span key={`${a.id}-ip`} className="font-mono text-xs text-slate-500">{a.ipAddress ?? '—'}</span>,
          <span key={`${a.id}-r`} className="text-xs text-slate-600">{a.reason ?? '—'}</span>,
          <span key={`${a.id}-w`} className="whitespace-nowrap text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</span>,
        ])}
        emptyText="No login attempts recorded yet. The auth layer writes here on each sign-in attempt."
      />
      <Pagination total={total} page={page} pageSize={50} buildUrl={(p) => `/admin/logins?${sp.outcome ? `outcome=${sp.outcome}&` : ''}page=${p}`} />
    </div>
  );
}
