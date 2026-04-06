import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { getGroupMonitor } from '@/lib/admin-data';

const GroupActions = (params: { groupId: string }) => (
  <div className="flex flex-wrap gap-2">
    <form action="/api/admin/action" method="post">
      <input type="hidden" name="action" value="pause_group" />
      <input type="hidden" name="targetRecordId" value={params.groupId} />
      <input type="hidden" name="targetUserId" value={params.groupId} />
      <input type="hidden" name="tableName" value="osusu_groups" />
      <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold">
        Pause
      </button>
    </form>
    <form action="/api/admin/action" method="post">
      <input type="hidden" name="action" value="force_disband_group" />
      <input type="hidden" name="targetRecordId" value={params.groupId} />
      <input type="hidden" name="targetUserId" value={params.groupId} />
      <input type="hidden" name="tableName" value="osusu_groups" />
      <button type="submit" className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700">
        Force disband
      </button>
    </form>
  </div>
);

export default async function AdminGroupsPage() {
  const groups = await getGroupMonitor();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Group Monitor</h2>
        <p className="text-sm text-slate-500">
          Suspicious groups are flagged when dispute rate exceeds 50% or payout volume spikes.
        </p>
      </div>

      <DataTable
        headers={['Name', 'Creator', 'Members', 'Volume (NLe)', 'Status', 'Dispute Rate', 'Flags', 'Actions']}
        rows={groups.map((group) => [
          group.name,
          group.creatorName,
          group.members,
          group.volumeNLe.toFixed(2),
          <StatusBadge key={`${group.id}-status`} value={group.status} />,
          `${group.disputeRate}%`,
          group.suspicious ? (
            <span key={`${group.id}-flag`} className="rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">
              Suspicious
            </span>
          ) : (
            <span key={`${group.id}-flag`} className="text-xs text-slate-400">
              Normal
            </span>
          ),
          <GroupActions key={`${group.id}-actions`} groupId={group.id} />,
        ])}
      />
    </div>
  );
}
