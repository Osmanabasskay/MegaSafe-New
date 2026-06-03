import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { getCommissions, getOsusuContributions } from '@/lib/admin-data';

export default async function AdminOsusuPage(params: {
  searchParams?: Promise<{ tab?: string; status?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const tab = sp.tab ?? 'contributions';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const buildUrl = (p: number) => `/admin/osusu?tab=${tab}${sp.status ? `&status=${sp.status}` : ''}&page=${p}`;

  let content: React.ReactNode = null;
  let total = 0;

  if (tab === 'contributions') {
    const { contributions, total: cTotal } = await getOsusuContributions({
      status: sp.status || undefined,
      page,
    });
    total = cTotal;

    const approvedAmt = contributions.filter((c) => c.status === 'approved').reduce((s, c) => s + c.amount, 0);
    const pendingCount = contributions.filter((c) => c.status === 'pending').length;

    content = (
      <>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <KpiCard label="Approved (this page)"  value={`NLe ${approvedAmt.toFixed(2)}`} accent="green" />
          <KpiCard label="Pending (this page)"   value={pendingCount.toLocaleString()} accent="orange" />
          <KpiCard label="Total (this page)"     value={contributions.length.toLocaleString()} accent="blue" />
        </div>

        {/* Status filter */}
        <div className="mb-4 flex flex-wrap gap-2">
          {['', 'pending', 'approved', 'rejected', 'cancelled'].map((s) => (
            <a
              key={s}
              href={`/admin/osusu?tab=contributions&status=${s}&page=1`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                (sp.status ?? '') === s
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </a>
          ))}
        </div>

        <DataTable
          headers={['Group', 'Member', 'Amount (NLe)', 'Method', 'Status', 'Collected', 'Created']}
          rows={contributions.map((c) => [
            c.groupName,
            <span key={`${c.id}-m`} className="font-mono text-xs">{c.memberId.slice(0, 12)}…</span>,
            c.amount.toFixed(2),
            c.paymentMethod ?? '-',
            <StatusBadge key={`${c.id}-s`} value={c.status} />,
            c.collectedAt ? new Date(c.collectedAt).toLocaleDateString() : '-',
            new Date(c.createdAt).toLocaleDateString(),
          ])}
          emptyText="No contribution payments."
        />
      </>
    );
  } else if (tab === 'commissions') {
    const { commissions, total: cTotal, totalPaidNLe } = await getCommissions({
      status: sp.status || undefined,
      page,
    });
    total = cTotal;

    content = (
      <>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <KpiCard label="Total Paid Commissions" value={`NLe ${totalPaidNLe.toFixed(2)}`} accent="green" />
          <KpiCard label="Records (this page)"    value={commissions.length.toLocaleString()} accent="blue" />
        </div>
        <DataTable
          headers={['Collector', 'Group', 'Rate', 'Base (NLe)', 'Commission (NLe)', 'Status', 'Created']}
          rows={commissions.map((c) => [
            <span key={`${c.id}-col`} className="font-mono text-xs">{c.collectorId.slice(0, 12)}…</span>,
            <span key={`${c.id}-g`}   className="font-mono text-xs">{c.groupId.slice(0, 12)}…</span>,
            `${(Number(c.rate) * 100).toFixed(1)}%`,
            c.baseAmount.toFixed(2),
            <span key={`${c.id}-ca`} className="font-semibold text-emerald-700">{c.commissionAmount.toFixed(2)}</span>,
            <StatusBadge key={`${c.id}-s`} value={c.status} />,
            new Date(c.createdAt).toLocaleDateString(),
          ])}
          emptyText="No commission records."
        />
      </>
    );
  }

  const tabs = [
    { key: 'contributions', label: 'Contributions' },
    { key: 'commissions',   label: 'Commissions' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Osusu</h2>
        <p className="text-sm text-slate-500">Contribution payments and collector commissions.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={`/admin/osusu?tab=${t.key}&page=1`}
            className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold transition ${
              tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
