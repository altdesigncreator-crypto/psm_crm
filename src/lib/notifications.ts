import { getFCM, requestFCMToken } from './firebase';
import { toast } from 'sonner';

export interface PushAction {
  action: string;
  title: string;
}

export interface PushData {
  url?: string;
  leadId?: string;
  checkinId?: string;
  type?: string;
}

/**
 * Notification Permission + FCM Token Registration
 * Requests browser notification permission and registers FCM token.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    toast.info('ဤ browser သည် push notifications ကို အသုံးပြု၍မရပါ');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast.warning('အသိပေးချက်များကို လက်ခံရန် Permission လိုအပ်ပါသည်');
    return false;
  }
  const token = await requestFCMToken();
  if (token) {
    // Token would normally be sent to backend for storage
    console.log('[FCM] Token registered:', token.substring(0, 20) + '...');
  }
  return true;
}

/**
 * Show a local notification via the Service Worker.
 * Supports deep-link data and action buttons.
 */
export async function showLocalNotification(
  title: string,
  body: string,
  options?: NotificationOptions & { data?: PushData; actions?: PushAction[] }
): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    icon: '/logo.png',
    badge: '/favicon.png',
    tag: 'psm-crm',
    requireInteraction: false,
    ...options,
  });
}

/**
 * Check if notifications are supported and permitted.
 */
export function getNotificationStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
