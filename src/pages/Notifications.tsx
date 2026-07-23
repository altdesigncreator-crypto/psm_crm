import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/contexts/NotificationsContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bell, ArrowLeft, Phone, Calendar, AlertTriangle, CheckCircle2, Clock, CalendarDays,
  UserPlus, PartyPopper, ShieldAlert, Eye, Check,
} from 'lucide-react';

const TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  new_lead_assigned: { bg: 'bg-primary/10', text: 'text-primary', icon: <UserPlus className="w-4 h-4" /> },
  followup_reminder: { bg: 'bg-warning/10', text: 'text-warning', icon: <Clock className="w-4 h-4" /> },
  appointment_reminder: { bg: 'bg-info/10', text: 'text-info', icon: <CalendarDays className="w-4 h-4" /> },
  site_visit_reminder: { bg: 'bg-info/10', text: 'text-info', icon: <CalendarDays className="w-4 h-4" /> },
  booking_confirmation: { bg: 'bg-success/10', text: 'text-success', icon: <PartyPopper className="w-4 h-4" /> },
  warning_notification: { bg: 'bg-destructive/10', text: 'text-destructive', icon: <ShieldAlert className="w-4 h-4" /> },
  checkin_reminder: { bg: 'bg-info/10', text: 'text-info', icon: <Clock className="w-4 h-4" /> },
  'due-today': { bg: 'bg-warning/10', text: 'text-warning', icon: <Clock className="w-4 h-4" /> },
  overdue: { bg: 'bg-destructive/10', text: 'text-destructive', icon: <AlertTriangle className="w-4 h-4" /> },
  upcoming: { bg: 'bg-success/10', text: 'text-success', icon: <Calendar className="w-4 h-4" /> },
};

function formatNotifDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Notifications() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  usePageHeader('Notifications', 'Real-time updates and follow-up reminders');

  const overdue = notifications.filter((n) => n.type === 'overdue');
  const dueToday = notifications.filter((n) => n.type === 'due-today');
  const upcoming = notifications.filter((n) => n.type === 'upcoming');

  return (
    <div className="max-w-4xl mx-auto animate-fade-in-up space-y-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0 flex-1 md:hidden">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Notifications</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Real-time updates and follow-up reminders</p>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" className="h-10 gap-2 shrink-0" onClick={markAllAsRead}><CheckCircle2 className="w-4 h-4" /><span className="hidden sm:inline text-sm">Mark all read</span></Button>
          )}
        </div>
      </div>

      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
            <div><p className="text-2xl font-bold text-foreground tabular-nums">{overdue.length}</p><p className="text-xs text-muted-foreground">Overdue</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning/10 flex items-center justify-center shrink-0"><Clock className="w-5 h-5 text-warning" /></div>
            <div><p className="text-2xl font-bold text-foreground tabular-nums">{dueToday.length}</p><p className="text-xs text-muted-foreground">Due today</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><Calendar className="w-5 h-5 text-success" /></div>
            <div><p className="text-2xl font-bold text-foreground tabular-nums">{upcoming.length}</p><p className="text-xs text-muted-foreground">Upcoming</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <Bell className="w-4 h-4 text-muted-foreground/80" />
            All Notifications
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1 tabular-nums">{notifications.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="w-10 h-10 mb-2 opacity-30" /><p className="text-sm font-medium">No notifications</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="divide-y divide-border">
                {notifications.map((n) => {
                  const style = TYPE_STYLES[n.type] || TYPE_STYLES.appointment_reminder;
                  return (
                    <div key={n.id} className={`table-row-zebra flex items-start gap-3 p-4 min-h-[72px] transition-colors ${n.isRead ? '' : 'bg-primary/5'} hover:bg-muted/40`}>
                      <div className={`mt-0.5 w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}><span className={style.text}>{style.icon}</span></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-foreground truncate">{n.title || n.name}</p>
                          {!n.isRead && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />}
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
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
