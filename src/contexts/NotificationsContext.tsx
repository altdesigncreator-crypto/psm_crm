import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  writeBatch,
  Timestamp,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { type Lead } from '@/types';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'check-in' | 'appointment' | 'due-today' | 'overdue' | 'upcoming';
  agentName?: string;
  leadId?: string;
  name?: string;
  phone?: string;
  date?: string;
  timestamp?: Timestamp;
  isRead: boolean;
  source: 'collection' | 'computed';
  department?: string;
}

interface NotificationsContextType {
  notifications: Notification[];
  eventNotifications: Notification[];
  followUpNotifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

function getTodayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function compareDates(a: string, b: string) {
  return a.localeCompare(b);
}

function tsToMillis(ts: Timestamp | undefined): number {
  return ts ? ts.toMillis() : 0;
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [eventNotifications, setEventNotifications] = useState<Notification[]>([]);
  const [followUpNotifications, setFollowUpNotifications] = useState<Notification[]>([]);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const lastEventCountRef = useRef(0);
  const eventsInitializedRef = useRef(false);
  const leadsInitializedRef = useRef(false);

  // 1. Listen to unified notifications collection (check-ins + appointments)
  useEffect(() => {
    const q = query(
      collection(db, 'notifications'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data: Notification[] = snapshot.docs.map((d) => {
          const docData = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            title: (docData.title as string) || '',
            message: (docData.message as string) || '',
            type: (docData.type as Notification['type']) || 'appointment',
            agentName: (docData.agentName as string) || '',
            department: (docData.department as string) || undefined,
            timestamp: docData.timestamp as Timestamp | undefined,
            isRead: !!(docData.isRead as boolean),
            source: 'collection',
          };
        });

        // Toast for new unread events
        const unreadEvents = data.filter((n) => !n.isRead);
        if (eventsInitializedRef.current && unreadEvents.length > lastEventCountRef.current) {
          const newest = unreadEvents[0];
          if (newest) {
            const toastMsg =
              newest.type === 'check-in'
                ? 'ဆိုက်ရောက်ကြောင်း အသစ်တင်ပြခြင်း'
                : 'Lead အသစ်တင်ပြခြင်း';
            toast.info(toastMsg, { description: newest.message });
          }
        }
        lastEventCountRef.current = unreadEvents.length;
        eventsInitializedRef.current = true;

        setEventNotifications(data);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('Notifications listener error:', err);
      }
    );
    return () => unsub();
  }, []);

  // 2. Compute follow-up reminders from leads (real-time via onSnapshot)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'leads'),
      (snapshot) => {
        const leads = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Lead));
        const today = getTodayStr();
        const newNotifications: Notification[] = [];

        leads.forEach((lead) => {
          if (!lead.nextFollowUpDate) return;
          const followDate = lead.nextFollowUpDate;
          const cmp = compareDates(followDate, today);

          if (cmp === 0) {
            newNotifications.push({
              id: `due-${lead.id}`,
              title: 'Follow-up Reminder',
              message: `နောက်တစ်ကြိမ် ဆက်သွယ်ရမည့်ရက် - ယနေ့ (${followDate})`,
              type: 'due-today',
              leadId: lead.id,
              name: lead.name,
              phone: lead.phone,
              department: lead.department || undefined,
              date: followDate,
              isRead: false,
              source: 'computed',
            });
          } else if (cmp < 0) {
            newNotifications.push({
              id: `overdue-${lead.id}`,
              title: 'Follow-up Reminder',
              message: `နောက်တစ်ကြိမ် ဆက်သွယ်ရမည့်ရက် - ကျော်လွန်သွားပြီ (${followDate})`,
              type: 'overdue',
              leadId: lead.id,
              name: lead.name,
              phone: lead.phone,
              department: lead.department || undefined,
              date: followDate,
              isRead: false,
              source: 'computed',
            });
          } else {
            const fDate = new Date(followDate);
            const tDate = new Date(today);
            const diffMs = fDate.getTime() - tDate.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            if (diffDays <= 3) {
              newNotifications.push({
                id: `upcoming-${lead.id}`,
                title: 'Follow-up Reminder',
                message: `နောက်တစ်ကြိမ် ဆက်သွယ်ရမည့်ရက် - ရက်အနည်းငယ်အတွင်း (${followDate})`,
                type: 'upcoming',
                leadId: lead.id,
                name: lead.name,
                phone: lead.phone,
                department: lead.department || undefined,
                date: followDate,
                isRead: false,
                source: 'computed',
              });
            }
          }
        });

        // Show toast for new due/overdue follow-ups
        if (leadsInitializedRef.current) {
          newNotifications.forEach((n) => {
            if (!notifiedIdsRef.current.has(n.id) && (n.type === 'due-today' || n.type === 'overdue')) {
              notifiedIdsRef.current.add(n.id);
              if (n.type === 'overdue') {
                toast.error(n.message, { description: `${n.name} - ${n.phone}` });
              } else {
                toast.warning(n.message, { description: `${n.name} - ${n.phone}` });
              }
            }
          });
        }
        leadsInitializedRef.current = true;

        setFollowUpNotifications(newNotifications.sort((a, b) => compareDates(a.date || '', b.date || '')));
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('Leads listener error:', err);
      }
    );

    return () => unsub();
  }, []);

  const notifications = useMemo(() => {
    const merged = [...eventNotifications, ...followUpNotifications];
    return merged.sort((a, b) => {
      const aTime = a.timestamp ? a.timestamp.toMillis() : 0;
      const bTime = b.timestamp ? b.timestamp.toMillis() : 0;
      return bTime - aTime;
    });
  }, [eventNotifications, followUpNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const markAsRead = useCallback(async (id: string) => {
    const target = eventNotifications.find((n) => n.id === id);
    if (target && target.source === 'collection') {
      try {
        await updateDoc(doc(db, 'notifications', id), { isRead: true });
      } catch {
        // silently ignore write errors
      }
    }
    setEventNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setFollowUpNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }, [eventNotifications]);

  const markAllAsRead = useCallback(async () => {
    const unreadCollection = eventNotifications.filter((n) => !n.isRead);
    if (unreadCollection.length > 0) {
      const batch = writeBatch(db);
      unreadCollection.forEach((n) => {
        batch.update(doc(db, 'notifications', n.id), { isRead: true });
      });
      try {
        await batch.commit();
      } catch {
        // silently ignore batch errors
      }
    }
    setEventNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setFollowUpNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, [eventNotifications]);

  return (
    <NotificationsContext.Provider
      value={{ notifications, eventNotifications, followUpNotifications, unreadCount, markAsRead, markAllAsRead }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    return {
      notifications: [],
      eventNotifications: [],
      followUpNotifications: [],
      unreadCount: 0,
      markAsRead: () => {},
      markAllAsRead: () => {},
    };
  }
  return context;
}
