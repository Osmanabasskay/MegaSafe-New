import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { getUsers } from '@/lib/admin-data';

export default async function AdminUsersPage(params: {
  searchParams?: Promise<{
    search?: string;
    kyc?: string;
    role?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const { users, total } = await getUsers({
    search: sp.search,
    kycStatus: sp.kyc,
    role: sp.role,
    status: sp.status,
    page,
    pageSize: 50,
  });

  const buildUrl = (p: number) => {
    const q = new URLSearchParams();
    if (sp.search) q.set('search', sp.search);
    if (sp.kyc)    q.set('kyc', sp.kyc);
    if (sp.role)   q.set('role', sp.role);
    if (sp.status) q.set('status', sp.status);
    q.set('page', String(p));
    return `/admin/users?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900">User Management</h2>
          <p className="text-sm text-slate-500">{total.toLocaleString()} users total</p>
        </div>
        <a
          href="/api/admin/reports/export?format=csv&type=users"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      {/* Filters */}
      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
          <input
            name="search"
            defaultValue={sp.search ?? ''}
            placeholder="Name / phone / email"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select name="kyc" defaultValue={sp.kyc ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All KYC</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select name="role" defaultValue={sp.role ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="group_creator">Creator</option>
            <option value="collector">Collector</option>
            <option value="member">Member</option>
          </select>
          <select name="status" defaultValue={sp.status ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white"
          >
            Search
          </button>
        </div>
      </form>

      <DataTable
        headers={['Name', 'Phone', 'Email', 'KYC', 'Role', 'Joined', 'Status']}
        rows={users.map((user) => [
          <Link key={`${user.id}-n`} href={`/admin/users/${user.id}`} className="font-semibold text-blue-700 hover:underline">
            {user.name}
          </Link>,
          user.phone,
          user.email,
          <StatusBadge key={`${user.id}-k`} value={user.kycStatus} />,
          <span key={`${user.id}-r`} className="text-xs text-slate-600">{user.role.replace('_', ' ')}</span>,
          new Date(user.createdAt).toLocaleDateString(),
          <StatusBadge key={`${user.id}-s`} value={user.status} />,
        ])}
        emptyText="No users match these filters."
      />

      <Pagination total={total} page={page} pageSize={50} buildUrl={buildUrl} />
    </div>
  );
}
