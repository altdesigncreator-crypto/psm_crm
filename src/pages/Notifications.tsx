import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/contexts/NotificationsContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bell,
  ArrowLeft,
  User,
  Phone,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Footprints,
  CalendarDays,
  Filter,
  X,
  Eye,
  Check,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  'check-in': {
    bg: 'bg-info/10',
    text: 'text-info',
    border: 'border-info/20',
    icon: <Footprints className="w-4 h-4" />,
  },
  'appointment': {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    icon: <CalendarDays className="w-4 h-4" />,
  },
  'due-today': {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: <Clock className="w-4 h-4" />,
  },
  'overdue': {
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    border: 'border-destructive/20',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  'upcoming': {
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/20',
    icon: <Calendar className="w-4 h-4" />,
  },
};

function formatNotifDate(ts?: { toDate?: () => Date }) {
  if (!ts || !ts.toDate) return '';
  return ts.toDate().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Notifications() {
  const { eventNotifications, followUpNotifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  const [deptFilter, setDeptFilter] = useState('all');

  const filterByDept = (notifications: typeof eventNotifications) => {
    if (deptFilter === 'all') return notifications;
    return notifications.filter((n) => !n.department || n.department === deptFilter);
  };

  const filteredEvents = filterByDept(eventNotifications);
  const filteredFollowUps = filterByDept(followUpNotifications);

  const dueToday = filteredFollowUps.filter((n) => n.type === 'due-today');
  const overdue = filteredFollowUps.filter((n) => n.type === 'overdue');
  const upcoming = filteredFollowUps.filter((n) => n.type === 'upcoming');

  return (
    <div className="max-w-4xl mx-auto animate-fade-in-up space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">အသိပေးချက်များ</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Real-time အသိပေးချက်များ နှင့် Follow-up reminders</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-11 w-40 text-sm">
                <SelectValue placeholder="ဌာနအားလုံး" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ဌာနအားလုံး</SelectItem>
                <SelectItem value="house">အိမ်ရာ</SelectItem>
                <SelectItem value="condo">ကွန်ဒို</SelectItem>
                <SelectItem value="project">ပရောဂျက်</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" className="h-11 gap-2" onClick={markAllAsRead}>
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm">အားလုံးဖတ်ပြီးဟန်ပြင်ရန်</span>
            </Button>
          )}
        </div>
      </div>

      {/* Follow-up Summary Cards — horizontal scroll on mobile */}
      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory">
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{overdue.length}</p>
              <p className="text-xs text-muted-foreground">ကျော်လွန်သွားသည်</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{dueToday.length}</p>
              <p className="text-xs text-muted-foreground">ယနေ့ ဆက်သွယ်ရန်</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card rounded-xl border-0 min-w-[150px] md:min-w-0 snap-start flex-1">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{upcoming.length}</p>
              <p className="text-xs text-muted-foreground">ရက်အနည်းငယ်အတွင်း</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Real-Time Events Section */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bell className="w-4 h-4 text-primary" />
            </div>
            Real-Time အသိပေးချက်များ
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">အသိပေးချက်များ မရှိပါ</p>
              <p className="text-xs mt-1">Check-in နှင့် Lead အသစ်များ ထည့်သွင်းရပါမည်</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="divide-y divide-border">
                {filteredEvents.map((n) => {
                  const style = TYPE_STYLES[n.type] || TYPE_STYLES['appointment'];
                  return (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 p-4 min-h-[72px] transition-colors ${
                        n.isRead ? 'bg-transparent' : 'bg-primary/5'
                      } hover:bg-muted/40`}
                    >
                      <div className={`mt-0.5 w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}>
                        <span className={style.text}>{style.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-foreground truncate">{n.title}</p>
                          {!n.isRead && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mb-1.5 line-clamp-2">{n.message}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {n.agentName}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatNotifDate(n.timestamp)}
                          </span>
                        </div>
                      </div>
                      {/* Mobile swipe-like action buttons */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {!n.isRead && (
                          <button
                            type="button"
                            onClick={() => markAsRead(n.id)}
                            className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all"
                            aria-label="ဖတ်ပြီးဟန်ပြင်ရန်"
                          >
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

      {/* Follow-up Reminders List */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-primary" />
            </div>
            Follow-up စာရင်း
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredFollowUps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">Follow-up အသိပေးချက်များ မရှိပါ</p>
              <p className="text-xs mt-1">လက်ရှိ Follow-up ရက်များ အားလုံး ပြည့်စုံသွားပါပြီ</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredFollowUps.map((n) => {
                const style = TYPE_STYLES[n.type];
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 p-4 min-h-[72px] transition-colors ${
                      n.isRead ? 'bg-transparent' : 'bg-primary/5'
                    } hover:bg-muted/40`}
                  >
                    <div className={`mt-0.5 w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}>
                      <span className={style.text}>{style.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-foreground truncate">{n.name}</p>
                        {!n.isRead && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mb-1.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {n.phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {n.date}
                        </span>
                      </div>
                    </div>
                    {/* Mobile action buttons */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {n.leadId && (
                        <button
                          type="button"
                          onClick={() => {
                            markAsRead(n.id);
                            navigate(`/lead/${n.leadId}`);
                          }}
                          className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center active:bg-primary/20 active:scale-95 transition-all"
                          aria-label="Lead ကြည့်ရန်"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {!n.isRead && (
                        <button
                          type="button"
                          onClick={() => markAsRead(n.id)}
                          className="w-9 h-9 rounded-full bg-success/10 text-success flex items-center justify-center active:bg-success/20 active:scale-95 transition-all"
                          aria-label="ဖတ်ပြီးဟန်ပြင်ရန်"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
