import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';

export interface NotificationRow {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  message: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
  action_path: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export async function fetchNotifications(): Promise<{ notifications: NotificationRow[]; error: Error | null }> {
  try {
    if (!supabaseConfigured) {
      return { notifications: [], error: null };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { notifications: (data ?? []) as NotificationRow[], error: null };
  } catch (error) {
    return { notifications: [], error: toBackendError(error, 'Load notifications') };
  }
}

export async function markNotificationRead(notificationId: string): Promise<{ success: boolean; error: Error | null }> {
  try {
    if (!supabaseConfigured) {
      return { success: true, error: null };
    }

    // RLS: notifications_manage_own ensures only the recipient can update their own rows.
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId);

    if (error) throw error;
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: toBackendError(error, 'Mark notification read') };
  }
}

// sendContributionAlert and sendAssignmentNotification have been removed.
// Notification dispatch must happen server-side (Edge Function or SECURITY DEFINER RPC)
// so that the notifications table is never written from the frontend.
// The record_physical_collection and assign_collector_validated RPCs
// already handle notification creation atomically on the backend.
