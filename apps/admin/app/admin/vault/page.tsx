import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge } from '@/components/status-badge';
import { getVaultSummary } from '@/lib/admin-data';

export default async function AdminVaultPage() {
  const { summary, topups, transactions, accounts } = await getVaultSummary();

  const fmtCur = (n: number) => `NLe ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Vault</h2>
        <p className="text-sm text-slate-500">Read-only view of all vault accounts, topups, and transactions.</p>
      </div>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Topup Volume"  value={fmtCur(summary.totalTopupsNLe)}  accent="green" />
        <KpiCard label="Vault Accounts"      value={summary.totalAccounts.toLocaleString()} accent="blue" />
        <KpiCard label="Pending Topups"      value={summary.pendingTopups.toLocaleString()} accent="orange" />
        <KpiCard label="Failed Topups"       value={summary.failedTopups.toLocaleString()}  accent={summary.failedTopups > 0 ? 'red' : 'slate'} />
      </section>

      {/* Topups */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Vault Topups (latest 300)</h3>
          <a
            href="/api/admin/reports/export?format=csv&type=summary"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Export CSV
          </a>
        </div>
        <DataTable
          headers={['User ID', 'Amount (NLe)', 'Fee', 'Provider', 'Phone', 'Status', 'Date']}
          rows={topups.map((t) => [
            <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
            t.amount.toFixed(2),
            t.feeAmount.toFixed(2),
            t.provider,
            t.phoneNumber ?? '-',
            <StatusBadge key={`${t.id}-s`} value={t.status} />,
            new Date(t.createdAt).toLocaleDateString(),
          ])}
          emptyText="No topup records."
        />
      </section>

      {/* Vault Transactions */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Vault Transactions (latest 300)</h3>
        <DataTable
          headers={['User ID', 'Type', 'Amount (NLe)', 'Reference', 'Description', 'Date']}
          rows={transactions.map((t) => [
            <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
            <StatusBadge key={`${t.id}-tp`} value={t.type} />,
            t.amount.toFixed(2),
            t.reference ?? '-',
            <span key={`${t.id}-d`} className="max-w-xs truncate text-slate-500">{t.description ?? '-'}</span>,
            new Date(t.createdAt).toLocaleDateString(),
          ])}
          emptyText="No vault transactions."
        />
      </section>

      {/* Accounts */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Vault Accounts</h3>
        <DataTable
          headers={['Account ID', 'User ID', 'Currency', 'Status', 'Created']}
          rows={accounts.map((a) => [
            <span key={`${a.id}-id`} className="font-mono text-xs">{a.id.slice(0, 12)}…</span>,
            <span key={`${a.id}-u`}  className="font-mono text-xs">{a.userId.slice(0, 12)}…</span>,
            a.currency,
            <StatusBadge key={`${a.id}-s`} value={a.status} />,
            new Date(a.createdAt).toLocaleDateString(),
          ])}
          emptyText="No vault accounts."
        />
      </section>
    </div>
  );
}
