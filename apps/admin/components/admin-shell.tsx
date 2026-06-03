import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './logout-button';

const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/admin',      label: 'Dashboard' },
      { href: '/admin/risk', label: 'Live Risk Monitor' },
    ],
  },
  {
    label: 'Users & KYC',
    items: [
      { href: '/admin/users',   label: 'Users' },
      { href: '/admin/kyc',     label: 'KYC Queue' },
      { href: '/admin/devices', label: 'Devices & Sessions' },
      { href: '/admin/logins',  label: 'Login Attempts' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/vault',         label: 'Vault' },
      { href: '/admin/savings',       label: 'Savings' },
      { href: '/admin/transactions',  label: 'Transactions' },
      { href: '/admin/payments',      label: 'Payments' },
      { href: '/admin/payouts',       label: 'Payouts' },
    ],
  },
  {
    label: 'Osusu',
    items: [
      { href: '/admin/groups',        label: 'Osusu Groups' },
      { href: '/admin/osusu',         label: 'Contributions' },
      { href: '/admin/collectors',    label: 'Collectors' },
    ],
  },
  {
    label: 'Compliance & Security',
    items: [
      { href: '/admin/disputes',       label: 'Disputes' },
      { href: '/admin/fraud',          label: 'Fraud Cases' },
      { href: '/admin/audit',          label: 'Audit Logs' },
      { href: '/admin/security',       label: 'Security Events' },
      { href: '/admin/rate-limits',    label: 'Rate Limits' },
      { href: '/admin/admin-activity', label: 'Admin Activity' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/reports', label: 'Reports & Exports' },
      { href: '/admin/health',  label: 'System Health' },
    ],
  },
];

export const AdminShell = (params: { adminName: string; children: ReactNode }) => (
  <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500">
            <span className="text-xs font-black text-white">MO</span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mi Osusu</p>
            <h1 className="text-base font-black leading-none text-slate-900">Super Admin</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 sm:inline">
            {params.adminName}
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>

    <div className="mx-auto grid max-w-screen-2xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
      <aside className="self-start">
        <nav className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {group.label}
              </p>
              {group.items.map((item) => (
                // prefetch disabled: each prefetch is a separate /admin/* request
                // that hits middleware and would refresh the session. Disabling it
                // keeps session refreshes tied to real navigations, avoiding the
                // parallel-refresh races behind `refresh_token_already_used`.
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0">{params.children}</main>
    </div>
  </div>
);
