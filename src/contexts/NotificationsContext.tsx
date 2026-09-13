import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { NotificationType } from '@/types';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  leadId?: string;
  name?: string;
  phone?: string;
  date?: string;
  timestamp?: string;
  isRead: boolean;
  source: 'db';
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [dbNotifications, setDbNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user?.id) { setDbNotifications([]); return; }
    let active = true;

    const load = async () => {
      const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
      if (!active) return;
      const mapped: Notification[] = (data || []).map((n: any) => ({
        id: n.id, title: n.title, message: n.body || '', type: n.type, leadId: n.related_lead_id || undefined,
        timestamp: n.created_at, isRead: n.is_read, source: 'db',
      }));
      setDbNotifications(mapped);
    };
    load();

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, (payload) => {
        const n = payload.new as any;
        toast.info(n.title, { description: n.body || undefined });
        load();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, () => load())
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  const notifications = useMemo(() => {
    return [...dbNotifications].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }, [dbNotifications]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setDbNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unread = dbNotifications.filter((n) => !n.isRead);
    if (unread.length > 0) await supabase.from('notifications').update({ is_read: true }).in('id', unread.map((n) => n.id));
    setDbNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, [dbNotifications]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    return { notifications: [], unreadCount: 0, markAsRead: () => {}, markAllAsRead: () => {} };
  }
  return context;
}
