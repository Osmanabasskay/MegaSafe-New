import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { StatusBadge } from '@/components/status-badge';
import { getSavingsSummary } from '@/lib/admin-data';

export default async function AdminSavingsPage() {
  const { goals, transactions, totalBalanceNLe, activeGoalsCount, completedGoalsCount } =
    await getSavingsSummary();

  const fmtCur = (n: number) => `NLe ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Savings</h2>
        <p className="text-sm text-slate-500">Read-only view of all savings goals and transactions.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total Savings Balance" value={fmtCur(totalBalanceNLe)}          accent="green" />
        <KpiCard label="Active Goals"           value={activeGoalsCount.toLocaleString()} accent="blue" />
        <KpiCard label="Completed Goals"        value={completedGoalsCount.toLocaleString()} accent="slate" />
      </section>

      {/* Goals */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Savings Goals (latest 300)</h3>
        <DataTable
          headers={['Title', 'Owner', 'Current (NLe)', 'Target (NLe)', 'Progress', 'Category', 'Status']}
          rows={goals.map((g) => {
            const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
            return [
              g.title,
              <span key={`${g.id}-u`} className="font-mono text-xs">{g.userId.slice(0, 12)}…</span>,
              g.currentAmount.toFixed(2),
              g.targetAmount.toFixed(2),
              <div key={`${g.id}-p`} className="flex items-center gap-2">
                <div className="h-1.5 w-20 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-slate-500">{pct.toFixed(0)}%</span>
              </div>,
              g.category ?? '-',
              <StatusBadge key={`${g.id}-s`} value={g.status} />,
            ];
          })}
          emptyText="No savings goals."
        />
      </section>

      {/* Savings Transactions */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Savings Transactions (latest 300)</h3>
        <DataTable
          headers={['Goal ID', 'User ID', 'Type', 'Amount (NLe)', 'Reference', 'Date']}
          rows={transactions.map((t) => [
            <span key={`${t.id}-g`} className="font-mono text-xs">{t.goalId.slice(0, 12)}…</span>,
            <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
            <StatusBadge key={`${t.id}-tp`} value={t.type} />,
            t.amount.toFixed(2),
            t.reference ?? '-',
            new Date(t.createdAt).toLocaleDateString(),
          ])}
          emptyText="No savings transactions."
        />
      </section>
    </div>
  );
}
