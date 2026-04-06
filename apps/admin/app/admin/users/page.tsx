import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { getUsers } from '@/lib/admin-data';

export default async function AdminUsersPage() {
  const users = await getUsers();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">User Management</h2>
        <p className="text-sm text-slate-500">Search/filter wiring can connect to query params + Supabase filters.</p>
      </div>

      <DataTable
        headers={['Name', 'Phone', 'Country', 'KYC', 'Role', 'Created', 'Status']}
        rows={users.map((user) => [
          <Link key={`${user.id}-name`} href={`/admin/users/${user.id}`} className="font-semibold text-blue-700">
            {user.name}
          </Link>,
          user.phone,
          user.country,
          <StatusBadge key={`${user.id}-kyc`} value={user.kycStatus} />,
          user.role.replace('_', ' '),
          new Date(user.createdAt).toLocaleDateString(),
          <StatusBadge key={`${user.id}-status`} value={user.status} />,
        ])}
      />
    </div>
  );
}
