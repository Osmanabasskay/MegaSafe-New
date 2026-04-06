import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { getUserDetail } from '@/lib/admin-data';

const ActionForm = (params: {
  label: string;
  action: string;
  targetUserId: string;
  tableName: string;
  reason?: string;
}) => (
  <form action="/api/admin/action" method="post">
    <input type="hidden" name="action" value={params.action} />
    <input type="hidden" name="targetUserId" value={params.targetUserId} />
    <input type="hidden" name="tableName" value={params.tableName} />
    {params.reason ? <input type="hidden" name="reason" value={params.reason} /> : null}
    <button
      type="submit"
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50"
    >
      {params.label}
    </button>
  </form>
);

export default async function AdminUserDetailPage(params: { params: Promise<{ id: string }> }) {
  const { id } = await params.params;
  const detail = await getUserDetail(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/users" className="text-xs font-semibold text-blue-700">
            Back to users
          </Link>
          <h2 className="mt-1 text-2xl font-black text-slate-900">{detail.user.name}</h2>
          <p className="text-sm text-slate-500">
            {detail.user.email} · {detail.user.phone}
          </p>
        </div>
        <div className="flex gap-2">
          <StatusBadge value={detail.user.kycStatus} />
          <StatusBadge value={detail.user.status} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Admin Actions</h3>
        <p className="text-sm text-slate-500">
          Self-action prevention is enforced server-side on every action call.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionForm label="Approve KYC" action="approve_kyc" targetUserId={id} tableName="profiles" />
          <ActionForm
            label="Reject KYC"
            action="reject_kyc"
            targetUserId={id}
            tableName="profiles"
            reason="Missing documents"
          />
          <ActionForm label="Suspend" action="suspend_user" targetUserId={id} tableName="profiles" />
          <ActionForm label="Ban" action="ban_user" targetUserId={id} tableName="profiles" />
          <ActionForm label="Set Creator Role" action="change_role" targetUserId={id} tableName="profiles" reason="group_creator" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Guarantor</h3>
          {detail.guarantor ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>Name: {detail.guarantor.name}</p>
              <p>Phone: {detail.guarantor.phone}</p>
              <p>Relationship: {detail.guarantor.relationship}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No guarantor record found.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Group Memberships</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {detail.groups.length === 0 ? (
              <li className="text-slate-500">No memberships found.</li>
            ) : (
              detail.groups.map((group) => (
                <li key={group.id} className="rounded-lg border border-slate-100 px-3 py-2 text-slate-700">
                  {group.name} · {group.status}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-bold text-slate-900">Payment History</h3>
          <DataTable
            headers={['ID', 'Amount (NLe)', 'Date', 'Status']}
            rows={detail.payments.map((payment) => [
              payment.id,
              payment.amount.toFixed(2),
              new Date(payment.createdAt).toLocaleString(),
              payment.status,
            ])}
            emptyText="No payment records yet."
          />
        </div>
        <div>
          <h3 className="mb-2 text-lg font-bold text-slate-900">User Audit Log</h3>
          <DataTable
            headers={['Action', 'Table', 'Date']}
            rows={detail.audit.map((entry) => [
              entry.action,
              entry.tableName,
              new Date(entry.createdAt).toLocaleString(),
            ])}
            emptyText="No audit events for this user."
          />
        </div>
      </div>
    </div>
  );
}
