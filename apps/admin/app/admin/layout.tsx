import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { requireSuperAdmin } from '@/lib/admin-data';

export default async function AdminLayout(params: { children: ReactNode }) {
  const context = await requireSuperAdmin();
  return <AdminShell adminName={context.userName}>{params.children}</AdminShell>;
}
