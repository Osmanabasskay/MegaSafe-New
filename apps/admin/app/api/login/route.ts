import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { consumeAdminRateLimit, getClientIp, isIpAllowed } from '@/lib/security';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// This route is intentionally outside /api/admin/* so middleware does NOT run
// on it — an unauthenticated user must be able to reach it to log in. The rate
// limiting and IP check below are the primary guards at this boundary.
export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  if (!isIpAllowed(ip)) {
    return NextResponse.json({ error: 'ip_not_allowed' }, { status: 403 });
  }

  // 10 login attempts per 15 min per IP — separate budget from admin mutations.
  if (!await consumeAdminRateLimit(ip, 'admin_login')) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  // Sign in server-side so the session cookie is set by the server.
  // cookies() is writable in Next.js 15 App Router route handlers —
  // setAll writes Set-Cookie headers that the browser will store.
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

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Map Supabase error codes to safe, non-leaking messages.
    const status = error.status === 400 ? 401 : (error.status ?? 401);
    const message =
      error.message === 'Invalid login credentials'
        ? 'Incorrect email or password.'
        : 'Sign in failed. Check your credentials and try again.';
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
