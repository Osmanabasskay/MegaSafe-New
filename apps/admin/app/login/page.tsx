import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// User-facing messages only. We never surface token/JWT internals to the UI.
const REASON_MESSAGES: Record<string, string> = {
  session_expired: 'Your session expired. Please sign in again.',
  not_authenticated: 'Please sign in to continue.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  insufficient_role: 'This account is not authorized for admin access.',
  account_suspended: 'This admin account has been suspended.',
  ip_not_allowed: 'Access from your network is not permitted.',
  server_misconfigured: 'Server configuration error. Contact the system administrator.',
};

const resolveMessage = (
  reason: string | undefined,
  denied: string | undefined
): string | null => {
  if (reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason];
  if (denied) return REASON_MESSAGES.insufficient_role;
  return null;
};

export default async function LoginPage(params: {
  searchParams?: Promise<{ denied?: string; reason?: string }>;
}) {
  const sp = (await params.searchParams) ?? {};

  // If a valid super admin is already signed in, skip the form. We only redirect
  // on a CONFIRMED privileged session, never on an error, so this can't loop with
  // the middleware (which sends unauthenticated users here in the first place).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const svc = createServiceClient();
    const { data: roleRow } = await svc
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle();
    if (roleRow) redirect('/admin');
  }

  const message = resolveMessage(sp.reason, sp.denied);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-slate-100 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500">
              <span className="text-sm font-black text-white">MO</span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Mi Osusu</p>
              <h1 className="text-xl font-black leading-none text-white">Super Admin Access</h1>
            </div>
          </div>

          <p className="text-sm leading-6 text-slate-300">
            This dashboard is restricted to super admin accounts. Sign in with your admin credentials
            below. Every action you take is logged to the immutable audit trail.
          </p>

          {message ? (
            <div className="mt-4 rounded-xl border border-amber-700 bg-amber-950/60 p-3 text-xs text-amber-200">
              {message}
            </div>
          ) : null}

          <LoginForm />

          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-400">
            <p className="font-semibold text-slate-300">Security notice</p>
            <p className="mt-1">
              Your role is verified from the database on every request — not from the auth token. IP
              allowlisting and rate limiting are enforced server-side.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
