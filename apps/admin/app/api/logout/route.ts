import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ROLE_CACHE_COOKIE } from '@/lib/role-cache';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const isSupabaseAuthCookie = (name: string): boolean =>
  name.startsWith('sb-') && name.includes('-auth-token');

// Handles logout for all scenarios including httpOnly cookie cleanup.
// Because the role cache cookie is httpOnly (set by middleware/server), it
// cannot be cleared by client-side JavaScript — this route handles that.
// The session invalidation on Supabase Auth servers is done by supabase.auth.signOut().
export async function POST() {
  const cookieStore = await cookies();

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (
        cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>
      ) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options as never);
        });
      },
    },
  });

  // Invalidate the refresh token on Supabase Auth servers.
  // Errors are intentionally ignored — if the session is already expired or
  // the token already invalid, we still want to clear local cookies and redirect.
  await supabase.auth.signOut().catch(() => undefined);

  // Explicitly expire all Supabase session cookies and the role cache cookie
  // to ensure the browser drops them even if signOut's setAll was a no-op.
  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookie(cookie.name) || cookie.name === ROLE_CACHE_COOKIE) {
      cookieStore.set(cookie.name, '', { maxAge: 0, path: '/' });
    }
  }

  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3000'), {
    status: 303,
  });
}
