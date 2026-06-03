import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { RiskScoreBadge, SeverityBadge } from '@/components/risk-badge';
import { AdminActionButton } from '@/components/action-button';
import { getUserDetail, getUserRiskProfile } from '@/lib/admin-data';

interface Counts { [k: string]: number }

export default async function AdminUserDetailPage(params: { params: Promise<{ id: string }> }) {
  const { id } = await params.params;
  const [detail, riskRaw] = await Promise.all([getUserDetail(id), getUserRiskProfile(id)]);
  const { user } = detail;
  const riskScore = Number(riskRaw.risk_score ?? 0);
  const counts = (riskRaw.counts ?? {}) as Counts;
  const riskEvents = (riskRaw.risk_events ?? []) as Array<Record<string, unknown>>;
  const loginAttempts = (riskRaw.login_attempts ?? []) as Array<Record<string, unknown>>;
  const devices = (riskRaw.devices ?? []) as Array<Record<string, unknown>>;
  const adminOnUser = (riskRaw.admin_actions_on_user ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/users" className="text-xs font-semibold text-blue-700 hover:underline">
            ← Back to Users
          </Link>
          <h2 className="mt-1 text-2xl font-black text-slate-900">{user.name}</h2>
          <p className="text-sm text-slate-500">
            ID: <span className="font-mono">{user.id}</span>
          </p>
          <p className="text-sm text-slate-500">
            {user.email} &middot; {user.phone}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RiskScoreBadge score={riskScore} />
          <StatusBadge value={user.kycStatus} />
          <StatusBadge value={user.status} />
          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            {user.role.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Risk snapshot */}
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Open Risk Events', counts.open_risk_events],
          ['Failed Logins 24h', counts.failed_logins_24h],
          ['Devices', counts.devices],
          ['Groups', counts.groups],
          ['Withdrawals', counts.withdrawals],
          ['Disputes', counts.disputes],
        ].map(([label, val]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-black text-slate-900">{Number(val ?? 0)}</p>
          </div>
        ))}
      </div>

      {/* Admin Actions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Admin Controls</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Every action is written to the <span className="font-mono">admin_actions</span> ledger. Self-action is blocked server-side. Destructive actions require confirmation.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <AdminActionButton label="Approve KYC"          action="approve_kyc"              targetUserId={id} tone="primary" confirm="Approve KYC for this user?" />
          <AdminActionButton label="Mark KYC Verified"    action="mark_kyc_verified"        targetUserId={id} tone="primary" confirm="Mark KYC verified?" />
          <AdminActionButton label="Reject KYC"           action="reject_kyc"               targetUserId={id} tone="warning" requireReason />
          <AdminActionButton label="Request Resubmission" action="request_kyc_resubmission" targetUserId={id} tone="neutral" requireReason />
          <AdminActionButton label="Escalate KYC"         action="escalate_kyc"             targetUserId={id} tone="neutral" requireReason />
          <AdminActionButton label="Suspend"              action="suspend_user"             targetUserId={id} tone="warning" requireReason />
          <AdminActionButton label="Unsuspend"            action="unsuspend_user"           targetUserId={id} tone="neutral" />
          <AdminActionButton label="Lock Account"         action="lock_account"             targetUserId={id} tone="danger" requireReason />
          <AdminActionButton label="Unlock"               action="unlock_account"           targetUserId={id} tone="neutral" />
          <AdminActionButton label="Force Logout"         action="force_logout"             targetUserId={id} tone="warning" requireReason />
          <AdminActionButton label="Ban"                  action="ban_user"                 targetUserId={id} tone="danger" requireReason />
          <AdminActionButton label="Add Admin Note"       action="add_admin_note"           targetUserId={id} tone="neutral" requireReason />
          <AdminActionButton label="Open Fraud Case"      action="create_fraud_case"        targetUserId={id} tone="warning" severity="high" requireReason />
        </div>
      </div>

      {/* Profile & Guarantor */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Profile</h3>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex gap-2"><dt className="font-semibold">Email:</dt><dd>{user.email}</dd></div>
            <div className="flex gap-2"><dt className="font-semibold">Phone:</dt><dd>{user.phone}</dd></div>
            <div className="flex gap-2"><dt className="font-semibold">Country:</dt><dd>{user.country}</dd></div>
            <div className="flex gap-2"><dt className="font-semibold">Joined:</dt><dd>{new Date(user.createdAt).toLocaleDateString()}</dd></div>
            <div className="flex gap-2"><dt className="font-semibold">Active:</dt><dd>{user.isActive ? 'Yes' : 'No'}</dd></div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Guarantor</h3>
          {detail.guarantor ? (
            <dl className="mt-2 space-y-1 text-sm text-slate-700">
              <div className="flex gap-2"><dt className="font-semibold">Name:</dt><dd>{detail.guarantor.name}</dd></div>
              <div className="flex gap-2"><dt className="font-semibold">Phone:</dt><dd>{detail.guarantor.phone}</dd></div>
              <div className="flex gap-2"><dt className="font-semibold">Relationship:</dt><dd>{detail.guarantor.relationship}</dd></div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-slate-400">No guarantor on file.</p>
          )}
        </div>
      </div>

      {/* Vault & Savings */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Vault Topups</h3>
          <DataTable
            headers={['Amount (NLe)', 'Provider', 'Status', 'Date']}
            rows={detail.vaultTopups.map((t) => [
              t.amount.toFixed(2),
              t.provider,
              <StatusBadge key={`${t.id}-s`} value={t.status} />,
              new Date(t.createdAt).toLocaleDateString(),
            ])}
            emptyText="No vault topups."
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Savings Goals</h3>
          {detail.savingsGoals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No savings goals.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {detail.savingsGoals.map((g) => (
                <li key={g.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                  <p className="font-semibold text-slate-900">{g.title}</p>
                  <p className="text-xs text-slate-500">
                    NLe {g.currentAmount.toFixed(2)} / {g.targetAmount.toFixed(2)} &middot; {g.status}
                  </p>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-orange-500"
                      style={{ width: `${Math.min(100, g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Group Memberships & Payments */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Group Memberships</h3>
          <DataTable
            headers={['Group', 'Status']}
            rows={detail.groups.map((g) => [
              g.name,
              <StatusBadge key={`${g.id}-s`} value={g.status} />,
            ])}
            emptyText="No group memberships."
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Contribution Payments</h3>
          <DataTable
            headers={['Amount (NLe)', 'Date', 'Status']}
            rows={detail.payments.map((p) => [
              p.amount.toFixed(2),
              new Date(p.createdAt).toLocaleDateString(),
              <StatusBadge key={`${p.id}-s`} value={p.status} />,
            ])}
            emptyText="No payment records."
          />
        </div>
      </div>

      {/* Risk Events */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Risk Events</h3>
        <p className="text-xs text-slate-500">Fraud / attack signals targeting this user.</p>
        <DataTable
          headers={['Severity', 'Score', 'Event', 'Reason', 'Status', 'When']}
          rows={riskEvents.map((e) => [
            <SeverityBadge key={`${String(e.id)}-sv`} severity={String(e.severity ?? 'low')} />,
            <RiskScoreBadge key={`${String(e.id)}-sc`} score={Number(e.risk_score ?? 0)} showLabel={false} />,
            <span key={`${String(e.id)}-t`} className="font-mono text-xs">{String(e.event_type ?? '')}</span>,
            <span key={`${String(e.id)}-r`} className="text-xs text-slate-600">{e.reason ? String(e.reason) : '—'}</span>,
            <StatusBadge key={`${String(e.id)}-s`} value={String(e.status ?? 'open')} />,
            new Date(String(e.created_at ?? '')).toLocaleString(),
          ])}
          emptyText="No risk events for this user."
        />
      </div>

      {/* Login & Devices */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Login Attempts</h3>
          <DataTable
            headers={['Outcome', 'IP', 'Reason', 'When']}
            rows={loginAttempts.map((l) => [
              <StatusBadge key={`${String(l.id)}-o`} value={String(l.outcome) === 'success' ? 'success' : 'failed'} />,
              <span key={`${String(l.id)}-ip`} className="font-mono text-xs">{l.ip_address ? String(l.ip_address) : '—'}</span>,
              <span key={`${String(l.id)}-r`} className="text-xs text-slate-600">{l.reason ? String(l.reason) : '—'}</span>,
              new Date(String(l.created_at ?? '')).toLocaleString(),
            ])}
            emptyText="No login attempts recorded."
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-900">Devices &amp; Sessions</h3>
          <DataTable
            headers={['Device', 'IP', 'Trusted', 'Last Seen']}
            rows={devices.map((d) => [
              <span key={`${String(d.id)}-d`} className="text-xs text-slate-600">{d.device_name ? String(d.device_name) : 'Unknown'}</span>,
              <span key={`${String(d.id)}-ip`} className="font-mono text-xs">{d.ip_address ? String(d.ip_address) : '—'}</span>,
              <StatusBadge key={`${String(d.id)}-t`} value={d.is_trusted ? 'verified' : 'pending'} />,
              new Date(String(d.last_seen_at ?? '')).toLocaleString(),
            ])}
            emptyText="No devices recorded."
          />
        </div>
      </div>

      {/* Admin actions performed on this user */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Admin Actions on This User</h3>
        <p className="text-xs text-slate-500">Insider-fraud trail — who did what to this account.</p>
        <DataTable
          headers={['Admin', 'Action', 'Reason / Note', 'Status', 'When']}
          rows={adminOnUser.map((a) => [
            <span key={`${String(a.id)}-ad`} className="font-semibold text-slate-800">{a.admin_name ? String(a.admin_name) : 'Admin'}</span>,
            <span key={`${String(a.id)}-ac`} className="font-mono text-xs">{String(a.action ?? '')}</span>,
            <span key={`${String(a.id)}-r`} className="text-xs text-slate-600">{a.reason ? String(a.reason) : '—'}</span>,
            <StatusBadge key={`${String(a.id)}-s`} value={String(a.status ?? 'success')} />,
            new Date(String(a.created_at ?? '')).toLocaleString(),
          ])}
          emptyText="No admin actions on this user."
        />
      </div>

      {/* Audit Log */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Audit Trail</h3>
        <p className="text-xs text-slate-500">Last 20 audit events for this user.</p>
        <DataTable
          headers={['Action', 'Table', 'IP', 'Date']}
          rows={detail.audit.map((e) => [
            <span key={`${e.id}-a`} className="font-mono text-xs">{e.action}</span>,
            e.tableName,
            e.ipAddress ?? '-',
            new Date(e.createdAt).toLocaleString(),
          ])}
          emptyText="No audit events for this user."
        />
      </div>
    </div>
  );
}
