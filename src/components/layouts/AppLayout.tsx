import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications, type Notification } from '@/contexts/NotificationsContext';
import {
  isAdmin,
  isManagement,
  getRoleDisplayName,
  getDepartmentDisplayName,
} from '@/lib/roleUtils';
import { getPendingCounts, getAllPendingItems, type PendingQueueItem } from '@/lib/backgroundSync';
import { collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { flushStorageQueue } from '@/lib/offlineStorageQueue';
import { requestNotificationPermission } from '@/lib/notifications';
import SyncQueuePanel from '@/components/SyncQueuePanel';
import {
  LayoutDashboard,
  UserPlus,
  Users,
  LogOut,
  Menu,
  Bell,
  Footprints,
  Image,
  Shield,
  Footprints as CheckInIcon,
  CalendarDays,
  WifiOff,
  BarChart3,
  ScrollText,
  RefreshCw,
  Plus,
  X,
  Home,
  MapPin,
  FolderOpen,
  Mic,
  Settings as SettingsIcon,
  Cloud,
  Globe,
  BarChart3 as AnalyticsIcon,
  Thermometer,
  Kanban,
  Briefcase,
  UserCheck,
  TrendingUp,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/* ── Bottom Tab Config ─────────────────────────────────────────────────── */
const tabItems = [
  { name: 'Dashboard', path: '/dashboard', icon: Home },
  { name: 'Leads', path: '/leads', icon: FolderOpen },
  { name: 'Add', path: '/add-lead', icon: Plus, isFab: true },
  { name: 'Check-In', path: '/check-in', icon: MapPin },
  { name: 'Gallery', path: '/check-in-gallery', icon: Image },
];

function formatNotifTime(ts?: { toDate?: () => Date }) {
  if (!ts || !ts.toDate) return '';
  return ts.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function NotificationItem({ n, onClick }: { n: Notification; onClick: () => void }) {
  const isCheckIn = n.type === 'check-in';
  const Icon = isCheckIn ? CheckInIcon : CalendarDays;
  const bgClass = isCheckIn ? 'bg-info/10 text-info' : 'bg-primary/10 text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${
        n.isRead ? 'hover:bg-muted/40' : 'bg-primary/5 hover:bg-primary/10'
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bgClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground truncate">{n.title}</p>
        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{n.agentName}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{formatNotifTime(n.timestamp)}</span>
        </div>
      </div>
      {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
    </button>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, logout, isOffline } = useAuth();
  const { eventNotifications, unreadCount, markAllAsRead } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);

  /* ── Dynamic Permission Navigation Arrays ────────────────────────────── */
  const coreOperationsItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Add Lead', path: '/add-lead', icon: UserPlus },
    { name: 'Leads', path: '/leads', icon: Users },
    { name: 'Pipeline', path: '/pipeline', icon: Kanban },
    { name: 'Check-In', path: '/check-in', icon: Footprints },
    { name: 'Gallery', path: '/check-in-gallery', icon: Image },
  ];

  // Dynamic filter for General Tools (hides Check-In map from sales role context)
  const generalToolsItems = [
    ...(role !== 'sale' ? [{ name: 'Check-In Map', path: '/check-in-map', icon: Thermometer }] : []),
    { name: 'Voice Notes', path: '/voice-notes', icon: Mic },
    { name: 'Notifications', path: '/notifications', icon: Bell },
    { name: 'File Cloud', path: '/file-cloud', icon: Cloud },
  ];

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Logout click action failed:", error);
    }
  };

  const handleOpenNotifs = () => {
    setNotifOpen(true);
    if (unreadCount > 0) markAllAsRead();
  };

  // Poll pending sync queue
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const counts = await getPendingCounts();
        const total = counts.checkins + counts.leads + counts.audio_notes + (counts.files || 0);
        if (mounted) setPendingCount(total);
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Flush file uploads when online
  useEffect(() => {
    const handleOnline = () => flushStorageQueue().catch(() => {});
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // Request push notification permission once on login
  useEffect(() => {
    if (!user?.uid) return;
    const timer = setTimeout(() => {
      requestNotificationPermission().catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [user?.uid]);

  // Register periodic background sync for offline queue auto-flush
  useEffect(() => {
    if (!user?.uid) return;
    const timer = setTimeout(() => {
      import('@/lib/backgroundSync').then(({ requestPeriodicSync }) => {
        requestPeriodicSync(15).catch(() => {});
      });
    }, 8000);
    return () => clearTimeout(timer);
  }, [user?.uid]);

  // Follow-up reminder: poll leads daily and create notifications
  useEffect(() => {
    if (!user?.uid) return;
    const checkFollowUps = async () => {
      try {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const q = query(
          collection(db, 'leads'),
          where('nextFollowUpDate', '==', tomorrowStr),
          where('ownerId', '==', user.uid)
        );
        const snap = await getDocs(q);
        for (const docSnap of snap.docs) {
          const lead = docSnap.data() as Record<string, unknown>;
          const notifQuery = query(
            collection(db, 'notifications'),
            where('leadId', '==', docSnap.id),
            where('type', '==', 'follow-up-reminder'),
            where('timestamp', '>', Timestamp.fromDate(new Date(Date.now() - 86400000)))
          );
          const existing = await getDocs(notifQuery);
          if (existing.empty) {
            await addDoc(collection(db, 'notifications'), {
              title: 'Follow-up Reminder',
              message: `${lead.name || 'Lead'} — နက်ဖြန် (${tomorrowStr}) ဆက်သွယ်ရန်`,
              type: 'follow-up-reminder',
              leadId: docSnap.id,
              agentName: user?.email || 'Unknown',
              timestamp: Timestamp.now(),
              isRead: false,
            });
          }
        }
      } catch {
        // Silently ignore follow-up check errors
      }
    };
    checkFollowUps();
    const interval = setInterval(checkFollowUps, 3600000); // every 1 hour
    return () => clearInterval(interval);
  }, [user?.uid, user?.email]);

  const notifDropdown = (
    <div className="w-80">
      <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-border">
        <p className="text-sm font-semibold text-foreground">အသိပေးချက်များ</p>
        <button
          type="button"
          onClick={() => {
            setNotifOpen(false);
            navigate('/notifications');
          }}
          className="text-xs text-primary hover:underline"
        >
          အားလုံးကြည့်ရန်
        </button>
      </div>
      {eventNotifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <Bell className="w-6 h-6 mb-1 opacity-40" />
          <p className="text-xs font-medium">အသိပေးချက်မရှိပါ</p>
        </div>
      ) : (
        <ScrollArea className="h-72">
          <div className="space-y-1 pr-2">
            {eventNotifications.slice(0, 20).map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                onClick={() => {
                  setNotifOpen(false);
                  navigate('/notifications');
                }}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10 shrink-0">
        <div className="flex flex-col">
          <span className="text-white font-bold text-lg leading-tight tracking-tight">PSM</span>
          <span className="text-[#D4AF37] text-[10px] leading-tight tracking-wide font-medium">Properties</span>
        </div>
      </div>

      {/* Nav Content Containers */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-6 pb-4">
          
          {/* CATEGORY 1: Core Operations */}
          <div>
            <p className="px-4 text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">Core Operations</p>
            <div className="space-y-1">
              {coreOperationsItems.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                      isActive
                        ? 'bg-accent text-accent-foreground shadow-sm'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* CATEGORY 2: Staff Administration */}
          <div>
            <p className="px-4 text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">Staff Administration</p>
            <div className="space-y-1">
              <Link
                to="/kpi-board"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                  location.pathname === '/kpi-board' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <BarChart3 className="w-[18px] h-[18px]" strokeWidth={2} />
                <span>KPI Board</span>
              </Link>
              
              <Link
                to="/user-management"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                  location.pathname === '/user-management' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {role === 'sale' ? (
                  <>
                    <TrendingUp className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>KPI Analysis</span>
                  </>
                ) : (
                  <>
                    <Briefcase className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>ဝန်ထမ်းများ စီမံရန်</span>
                  </>
                )}
              </Link>
            </div>
          </div>

          {/* CATEGORY 3: Security & Controls */}
          <div>
            <p className="px-4 text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">Security & Controls</p>
            <div className="space-y-1">
              {/* 🔒 Role Guarded Elements: Hidden from sales role context */}
              {role !== 'sale' && (
                <>
                  <Link
                    to="/role-management"
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                      location.pathname === '/role-management' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Shield className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>ရာထူးနှင့် လုပ်ပိုင်ခွင့်များ</span>
                  </Link>

                  <Link
                    to="/audit-log"
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                      location.pathname === '/audit-log' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <ScrollText className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>Audit Log</span>
                  </Link>
                  
                  <Link
                    to="/analytics"
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                      location.pathname === '/analytics' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <AnalyticsIcon className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>Analytics</span>
                  </Link>
                  
                  <Link
                    to="/lead-map"
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                      location.pathname === '/lead-map' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Globe className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>Lead Map</span>
                  </Link>
                </>
              )}

              {/* General Allowed Shared Utilities */}
              {generalToolsItems.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                      isActive
                        ? 'bg-accent text-accent-foreground shadow-sm'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <div className="relative">
                      <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                      {item.path === '/notifications' && unreadCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-sidebar-background">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </div>
                    <span>{item.name}</span>
                  </Link>
                );
              })}

              <Link
                to="/settings"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-11 ${
                  location.pathname === '/settings'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <SettingsIcon className="w-[18px] h-[18px]" strokeWidth={2} />
                <span>အကောင့်ဆက်တင်များ</span>
              </Link>
            </div>
          </div>

        </div>
      </ScrollArea>

      {/* Footer System Controls */}
      <div className="px-3 py-4 border-t border-white/10 space-y-3 shrink-0 bg-gradient-to-t from-black/10 to-transparent">
        {pendingCount > 0 && (
          <div className="space-y-2">
            <p className="px-1 text-[10px] font-semibold text-white/40 uppercase tracking-wider">
              Offline Sync Queue
            </p>
            <SyncQueuePanel />
          </div>
        )}
        <div className="px-4 py-1">
          <p className="text-white/50 text-[10px] font-medium">Signed in as</p>
          <p className="text-white/90 text-sm font-medium truncate">{user?.email}</p>
          {role && (
            <p className="text-white/40 text-[10px] mt-0.5">
              {getDepartmentDisplayName(role)} · {getRoleDisplayName(role)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-white/70 hover:text-white hover:bg-white/10 border border-white/15 h-11 rounded-xl"
          onClick={handleLogout}
        >
          <LogOut className="w-[18px] h-[18px]" strokeWidth={2} />
          <span className="text-sm font-medium">Log Out</span>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 gradient-primary">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] p-0 gradient-primary border-none">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Status Banners */}
        {(isOffline || pendingCount > 0) && (
          <div
            className={`flex items-center justify-center gap-2 px-4 py-2.5 border-b text-xs font-medium ${
              isOffline
                ? 'bg-warning/10 border-warning/20 text-warning'
                : 'bg-info/10 border-info/20 text-info'
            }`}
          >
            {isOffline ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline Mode</span>
                {pendingCount > 0 && (
                  <span className="ml-1 opacity-80">· {pendingCount} ခု sync လုပ်ရန်</span>
                )}
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Sync လုပ်ရန် {pendingCount} ခု ကျန်</span>
              </>
            )}
          </div>
        )}

        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-card shadow-sm border-b border-border sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-foreground h-10 w-10"
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
            </Sheet>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-sm tracking-tight">PSM</span>
              <span className="text-[10px] text-primary-foreground/60 tracking-wide">Properties</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {pendingCount > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="relative text-info h-10 w-10"
                onClick={() => navigate('/leads')}
              >
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-info text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              </Button>
            )}
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-10 w-10" onClick={handleOpenNotifs}>
                  <Bell className="w-5 h-5 text-foreground" />
                  {unreadCount > 0 && (
                    <>
                      <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                      <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-destructive rounded-full animate-ping" />
                    </>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="end">
                {notifDropdown}
              </PopoverContent>
            </Popover>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto pb-24 lg:pb-6">
          {location.pathname === '/user-management' && role === 'sale' ? (
            /* 🚀 SAFETY FILTER OVERRIDE FOR SALES TEAM */
            <div className="space-y-6 max-w-4xl mx-auto animate-fade-in-up">
              <div>
                <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground">KPI Analysis</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Your personal performance metric review</p>
              </div>

              <Card className="shadow-sm border border-border/60 bg-card rounded-xl overflow-hidden">
                <CardHeader className="border-b border-border/40 bg-muted/10">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" /> Performance Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4">
                    <LayoutDashboard className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">လုပ်ဆောင်ချက် အချက်အလက်များ</h3>
                  <p className="text-sm text-muted-foreground max-w-md mt-1 mb-6">
                    အသေးစိတ်စွမ်းဆောင်ရည် KPI graphs များနှင့် analytics အချက်အလက်များကို ကြည့်ရှုရန် Dashboard စာမျက်နှာသို့ သွားရောက်ပါ။
                  </p>
                  <Button 
                    onClick={() => navigate('/dashboard')} 
                    className="gradient-primary hover:gradient-primary-hover text-white px-5 rounded-xl h-11 font-medium transition-all duration-200"
                  >
                    Go to Dashboard
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Default rendering pipeline for authenticated routing items */
            children
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
      >
        <div className="flex items-center justify-around px-2 pt-1">
          {tabItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;

            const handleNavClick = () => {
              if ('vibrate' in navigator) {
                navigator.vibrate(8);
              }
            };

            if (item.isFab) {
              return (
                <div key={item.path} className="relative -mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      if ('vibrate' in navigator) navigator.vibrate(12);
                      setFabOpen(!fabOpen);
                    }}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-elevated transition-all duration-200 active:scale-90 ${
                      fabOpen
                        ? 'bg-destructive text-white rotate-45'
                        : 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground'
                    }`}
                  >
                    <Plus className="w-6 h-6" strokeWidth={2.5} />
                  </button>
                </div>
              );
            }

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[64px] min-h-[48px] rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-primary/5 scale-[1.02]'
                    : 'active:bg-muted/50 active:scale-95'
                }`}
              >
                <div
                  className={`relative p-1.5 rounded-lg transition-all duration-200 ${
                    isActive ? 'bg-primary/10' : ''
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 transition-colors duration-200 ${
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    }`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {isActive && (
                    <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium transition-colors duration-200 ${
                    isActive ? 'text-primary font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  {item.name}
                </span>
              </Link>
            );
          })}
        </div>

        {/* FAB Expanded Menu */}
        {fabOpen && (
          <>
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-fade-in-up">
              <button
                type="button"
                onClick={() => {
                  setFabOpen(false);
                  navigate('/add-lead');
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-elevated whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" />
                <span>Lead အသစ်ထည့်ရန်</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFabOpen(false);
                  navigate('/check-in');
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-card text-foreground text-sm font-medium border border-border shadow-card whitespace-nowrap"
              >
                <MapPin className="w-4 h-4" />
                <span>Check-In လုပ်ရန်</span>
              </button>
            </div>
            <div
              className="fixed inset-0 bg-black/20 z-[-1]"
              onClick={() => setFabOpen(false)}
            />
          </>
        )}
      </nav>
    </div>
  );
}