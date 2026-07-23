import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { useNotifications, type Notification } from '@/contexts/NotificationsContext';
import { usePageHeaderValue } from '@/contexts/PageHeaderContext';
import { canAccessRoute, getRoleLabel, getDepartmentLabel, type RouteKey } from '@/lib/permissions';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import SystemBanner from '@/components/SystemBanner';
import {
  LayoutDashboard, UserPlus, Users, LogOut, Menu, Bell, Footprints, Image, Shield,
  Footprints as CheckInIcon, CalendarDays, BarChart3, Plus, Home, MapPin,
  Settings as SettingsIcon, BarChart3 as AnalyticsIcon, Thermometer, Kanban, Briefcase, ListChecks,
  Download,
  Activity as ActivityIcon,
  UsersRound,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavItem {
  /** Translation key — resolved through t() at render time. */
  tKey: string;
  path: string;
  routeKey: RouteKey;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const NAV_SECTIONS: { tKey: string; items: NavItem[] }[] = [
  {
    tKey: 'nav.section.core',
    items: [
      { tKey: 'nav.dashboard', path: '/dashboard', routeKey: 'dashboard', icon: LayoutDashboard },
      { tKey: 'nav.addLead', path: '/add-lead', routeKey: 'add-lead', icon: UserPlus },
      { tKey: 'nav.leads', path: '/leads', routeKey: 'leads', icon: Users },
      { tKey: 'nav.followUps', path: '/follow-ups', routeKey: 'follow-ups', icon: ListChecks },
      { tKey: 'nav.pipeline', path: '/pipeline', routeKey: 'pipeline', icon: Kanban },
      { tKey: 'nav.checkIn', path: '/check-in', routeKey: 'check-in', icon: Footprints },
      { tKey: 'nav.checkInGallery', path: '/check-in-gallery', routeKey: 'check-in-gallery', icon: Image },
      { tKey: 'nav.checkInMap', path: '/check-in-map', routeKey: 'check-in-map', icon: Thermometer },
    ],
  },
  {
    tKey: 'nav.section.staff',
    items: [
      { tKey: 'nav.teamActivity', path: '/team-activity', routeKey: 'team-activity', icon: ActivityIcon },
      { tKey: 'nav.kpiBoard', path: '/kpi-board', routeKey: 'kpi-board', icon: BarChart3 },
      { tKey: 'nav.staff', path: '/user-management', routeKey: 'user-management', icon: Briefcase },
      { tKey: 'nav.teamManagement', path: '/team-management', routeKey: 'team-management', icon: UsersRound },
    ],
  },
  {
    tKey: 'nav.section.admin',
    items: [
      { tKey: 'nav.roles', path: '/role-management', routeKey: 'role-management', icon: Shield },
      { tKey: 'nav.analytics', path: '/analytics', routeKey: 'analytics', icon: AnalyticsIcon },
      { tKey: 'nav.notifications', path: '/notifications', routeKey: 'notifications', icon: Bell },
      { tKey: 'nav.settings', path: '/settings', routeKey: 'settings', icon: SettingsIcon },
    ],
  },
];

const TAB_ITEMS = [
  { tKey: 'tab.dashboard', path: '/dashboard', icon: Home },
  { tKey: 'tab.leads', path: '/leads', icon: Users },
  { tKey: 'tab.add', path: '/add-lead', icon: Plus, isFab: true },
  { tKey: 'tab.checkin', path: '/check-in', icon: MapPin },
  { tKey: 'tab.gallery', path: '/check-in-gallery', icon: Image },
];

function initialsOf(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function formatNotifTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function NotificationItem({ n, onClick }: { n: Notification; onClick: () => void }) {
  const isCheckIn = n.type === 'checkin_reminder';
  const Icon = isCheckIn ? CheckInIcon : CalendarDays;
  const bgClass = isCheckIn ? 'bg-info/10 text-info' : 'bg-primary/10 text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${n.isRead ? 'hover:bg-muted/40' : 'bg-primary/5 hover:bg-primary/10'}`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bgClass}`}><Icon className="w-4 h-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground truncate">{n.title || n.name}</p>
        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
        <span className="text-[10px] text-muted-foreground mt-1 block">{formatNotifTime(n.timestamp)}</span>
      </div>
      {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
    </button>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, department, logout } = useAuth();
  const { t } = useTranslation();
  const { notifications, unreadCount, markAllAsRead } = useNotifications();
  const { canInstall, promptInstall } = usePwaInstall();
  const pageHeader = usePageHeaderValue();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop-only sidebar show/hide (mobile always uses the overlay Sheet
  // above instead) — remembered across sessions so it doesn't reset on
  // every reload.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('psm_sidebar_collapsed') === '1');
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('psm_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };
  // Separate open state per breakpoint: the mobile and desktop headers each
  // render their own Popover (only one is visible at a time via CSS, but
  // both stay mounted), so sharing one boolean made Radix position the
  // shared content against whichever trigger's rect it saw last — causing
  // it to flicker between the hidden trigger's (0,0) rect and the visible
  // one's real position.
  const [notifOpenMobile, setNotifOpenMobile] = useState(false);
  const [notifOpenDesktop, setNotifOpenDesktop] = useState(false);

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessRoute(role, item.routeKey)),
  })).filter((section) => section.items.length > 0);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
  };

  const handleOpenNotifs = (setOpen: (v: boolean) => void) => {
    setOpen(true);
    if (unreadCount > 0) markAllAsRead();
  };

  const renderNotifDropdown = (setOpen: (v: boolean) => void) => (
    <div className="w-80">
      <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-border">
        <p className="text-sm font-semibold text-foreground">Notifications</p>
        <button type="button" onClick={() => { setOpen(false); navigate('/notifications'); }} className="text-xs text-primary hover:underline">View all</button>
      </div>
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <Bell className="w-6 h-6 mb-1 opacity-40" /><p className="text-xs font-medium">No notifications</p>
        </div>
      ) : (
        <ScrollArea className="h-72">
          <div className="space-y-1 pr-2">
            {notifications.slice(0, 20).map((n) => (
              <NotificationItem key={n.id} n={n} onClick={() => { setOpen(false); navigate('/notifications'); }} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );

  // Sidebar is its own independently-scrolling column (ScrollArea below) so
  // scrolling the main content never scrolls the nav, and vice versa.
  const sidebarContent = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar-border shrink-0">
        <img src="/logo.png" alt="PSM Properties" className="h-10 w-auto dark:hidden" draggable={false} />
        <img src="/logo-dark.png" alt="PSM Properties" className="h-10 w-auto hidden dark:block" draggable={false} />
      </div>

      <ScrollArea className="flex-1 min-h-0 px-3 py-5">
        <div className="space-y-7 pb-4">
          {visibleSections.map((section) => (
            <div key={section.tKey}>
              <p className="px-4 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest mb-2.5">{t(section.tKey)}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 min-h-11 ${
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-foreground'
                          : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                      }`}
                    >
                      <div className="relative shrink-0">
                        <Icon
                          className={`w-[18px] h-[18px] transition-colors duration-150 ${isActive ? 'text-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'}`}
                          strokeWidth={isActive ? 2.25 : 2}
                        />
                        {item.path === '/notifications' && unreadCount > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-sidebar-background">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </div>
                      <span className="truncate">{t(item.tKey)}</span>
                      {isActive && <span className="ml-auto w-1 h-1 rounded-full bg-sidebar-primary shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="px-3 py-3 border-t border-sidebar-border space-y-1.5 shrink-0">
        {(() => {
          const avatar = user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.name} className="w-10 h-10 rounded-full object-cover shrink-0 ring-2 ring-sidebar-border" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-sidebar-accent text-sidebar-foreground text-sm font-semibold flex items-center justify-center shrink-0 ring-2 ring-sidebar-border">
              {user ? initialsOf(user.name) : ''}
            </div>
          );
          const details = (
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sidebar-foreground text-sm font-semibold truncate leading-snug">{user?.name}</p>
              {role && <p className="text-sidebar-foreground/50 text-xs truncate leading-snug mt-0.5">{department ? `${getDepartmentLabel(department)} · ` : ''}{getRoleLabel(role)}</p>}
            </div>
          );
          return user?.id ? (
            <Link
              to={`/profile/${user.id}`}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent transition-colors"
            >
              {avatar}
              {details}
            </Link>
          ) : (
            <div className="flex items-center gap-3 px-2 py-2">
              {avatar}
              {details}
            </div>
          );
        })()}
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent border border-sidebar-border h-11 rounded-lg px-4 font-medium"
          onClick={handleLogout}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
          <span className="text-sm">{t('nav.logout')}</span>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Desktop/tablet sidebar — full labels from md up, its own scroll region.
          Toggled by the hamburger button in the desktop top bar below. */}
      <aside className={`${sidebarCollapsed ? 'hidden' : 'hidden md:flex'} flex-col w-64 shrink-0 bg-sidebar border-r border-sidebar-border h-full overflow-hidden`}>
        {sidebarContent}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[280px] p-0 bg-sidebar border-r border-sidebar-border"
          closeClassName="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent/80"
        >
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Right column scrolls independently of the sidebar */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <header className="md:hidden flex items-center justify-between px-4 h-16 bg-card/95 backdrop-blur-sm shadow-sm border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-10 w-10 rounded-lg" onClick={() => setMobileOpen(true)}><Menu className="w-5 h-5" /></Button>
              </SheetTrigger>
            </Sheet>
            {/* Light/dark wordmark swap follows the app's class-based theme */}
            <img src="/logo.png" alt="PSM Properties" className="h-8 w-auto dark:hidden" draggable={false} />
            <img src="/logo-dark.png" alt="PSM Properties" className="h-8 w-auto hidden dark:block" draggable={false} />
          </div>
          <div className="flex items-center gap-1">
            {canInstall && (
              <Button variant="ghost" size="icon" className="h-10 w-10 text-primary rounded-lg" onClick={promptInstall} aria-label="Install app" title="Install app">
                <Download className="w-5 h-5" />
              </Button>
            )}
            <Popover open={notifOpenMobile} onOpenChange={setNotifOpenMobile}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-10 w-10 text-muted-foreground hover:text-foreground rounded-lg" onClick={() => handleOpenNotifs(setNotifOpenMobile)}>
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <>
                      <span className="absolute top-1 right-1 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-card">{unreadCount > 9 ? '9+' : unreadCount}</span>
                      <span className="absolute top-1 right-1 w-4 h-4 bg-destructive rounded-full animate-ping opacity-75" />
                    </>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="end">{renderNotifDropdown(setNotifOpenMobile)}</PopoverContent>
            </Popover>
          </div>
        </header>

        {/* Tablet/desktop top bar — hamburger to show/hide the sidebar, the
            current page's title (published via usePageHeader), and the
            notification bell */}
        <header className="hidden md:flex items-center justify-between gap-2 px-5 h-16 bg-card/80 backdrop-blur-sm border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0 rounded-lg"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              <Menu className="w-[18px] h-[18px]" />
            </Button>
            {pageHeader && (
              <>
                <span className="w-px h-6 bg-border shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <h1 className="text-[15px] font-semibold text-foreground truncate leading-tight tracking-tight">{pageHeader.title}</h1>
                  {pageHeader.subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{pageHeader.subtitle}</p>}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
          {canInstall && (
            <Button variant="outline" size="sm" className="h-9 gap-2 text-primary border-primary/25 hover:bg-primary/5 hover:border-primary/40 rounded-lg font-medium" onClick={promptInstall}>
              <Download className="w-3.5 h-3.5" /> Install App
            </Button>
          )}
          <Popover open={notifOpenDesktop} onOpenChange={setNotifOpenDesktop}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9 text-muted-foreground hover:text-foreground rounded-lg" onClick={() => handleOpenNotifs(setNotifOpenDesktop)}>
                <Bell className="w-[18px] h-[18px]" />
                {unreadCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-card">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="end">{renderNotifDropdown(setNotifOpenDesktop)}</PopoverContent>
          </Popover>
          </div>
        </header>

        <SystemBanner />

        <main className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 lg:p-8 pb-24 md:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile-only bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
        <div className="flex items-center justify-around px-2 pt-1">
          {TAB_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;

            if (item.isFab) {
              // Plus button goes straight to Add Lead — Check-In already has
              // its own tab immediately to the right, so no choice popup.
              return (
                <Link key={item.path} to={item.path} className="relative -mt-6">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center shadow-elevated transition-all duration-200 active:scale-90 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
                    <Plus className="w-6 h-6" strokeWidth={2.5} />
                  </div>
                </Link>
              );
            }

            return (
              <Link key={item.path} to={item.path} className={`flex flex-col items-center justify-center gap-0.5 py-2 px-3 min-w-[64px] min-h-[48px] rounded-xl transition-all duration-200 ${isActive ? 'bg-primary/5 scale-[1.02]' : 'active:bg-muted/50 active:scale-95'}`}>
                <div className={`relative p-1.5 rounded-lg transition-all duration-200 ${isActive ? 'bg-primary/10' : ''}`}>
                  <Icon className={`w-5 h-5 transition-colors duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={isActive ? 2.5 : 2} />
                  {isActive && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />}
                </div>
                <span className={`text-[10px] font-medium transition-colors duration-200 ${isActive ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>{t(item.tKey)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
