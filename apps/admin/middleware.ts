import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { consumeAdminRateLimit, getClientIp, isIpAllowed, isSuperAdminRole } from '@/lib/security';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const deny = (request: NextRequest, status: number, reason: string): NextResponse => {
  if (request.nextUrl.pathname.startsWith('/api/admin')) {
    return NextResponse.json({ error: reason }, { status });
  }
  const url = new URL('/login', request.url);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
};

export async function middleware(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!isIpAllowed(ip)) return deny(request, 403, 'ip_not_allowed');
  if (!consumeAdminRateLimit(ip)) return deny(request, 429, 'rate_limited');

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as never)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return deny(request, 401, 'not_authenticated');

  const role = user.app_metadata?.role ?? user.user_metadata?.role;
  if (!isSuperAdminRole(role)) return deny(request, 403, 'insufficient_role');

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
