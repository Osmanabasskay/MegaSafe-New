import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-slate-100 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">MegaSafe Admin</p>
        <h1 className="mt-2 text-3xl font-black">Super Admin Access</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          This dashboard uses Supabase session cookies and middleware role checks. Sign in through the
          main MegaSafe app with a `super_admin` account, then return here.
        </p>
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-400">
          If you were denied access, confirm your role and optional `ADMIN_IP_ALLOWLIST` settings.
        </div>
        <Link
          href="/admin"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-brand-orange px-4 py-3 text-sm font-bold text-white transition hover:opacity-90"
        >
          Retry Admin Access
        </Link>
      </div>
    </div>
  );
}
