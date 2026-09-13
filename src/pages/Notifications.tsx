import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, type Notification } from '@/contexts/NotificationsContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Bell, ArrowLeft, Phone, CheckCircle2, Clock, CalendarDays,
  UserPlus, PartyPopper, ShieldAlert, Eye, Check, Inbox,
} from 'lucide-react';

const TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  new_lead_assigned: { bg: 'bg-primary/10', text: 'text-primary', icon: <UserPlus className="w-4 h-4" />, label: 'New Lead Assigned' },
  followup_reminder: { bg: 'bg-warning/10', text: 'text-warning', icon: <Clock className="w-4 h-4" />, label: 'Follow-up Reminder' },
  appointment_reminder: { bg: 'bg-info/10', text: 'text-info', icon: <CalendarDays className="w-4 h-4" />, label: 'Appointment Reminder' },
  site_visit_reminder: { bg: 'bg-info/10', text: 'text-info', icon: <CalendarDays className="w-4 h-4" />, label: 'Site Visit Reminder' },
  booking_confirmation: { bg: 'bg-success/10', text: 'text-success', icon: <PartyPopper className="w-4 h-4" />, label: 'Booking Confirmation' },
  warning_notification: { bg: 'bg-destructive/10', text: 'text-destructive', icon: <ShieldAlert className="w-4 h-4" />, label: 'Warning' },
};

function formatNotifDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dayGroupLabel(iso?: string): string {
  if (!iso) return 'Earlier';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  return 'Earlier';
}

export default function Notifications() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  usePageHeader('Notifications', 'Real-time updates from your team');

  // Notifications already arrive newest-first, so grouping while iterating
  // in order naturally clusters same-day items without a separate sort.
  const groups = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of notifications) {
      const label = dayGroupLabel(n.timestamp);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [notifications]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    notifications.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [notifications]);

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1 md:hidden">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Notifications</h1>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-10 gap-2 shrink-0 ml-auto" onClick={markAllAsRead}><CheckCircle2 className="w-4 h-4" /><span className="text-sm">Mark all read</span></Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <Card className="shadow-card rounded-xl border-0 overflow-hidden">
            <CardContent className="p-0">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-56 text-muted-foreground">
                  <Bell className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm font-medium">No notifications</p>
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.label}>
                    <div className="px-5 py-2.5 bg-muted/30 border-y border-border/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </div>
                    <div className="divide-y divide-border">
                      {group.items.map((n) => {
                        const style = TYPE_STYLES[n.type] || TYPE_STYLES.appointment_reminder;
                        return (
                          <div key={n.id} className={`relative flex items-start gap-3 p-4 min-h-[72px] transition-colors hover:bg-muted/40 ${!n.isRead ? 'bg-primary/5' : ''}`}>
                            {!n.isRead && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" aria-hidden="true" />}
                            <div className={`mt-0.5 w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}><span className={style.text}>{style.icon}</span></div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-sm font-semibold text-foreground truncate">{n.title || n.name}</p>
                                {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                              </div>
                              <p className="text-xs text-muted-foreground mb-1.5 line-clamp-2">{n.message}</p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                {n.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{n.phone}</span>}
                                <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3 h-3" />{n.timestamp ? formatNotifDate(n.timestamp) : n.date}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                              {n.leadId && (
                                <button type="button" onClick={() => { markAsRead(n.id); navigate(`/lead/${n.leadId}`); }} className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all" aria-label="View lead">
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                              {!n.isRead && (
                                <button type="button" onClick={() => markAsRead(n.id)} className="w-9 h-9 rounded-full bg-success/10 text-success flex items-center justify-center active:bg-success/20 active:scale-95 transition-all" aria-label="Mark as read">
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Inbox className="w-4 h-4 text-primary" /></div>
                <h3 className="text-sm font-semibold text-foreground">Overview</h3>
              </div>
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Unread</span>
                  <span className="font-semibold text-foreground tabular-nums">{unreadCount}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold text-foreground tabular-nums">{notifications.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {typeCounts.length > 0 && (
            <Card className="shadow-card rounded-xl border-0">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">By Type</h3>
                <div className="space-y-2">
                  {typeCounts.map(([type, count]) => {
                    const style = TYPE_STYLES[type] || TYPE_STYLES.appointment_reminder;
                    return (
                      <div key={type} className="flex items-center gap-2.5 text-sm">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${style.bg}`}><span className={`${style.text} [&>svg]:w-3.5 [&>svg]:h-3.5`}>{style.icon}</span></div>
                        <span className="flex-1 min-w-0 text-muted-foreground truncate">{style.label}</span>
                        <span className="font-semibold text-foreground tabular-nums">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
