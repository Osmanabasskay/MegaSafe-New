import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { getCollectorMonitor } from '@/lib/admin-data';

const CollectorActions = (params: { userId: string; active: boolean }) => (
  <form action="/api/admin/action" method="post">
    <input type="hidden" name="action" value={params.active ? 'suspend_collector' : 'reinstate_collector'} />
    <input type="hidden" name="targetUserId" value={params.userId} />
    <input type="hidden" name="tableName" value="collectors" />
    <button
      type="submit"
      className={`rounded-md px-2 py-1 text-xs font-semibold ${
        params.active ? 'border border-rose-300 text-rose-700' : 'border border-emerald-300 text-emerald-700'
      }`}
    >
      {params.active ? 'Suspend' : 'Reinstate'}
    </button>
  </form>
);

export default async function AdminCollectorsPage() {
  const collectors = await getCollectorMonitor();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Collector Monitor</h2>
        <p className="text-sm text-slate-500">
          Red flag threshold: unverified collections over 24h above configured NLe amount.
        </p>
      </div>

      <DataTable
        headers={['Collector', 'Daily Collections', 'Verification Rate', 'Disputes', 'Unverified >24h', 'Status', 'Action']}
        rows={collectors.map((collector) => [
          collector.name,
          `NLe ${collector.dailyCollectionsNLe.toFixed(2)}`,
          `${collector.verificationRate}%`,
          collector.disputeCount,
          collector.unverifiedOlderThan24hNLe > 0 ? (
            <span key={`${collector.userId}-flag`} className="font-semibold text-rose-700">
              NLe {collector.unverifiedOlderThan24hNLe.toFixed(2)}
            </span>
          ) : (
            'NLe 0.00'
          ),
          <StatusBadge key={`${collector.userId}-status`} value={collector.status} />,
          <CollectorActions key={`${collector.userId}-action`} userId={collector.userId} active={collector.status === 'active'} />,
        ])}
      />
    </div>
  );
}
