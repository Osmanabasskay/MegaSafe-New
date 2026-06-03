import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { AdminActionButton } from '@/components/action-button';
import { getWithdrawals } from '@/lib/admin-data';

const ApproveForm = (params: { withdrawalId: string; userId: string }) => (
  <form action="/api/admin/action" method="post" className="inline">
    <input type="hidden" name="action"         value="approve_withdrawal" />
    <input type="hidden" name="targetUserId"   value={params.userId} />
    <input type="hidden" name="targetRecordId" value={params.withdrawalId} />
    <button type="submit" className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
      Approve
    </button>
  </form>
);

const RejectForm = (params: { withdrawalId: string; userId: string }) => (
  <form action="/api/admin/action" method="post" className="inline">
    <input type="hidden" name="action"         value="reject_withdrawal" />
    <input type="hidden" name="targetUserId"   value={params.userId} />
    <input type="hidden" name="targetRecordId" value={params.withdrawalId} />
    <input type="hidden" name="reason"         value="Rejected by admin." />
    <button type="submit" className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
      Reject
    </button>
  </form>
);

export default async function AdminPayoutsPage(params: {
  searchParams?: Promise<{ status?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const statusFilter = sp.status ?? '';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const { withdrawals, total } = await getWithdrawals({ status: statusFilter || undefined, page });

  const buildUrl = (p: number) => {
    const q = new URLSearchParams();
    if (statusFilter) q.set('status', statusFilter);
    q.set('page', String(p));
    return `/admin/payouts?${q.toString()}`;
  };

  const pendingCount  = withdrawals.filter((w) => w.status === 'pending').length;
  const totalPendingAmt = withdrawals.filter((w) => w.status === 'pending').reduce((s, w) => s + w.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Payouts &amp; Withdrawals</h2>
        <p className="text-sm text-slate-500">
          Approve or reject pending withdrawal requests. Every action is audited. Destination numbers
          are masked.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total (this page)"   value={total.toLocaleString()} accent="blue" />
        <KpiCard label="Pending (this page)" value={pendingCount.toLocaleString()} accent={pendingCount > 0 ? 'orange' : 'slate'} />
        <KpiCard label="Pending Amount"      value={`NLe ${totalPendingAmt.toFixed(2)}`} accent="orange" />
      </section>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {['', 'pending', 'approved', 'rejected', 'completed', 'failed'].map((s) => (
          <a
            key={s}
            href={`/admin/payouts?status=${s}&page=1`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              statusFilter === s
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </a>
        ))}
      </div>

      <DataTable
        headers={['User', 'Amount (NLe)', 'Provider', 'Destination', 'Status', 'Requested', 'Note', 'Actions']}
        rows={withdrawals.map((w) => [
          <span key={`${w.id}-u`} className="font-mono text-xs">{w.userId.slice(0, 12)}…</span>,
          w.amount.toFixed(2),
          w.destinationProvider,
          <span key={`${w.id}-dn`} className="font-mono text-xs text-slate-500">{w.destinationNumber}</span>,
          <StatusBadge key={`${w.id}-s`} value={w.status} />,
          new Date(w.requestedAt).toLocaleDateString(),
          w.reviewNote ?? '-',
          <div key={`${w.id}-act`} className="flex flex-wrap gap-1.5">
            {w.status === 'pending' ? (
              <>
                <ApproveForm withdrawalId={w.id} userId={w.userId} />
                <RejectForm  withdrawalId={w.id} userId={w.userId} />
              </>
            ) : null}
            <AdminActionButton action="freeze_payout" label="Freeze" targetUserId={w.userId} targetRecordId={w.id} tone="warning" requireReason confirm="Freeze this payout for compliance review?" />
            <AdminActionButton action="unfreeze_payout" label="Unfreeze" targetUserId={w.userId} targetRecordId={w.id} tone="neutral" />
            <AdminActionButton action="add_admin_note" label="Note" targetUserId={w.userId} targetRecordId={w.id} tone="neutral" requireReason />
          </div>,
        ])}
        emptyText="No withdrawal requests match the selected filter."
      />

      <Pagination total={total} page={page} pageSize={50} buildUrl={buildUrl} />

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <p className="font-semibold text-slate-700">Security notes</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Destination phone numbers are masked. The full number is stored encrypted in the database.</li>
          <li>Approve / Reject actions are processed server-side and require super_admin role.</li>
          <li>Every action is written to the immutable audit_logs table.</li>
          <li>Financial ledger records are read-only — this UI cannot modify balances directly.</li>
        </ul>
      </div>
    </div>
  );
}
