import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Lead, NotificationType } from '@/types';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType | 'due-today' | 'overdue' | 'upcoming';
  leadId?: string;
  name?: string;
  phone?: string;
  date?: string;
  timestamp?: string;
  isRead: boolean;
  source: 'db' | 'computed';
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

function getTodayStr() { return new Date().toISOString().slice(0, 10); }

// Follow-up reminders (due-today/overdue/upcoming) aren't real rows — they're
// recomputed from leads.next_follow_up_at on every load and every realtime
// change, so there's nothing in the database to persist "read" against.
// Read state for them lives here instead, keyed per user so switching
// accounts on the same browser never leaks one person's read state into
// another's. IDs are type-prefixed (due-X/overdue-X/upcoming-X), so a lead
// that slides from "upcoming" to "overdue" correctly reappears as unread —
// that's a materially more urgent notification, not the same one.
function computedReadKey(userId: string) { return `psm_read_computed_notifs_${userId}`; }

function loadComputedReadIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(computedReadKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveComputedReadIds(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(computedReadKey(userId), JSON.stringify([...ids]));
  } catch {
    // Storage full/unavailable — read state just won't survive a refresh.
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [dbNotifications, setDbNotifications] = useState<Notification[]>([]);
  const [followUpNotifications, setFollowUpNotifications] = useState<Notification[]>([]);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const computedReadIdsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!user?.id) { setFollowUpNotifications([]); return; }
    computedReadIdsRef.current = loadComputedReadIds(user.id);
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('leads').select('id, name, phone, next_follow_up_at').not('next_follow_up_at', 'is', null);
      if (!active) return;
      const leads = (data || []) as Pick<Lead, 'id' | 'name' | 'phone' | 'next_follow_up_at'>[];
      const today = getTodayStr();
      const computed: Notification[] = [];
      const isRead = (id: string) => computedReadIdsRef.current.has(id);

      leads.forEach((lead) => {
        if (!lead.next_follow_up_at) return;
        const followDate = lead.next_follow_up_at.slice(0, 10);
        const cmp = followDate.localeCompare(today);

        if (cmp === 0) {
          const id = `due-${lead.id}`;
          computed.push({ id, title: 'Follow-up Reminder', message: `Follow-up due today (${followDate})`, type: 'due-today', leadId: lead.id, name: lead.name, phone: lead.phone, date: followDate, isRead: isRead(id), source: 'computed' });
        } else if (cmp < 0) {
          const id = `overdue-${lead.id}`;
          computed.push({ id, title: 'Follow-up Reminder', message: `Follow-up overdue (${followDate})`, type: 'overdue', leadId: lead.id, name: lead.name, phone: lead.phone, date: followDate, isRead: isRead(id), source: 'computed' });
        } else {
          const diffDays = (new Date(followDate).getTime() - new Date(today).getTime()) / 86400000;
          if (diffDays <= 3) {
            const id = `upcoming-${lead.id}`;
            computed.push({ id, title: 'Follow-up Reminder', message: `Follow-up coming up soon (${followDate})`, type: 'upcoming', leadId: lead.id, name: lead.name, phone: lead.phone, date: followDate, isRead: isRead(id), source: 'computed' });
          }
        }
      });

      if (initializedRef.current) {
        computed.forEach((n) => {
          if (!notifiedIdsRef.current.has(n.id) && (n.type === 'due-today' || n.type === 'overdue')) {
            notifiedIdsRef.current.add(n.id);
            if (n.type === 'overdue') toast.error(n.message, { description: `${n.name} · ${n.phone}` });
            else toast.warning(n.message, { description: `${n.name} · ${n.phone}` });
          }
        });
      }
      initializedRef.current = true;
      setFollowUpNotifications(computed.sort((a, b) => (a.date || '').localeCompare(b.date || '')));
    };
    load();
    const channel = supabase.channel('followup-reminders').on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load()).subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  const notifications = useMemo(() => {
    return [...dbNotifications, ...followUpNotifications].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }, [dbNotifications, followUpNotifications]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    const target = dbNotifications.find((n) => n.id === id);
    if (target) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    } else if (user?.id) {
      // Computed reminder — nothing in the DB to update, persist locally instead.
      computedReadIdsRef.current.add(id);
      saveComputedReadIds(user.id, computedReadIdsRef.current);
    }
    setDbNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setFollowUpNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }, [dbNotifications, user?.id]);

  const markAllAsRead = useCallback(async () => {
    const unread = dbNotifications.filter((n) => !n.isRead);
    if (unread.length > 0) await supabase.from('notifications').update({ is_read: true }).in('id', unread.map((n) => n.id));

    if (user?.id) {
      followUpNotifications.forEach((n) => { if (!n.isRead) computedReadIdsRef.current.add(n.id); });
      saveComputedReadIds(user.id, computedReadIdsRef.current);
    }

    setDbNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setFollowUpNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, [dbNotifications, followUpNotifications, user?.id]);

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
