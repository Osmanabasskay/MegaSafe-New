import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { AdminActionButton } from '@/components/action-button';
import { getDeviceSessions } from '@/lib/admin-data';

export default async function DevicesPage(params: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const { sessions, total } = await getDeviceSessions({ page });
  const active = sessions.filter((s) => !s.revokedAt).length;
  const untrusted = sessions.filter((s) => !s.isTrusted && !s.revokedAt).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Devices &amp; Sessions</h2>
        <p className="text-sm text-slate-500">Per-user device tracking for account-takeover detection.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Tracked Sessions" value={total.toLocaleString()} accent="slate" />
        <KpiCard label="Active (page)" value={String(active)} accent="blue" />
        <KpiCard label="Untrusted (page)" value={String(untrusted)} accent={untrusted > 0 ? 'orange' : 'slate'} />
      </section>

      <DataTable
        headers={['User', 'Device', 'IP', 'Trusted', 'Last Seen', 'Session', 'Actions']}
        rows={sessions.map((s) => [
          <Link key={`${s.id}-u`} href={`/admin/users/${s.userId}`} className="font-semibold text-blue-700 hover:underline">{s.userName}</Link>,
          <span key={`${s.id}-d`} className="text-xs text-slate-600">{s.deviceName ?? 'Unknown device'}</span>,
          <span key={`${s.id}-ip`} className="font-mono text-xs text-slate-500">{s.ipAddress ?? '—'}</span>,
          <StatusBadge key={`${s.id}-t`} value={s.isTrusted ? 'verified' : 'pending'} />,
          <span key={`${s.id}-ls`} className="whitespace-nowrap text-xs text-slate-500">{new Date(s.lastSeenAt).toLocaleString()}</span>,
          <StatusBadge key={`${s.id}-r`} value={s.revokedAt ? 'inactive' : 'active'} />,
          !s.revokedAt ? <AdminActionButton key={`${s.id}-act`} action="force_logout" label="Force Logout" targetUserId={s.userId} tone="warning" requireReason confirm="Revoke this user's sessions?" /> : <span key={`${s.id}-act`} className="text-xs text-slate-400">revoked</span>,
        ])}
        emptyText="No device sessions tracked yet. Sessions appear here once the app records device fingerprints."
      />
      <Pagination total={total} page={page} pageSize={50} buildUrl={(p) => `/admin/devices?page=${p}`} />
    </div>
  );
}
