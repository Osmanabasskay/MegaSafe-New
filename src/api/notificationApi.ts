/**
 * notificationApi — thin wrappers for notification operations.
 * Notification delivery is handled by the send-notification Edge Function.
 * Clients only read their own notifications.
 */

import { supabase, supabaseConfigured } from '../services/supabase';
import { toBackendError } from '../services/backendErrors';

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export async function fetchNotifications(
  limit = 50
): Promise<{ notifications: AppNotification[]; error: Error | null }> {
  if (!supabaseConfigured) return { notifications: [], error: null };

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id,user_id,title,body,type,is_read,created_at,metadata')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { notifications: (data ?? []) as AppNotification[], error: null };
  } catch (err) {
    return { notifications: [], error: toBackendError(err, 'Load notifications') };
  }
}

export async function markNotificationRead(
  notificationId: string
): Promise<{ error: Error | null }> {
  if (!supabaseConfigured) return { error: null };

  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: toBackendError(err, 'Mark notification read') };
  }
}

export async function markAllNotificationsRead(): Promise<{ error: Error | null }> {
  if (!supabaseConfigured) return { error: null };

  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false);

    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: toBackendError(err, 'Mark all read') };
  }
}

export async function getUnreadCount(): Promise<{ count: number; error: Error | null }> {
  if (!supabaseConfigured) return { count: 0, error: null };

  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) throw error;
    return { count: count ?? 0, error: null };
  } catch (err) {
    return { count: 0, error: toBackendError(err, 'Get unread count') };
  }
}
