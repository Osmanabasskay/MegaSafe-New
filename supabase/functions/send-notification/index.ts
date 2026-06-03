/**
 * send-notification Edge Function
 *
 * Sends push notifications via Expo Push API.
 * Can be called internally by other edge functions (service_role token)
 * or triggered by the client for in-app notification creation only.
 *
 * Push token credentials are server-only.
 */

import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { createServiceClient, getAuthUser } from '../_shared/auth.ts';

interface NotificationPayload {
  user_id:   string;
  type:      string;
  title:     string;
  body:      string;
  data?:     Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Allow both service_role (internal) and authenticated users (own notifications only)
  const authHeader = req.headers.get('Authorization');
  const svc        = createServiceClient();
  let callerId: string | null = null;
  let isServiceRole = false;

  const token = authHeader?.replace('Bearer ', '');
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    isServiceRole = true;
  } else {
    const user = await getAuthUser(authHeader);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    callerId = user.id;
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Non-service-role callers can only send to themselves
  if (!isServiceRole && callerId && payload.user_id !== callerId) {
    return new Response(JSON.stringify({ error: 'Cannot send notifications to other users.' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate notification type whitelist
  const allowedTypes = [
    'collection_reminder', 'payment_received', 'group_invite', 'join_approved',
    'dispute_update', 'payout_scheduled', 'system_alert',
    // Monime payment events (sent by edge functions via service_role)
    'vault_topup_completed', 'payment_confirmed', 'withdrawal_approved',
  ];
  if (!allowedTypes.includes(payload.type)) {
    return new Response(JSON.stringify({ error: 'Invalid notification type.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Sanitize title and body (strip HTML, limit length)
  const safeTitle = sanitizeText(payload.title, 100);
  const safeBody  = sanitizeText(payload.body,  500);

  // 1. Persist notification in DB
  const { error: dbErr } = await svc.from('notifications').insert({
    recipient_id: payload.user_id,
    type:         payload.type,
    title:        safeTitle,
    body:         safeBody,
    data:         payload.data ?? null,
  });

  if (dbErr) {
    console.error('Failed to insert notification:', dbErr);
  }

  // 2. Look up Expo push token
  const { data: profile } = await svc
    .from('profiles')
    .select('expo_push_token, notification_enabled')
    .eq('id', payload.user_id)
    .maybeSingle();

  const pushToken = (profile as Record<string, unknown> | null)?.expo_push_token as string | null;
  const notifEnabled = (profile as Record<string, unknown> | null)?.notification_enabled !== false;

  if (pushToken && notifEnabled) {
    await sendExpoPush({ token: pushToken, title: safeTitle, body: safeBody, data: payload.data });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

async function sendExpoPush(params: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const resp = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      // Expo push API key (optional, server-side only)
      ...(Deno.env.get('EXPO_ACCESS_TOKEN')
        ? { 'Authorization': `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
        : {}),
    },
    body: JSON.stringify({
      to:    params.token,
      title: params.title,
      body:  params.body,
      data:  params.data ?? {},
      sound: 'default',
      badge: 1,
    }),
  });

  if (!resp.ok) {
    console.warn(`Expo push failed: ${resp.status}`, await resp.text());
  }
}

function sanitizeText(text: unknown, maxLen: number): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')   // strip HTML tags
    .replace(/[^\x20-\x7E -￿]/g, '') // remove control chars
    .slice(0, maxLen)
    .trim();
}
