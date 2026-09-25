import { supabase } from '@/db/supabase';
import type { NotificationType } from '@/types';

interface NotifyUserParams {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEnquiryId?: string;
  relatedLeadId?: string;
  url?: string;
}

/**
 * Fires an in-app notification row plus a real Web Push for one recipient.
 * Shared by every "X happened to your enquiry/lead" moment (assigned,
 * accepted, completed, ...) so each call site doesn't reimplement the same
 * two calls. Both legs are fire-and-forget: the in-app insert is RLS-
 * permitted for any authenticated client (notifications_insert policy is
 * `with check (true)`), and send-user-push is a best-effort Web Push that
 * silently no-ops for a recipient with no push subscription. Neither should
 * ever block or fail the action that triggered it — errors are logged, not
 * thrown.
 */
export function notifyUser({ recipientId, type, title, body, relatedEnquiryId, relatedLeadId, url }: NotifyUserParams) {
  supabase.from('notifications').insert({
    recipient_id: recipientId,
    type,
    title,
    body,
    related_enquiry_id: relatedEnquiryId,
    related_lead_id: relatedLeadId,
  }).then(({ error }) => {
    if (error) console.error('Failed to create notification:', error);
  });

  supabase.functions.invoke('send-user-push', {
    body: { user_id: recipientId, title, body, url: url || '/' },
  }).catch((err) => console.error('Failed to send push notification:', err));
}
