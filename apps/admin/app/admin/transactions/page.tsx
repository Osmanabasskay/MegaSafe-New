import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { getOsusuContributions, getSavingsSummary, getVaultSummary } from '@/lib/admin-data';

export default async function AdminTransactionsPage(params: {
  searchParams?: Promise<{ tab?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const tab = sp.tab ?? 'vault';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const buildUrl = (p: number) => `/admin/transactions?tab=${tab}&page=${p}`;

  let content: React.ReactNode = null;
  let total = 0;

  if (tab === 'vault') {
    const { transactions, summary } = await getVaultSummary();
    total = transactions.length;
    content = (
      <>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <KpiCard label="Vault Topup Volume" value={`NLe ${summary.totalTopupsNLe.toFixed(2)}`} accent="green" />
          <KpiCard label="Pending Topups"     value={summary.pendingTopups.toLocaleString()} accent="orange" />
        </div>
        <DataTable
          headers={['User', 'Type', 'Amount (NLe)', 'Reference', 'Description', 'Date']}
          rows={transactions.slice((page - 1) * 50, page * 50).map((t) => [
            <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
            <StatusBadge key={`${t.id}-tp`} value={t.type} />,
            t.amount.toFixed(2),
            t.reference ?? '-',
            <span key={`${t.id}-d`} className="max-w-xs truncate text-slate-500">{t.description ?? '-'}</span>,
            new Date(t.createdAt).toLocaleDateString(),
          ])}
          emptyText="No vault transactions."
        />
      </>
    );
  } else if (tab === 'savings') {
    const { transactions } = await getSavingsSummary();
    total = transactions.length;
    content = (
      <DataTable
        headers={['Goal', 'User', 'Type', 'Amount (NLe)', 'Reference', 'Date']}
        rows={transactions.slice((page - 1) * 50, page * 50).map((t) => [
          <span key={`${t.id}-g`} className="font-mono text-xs">{t.goalId.slice(0, 12)}…</span>,
          <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
          <StatusBadge key={`${t.id}-tp`} value={t.type} />,
          t.amount.toFixed(2),
          t.reference ?? '-',
          new Date(t.createdAt).toLocaleDateString(),
        ])}
        emptyText="No savings transactions."
      />
    );
  } else if (tab === 'contributions') {
    const { contributions, total: cTotal } = await getOsusuContributions({ page });
    total = cTotal;
    content = (
      <DataTable
        headers={['Group', 'Member', 'Amount (NLe)', 'Method', 'Status', 'Date']}
        rows={contributions.map((c) => [
          c.groupName,
          <span key={`${c.id}-m`} className="font-mono text-xs">{c.memberId.slice(0, 12)}…</span>,
          c.amount.toFixed(2),
          c.paymentMethod ?? '-',
          <StatusBadge key={`${c.id}-s`} value={c.status} />,
          new Date(c.createdAt).toLocaleDateString(),
        ])}
        emptyText="No contribution payments."
      />
    );
  }

  const tabs = [
    { key: 'vault',         label: 'Vault Transactions' },
    { key: 'savings',       label: 'Savings Transactions' },
    { key: 'contributions', label: 'Osusu Contributions' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Transactions</h2>
        <p className="text-sm text-slate-500">Unified view of all financial movements across Vault, Savings, and Osusu.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={`/admin/transactions?tab=${t.key}&page=1`}
            className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold transition ${
              tab === t.key
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {content}

      <Pagination total={total} page={page} pageSize={50} buildUrl={buildUrl} />
    </div>
  );
}
