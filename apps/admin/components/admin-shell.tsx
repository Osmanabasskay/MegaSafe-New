import Link from 'next/link';
import type { ReactNode } from 'react';

const navItems = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/kyc', label: 'KYC Queue' },
  { href: '/admin/groups', label: 'Groups' },
  { href: '/admin/collectors', label: 'Collectors' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/audit', label: 'Audit Logs' },
];

export const AdminShell = (params: { adminName: string; children: ReactNode }) => (
  <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MegaSafe</p>
          <h1 className="text-xl font-black text-slate-900">Super Admin Dashboard</h1>
        </div>
        <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
          {params.adminName}
        </div>
      </div>
    </header>
    <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[220px_1fr]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-3">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main>{params.children}</main>
    </div>
  </div>
);
