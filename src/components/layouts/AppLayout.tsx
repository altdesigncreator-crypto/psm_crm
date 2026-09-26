import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { useNotifications, type Notification } from '@/contexts/NotificationsContext';
import { usePageHeaderValue } from '@/contexts/PageHeaderContext';
import { canAccessRoute, getRoleLabel, getDepartmentLabel, type RouteKey } from '@/lib/permissions';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import SystemBanner from '@/components/SystemBanner';
import StorageImage from '@/components/StorageImage';
import UpdateDot from '@/components/UpdateDot';
import { useAppUpdate } from '@/lib/appUpdate';
import {
  LayoutDashboard, UserPlus, Users, LogOut, Menu, Bell, Shield,
  CalendarDays, BarChart3, Home,
  Settings as SettingsIcon, BarChart3 as AnalyticsIcon, Kanban, Briefcase, ListChecks,
  Download,
  Activity as ActivityIcon,
  UsersRound,
  Map as MapIcon,
  Sun, Moon, ChevronDown, UserCircle,
  Inbox,
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import PsmMapFrame from '@/components/PsmMapFrame';

interface NavItem {
  /** Translation key — resolved through t() at render time. */
  tKey: string;
  path: string;
  routeKey: RouteKey;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

/** Rendered on its own above the grouped sections, not inside
 * "Core Operations" — every authenticated tier lands here first. */
const DASHBOARD_NAV_ITEM: NavItem = { tKey: 'nav.dashboard', path: '/dashboard', routeKey: 'dashboard', icon: LayoutDashboard };

/** Rendered on its own below the grouped sections — every role can reach
 * their own profile/preferences here, so it doesn't belong inside the
 * exec-only "Administration" section (which would hide it under a heading
 * that reads oddly for non-exec roles). */
const SETTINGS_NAV_ITEM: NavItem = { tKey: 'nav.settings', path: '/settings', routeKey: 'settings', icon: SettingsIcon };

const NAV_SECTIONS: { tKey: string; items: NavItem[] }[] = [
  {
    tKey: 'nav.section.core',
    items: [
      { tKey: 'nav.enquiries', path: '/enquiries', routeKey: 'enquiries', icon: Inbox },
      { tKey: 'nav.addLead', path: '/add-lead', routeKey: 'add-lead', icon: UserPlus },
      { tKey: 'nav.leads', path: '/leads', routeKey: 'leads', icon: Users },
      { tKey: 'nav.followUps', path: '/follow-ups', routeKey: 'follow-ups', icon: ListChecks },
      { tKey: 'nav.pipeline', path: '/pipeline', routeKey: 'pipeline', icon: Kanban },
      { tKey: 'nav.psmMap', path: '/psm-map', routeKey: 'psm-map', icon: MapIcon },
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
    // Notifications stay out of the sidebar — it lives in the top bar's
    // bell popover instead, so this section stays focused on exec-only
    // tools. Settings has its own standalone entry below (every role can
    // reach it, so it doesn't belong under this exec-only heading).
    tKey: 'nav.section.admin',
    items: [
      { tKey: 'nav.roles', path: '/role-management', routeKey: 'role-management', icon: Shield },
      { tKey: 'nav.analytics', path: '/analytics', routeKey: 'analytics', icon: AnalyticsIcon },
    ],
  },
];

const TAB_ITEMS = [
  { tKey: 'tab.dashboard', path: '/dashboard', icon: Home },
  { tKey: 'tab.leads', path: '/leads', icon: Users },
  { tKey: 'tab.enquiries', path: '/enquiries', icon: Inbox, isFab: true },
  { tKey: 'tab.followUps', path: '/follow-ups', icon: ListChecks },
  { tKey: 'tab.map', path: '/psm-map', icon: MapIcon },
];

function initialsOf(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function formatNotifTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function NotificationItem({ n, onClick }: { n: Notification; onClick: () => void }) {
  const Icon = CalendarDays;
  const bgClass = 'bg-primary/10 text-primary';
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
  const { t, lang } = useTranslation();
  const { notifications, unreadCount, markAllAsRead } = useNotifications();
  const { canInstall, promptInstall } = usePwaInstall();
  const { updateAvailable } = useAppUpdate();
  const pageHeader = usePageHeaderValue();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('psm_sidebar_collapsed') === '1');
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('psm_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };
  const [notifOpenMobile, setNotifOpenMobile] = useState(false);
  const [notifOpenDesktop, setNotifOpenDesktop] = useState(false);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('theme', next ? 'dark' : 'light');
      return next;
    });
  };

  const renderNavLink = (item: NavItem) => {
    const isActive = location.pathname === item.path;
    const Icon = item.icon;
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={() => setMobileOpen(false)}
        className={`group relative flex items-center gap-3 pl-3 pr-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 min-h-11 ${
          isActive
            ? 'bg-gradient-to-r from-primary/15 to-primary/[0.02] text-sidebar-foreground'
            : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground hover:translate-x-0.5'
        }`}
      >
        {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" aria-hidden="true" />}
        <div className={`relative shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-200 ${isActive ? 'bg-primary/15' : 'group-hover:bg-sidebar-accent'}`}>
          <Icon
            className={`w-[18px] h-[18px] transition-colors duration-150 ${isActive ? 'text-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'}`}
            strokeWidth={isActive ? 2.25 : 2}
          />
          {item.path === '/settings' && <UpdateDot className="absolute -top-0.5 -right-0.5" />}
          {item.path === '/notifications' && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-sidebar-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        <span className="truncate">{t(item.tKey)}</span>
      </Link>
    );
  };

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

  const sidebarContent = (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Faint depth wash — purely decorative, keeps the sidebar from
          reading as one flat block of color without being loud about it. */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.03] via-transparent to-transparent pointer-events-none" />

      {/* min-h + pt-safe (not a fixed h-16) since this same header renders
          inside the mobile Sheet drawer too, which spans full screen height
          on iOS — without reserving space for the notch/Dynamic Island, its
          content just sits at the true top of the screen and gets covered.
          A no-op on desktop/non-notched devices (pt-safe floors at 0.5rem). */}
      <div className="flex flex-col items-start gap-0.5 px-5 min-h-16 pt-safe justify-center border-b border-sidebar-border shrink-0 relative">
        <img src="/logo.png" alt="PSM Properties" className="h-9 w-auto shrink-0 dark:hidden" draggable={false} />
        <img src="/logo-dark.png" alt="PSM Properties" className="h-9 w-auto shrink-0 hidden dark:block" draggable={false} />
        <p className="w-full text-[10.5px] text-sidebar-foreground/45 font-medium tracking-wide truncate">{t('app.tagline')}</p>
      </div>

      <ScrollArea className="flex-1 min-h-0 px-3 py-5 relative">
        <div className="space-y-7 pb-4">
          <div className="space-y-0.5">{renderNavLink(DASHBOARD_NAV_ITEM)}</div>
          {visibleSections.map((section) => (
            <div key={section.tKey}>
              <p className="px-4 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest mb-2.5">{t(section.tKey)}</p>
              <div className="space-y-0.5">{section.items.map((item) => renderNavLink(item))}</div>
            </div>
          ))}
          <div className="space-y-0.5">{renderNavLink(SETTINGS_NAV_ITEM)}</div>
        </div>
      </ScrollArea>

      <div className="px-3 py-3 border-t border-sidebar-border shrink-0 relative">
        <div className="rounded-xl bg-sidebar-accent/40 p-1.5 space-y-1">
          {(() => {
            const avatar = user?.avatar_url ? (
              <StorageImage src={user.avatar_url} alt={user.name} className="w-10 h-10 rounded-full object-cover shrink-0 ring-2 ring-sidebar-border" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-sidebar-foreground text-sm font-semibold flex items-center justify-center shrink-0 ring-2 ring-sidebar-border">
                {user ? initialsOf(user.name) : ''}
              </div>
            );
            const details = (
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sidebar-foreground text-sm font-semibold truncate leading-snug">{user?.name}</p>
                {role && <p className="text-sidebar-foreground/50 text-xs truncate leading-snug mt-0.5">{department ? `${getDepartmentLabel(department)} · ` : ''}{getRoleLabel(role, lang)}</p>}
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
            className="w-full justify-start gap-3 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent h-10 rounded-lg px-2.5 font-medium"
            onClick={handleLogout}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
            <span className="text-sm">{t('nav.logout')}</span>
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh w-full bg-background overflow-hidden">
      {/* Desktop/tablet sidebar — full labels from md up, its own scroll region.
          Toggled by the hamburger button in the desktop top bar below. */}
      <aside className={`${sidebarCollapsed ? 'hidden' : 'hidden md:flex'} flex-col w-64 shrink-0 bg-sidebar border-r border-sidebar-border h-full overflow-hidden`}>
        {sidebarContent}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[280px] p-0 bg-sidebar border-r border-sidebar-border"
          closeClassName="top-[max(0.5rem,env(safe-area-inset-top))] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent/80"
        >
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Right column scrolls independently of the sidebar */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* min-h + pt-safe (not a fixed h-16): on iOS with the notch/Dynamic
            Island, content starting at the true top of the screen renders
            underneath it — this pushes the hamburger/logo/bell row down
            below the unsafe area instead. No visible change on desktop or
            non-notched devices, since pt-safe floors at 0.5rem there. */}
        <header className="md:hidden flex items-center justify-between px-4 min-h-16 pt-safe bg-card/95 backdrop-blur-sm shadow-sm border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost" size="icon"
                  className="relative text-muted-foreground hover:text-foreground h-10 w-10 rounded-lg"
                  onClick={() => setMobileOpen(true)}
                  aria-label={updateAvailable ? `Menu — ${t('update.availableTitle')}` : 'Menu'}
                >
                  <Menu className="w-5 h-5" />
                  {/* Settings lives in this drawer on mobile, so the dot has to surface here. */}
                  <UpdateDot className="absolute top-1.5 right-1.5" />
                </Button>
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
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-lg" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
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
            {pageHeader && location.pathname !== '/dashboard' && (
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
          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground rounded-lg" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
            {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </Button>
          <Popover open={notifOpenDesktop} onOpenChange={setNotifOpenDesktop}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9 text-muted-foreground hover:text-foreground rounded-lg" onClick={() => handleOpenNotifs(setNotifOpenDesktop)}>
                <Bell className="w-[18px] h-[18px]" />
                {unreadCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-card">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="end">{renderNotifDropdown(setNotifOpenDesktop)}</PopoverContent>
          </Popover>
          <span className="w-px h-6 bg-border shrink-0 mx-0.5" aria-hidden="true" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-muted/60 transition-colors">
                <span className="relative shrink-0">
                  {user?.avatar_url ? (
                    <StorageImage src={user.avatar_url} alt={user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-foreground text-xs font-semibold flex items-center justify-center shrink-0">
                      {user ? initialsOf(user.name) : ''}
                    </div>
                  )}
                  {/* Reachable path to Settings even with the sidebar collapsed. */}
                  <UpdateDot className="absolute -top-0.5 -right-0.5" />
                </span>
                <div className="hidden xl:block min-w-0 text-left">
                  <p className="text-sm font-semibold text-foreground truncate leading-tight max-w-[10rem]">{user?.name}</p>
                  {role && <p className="text-[11px] text-muted-foreground truncate leading-tight">{getRoleLabel(role, lang)}</p>}
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl shadow-lg border-border p-1">
              {user?.id && (
                <DropdownMenuItem className="gap-2.5 rounded-lg px-3 py-2.5 text-sm cursor-pointer" onClick={() => navigate(`/profile/${user.id}`)}>
                  <UserCircle className="w-4 h-4 shrink-0" /> {t('nav.profile')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="gap-2.5 rounded-lg px-3 py-2.5 text-sm cursor-pointer" onClick={() => navigate('/settings')}>
                <SettingsIcon className="w-4 h-4 shrink-0" /> {t('nav.settings')}
                {updateAvailable && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" aria-label={t('update.availableTitle')} />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2.5 rounded-lg px-3 py-2.5 text-sm cursor-pointer text-destructive focus:text-destructive" onClick={handleLogout}>
                <LogOut className="w-4 h-4 shrink-0" /> {t('nav.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        <SystemBanner />

        <div className="relative flex-1 min-h-0">
          <main className="h-full overflow-y-auto p-4 md:p-6 lg:p-8 pb-24 md:pb-6">
            {children}
          </main>
          {/* Kept alive across navigation instead of unmounting with the
              route — see PsmMapFrame for why. Overlays main full-bleed
              (ignoring its padding) only while /psm-map is the active route. */}
          <PsmMapFrame />
        </div>
      </div>

      {/* Mobile-only bottom nav — a Material-3-style floating bar: every tab
          keeps its label visible (not just the active one), the active
          icon sits inside a soft brand-colored pill that's a single shared
          element (motion's layoutId) so it slides between tabs instead of
          popping in fresh each time, and Add is a raised gold FAB that
          pops up out of the bar's own surface rather than living beside
          or being notched into it. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }}
      >
        <div className="relative flex items-stretch justify-between bg-card/95 backdrop-blur-xl border border-border/60 rounded-[28px] shadow-elevated px-1.5 pt-2 pb-1.5">
          {TAB_ITEMS.map((item) => {
            if (item.isFab) {
              const FabIcon = item.icon;
              return (
                <div key={item.path} className="flex-1 flex justify-center">
                  <Link
                    to={item.path}
                    aria-label={t(item.tKey)}
                    className="group relative -mt-7 w-14 h-14 rounded-full flex items-center justify-center bg-[#0A243E] shadow-elevated ring-[5px] ring-background transition-transform duration-200 ease-out active:scale-90"
                  >
                    {/* Inbox icon isn't rotationally symmetric like the old
                        "+" was, so a quarter-turn on press reads as real tap
                        feedback instead of nothing — springs back on release. */}
                    <FabIcon
                      className="w-6 h-6 text-white transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group-active:rotate-90"
                      strokeWidth={2.5}
                    />
                  </Link>
                </div>
              );
            }

            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link key={item.path} to={item.path} className="flex-1 flex flex-col items-center justify-center gap-1 py-1">
                <span className="relative flex items-center justify-center w-12 h-7">
                  {isActive && (
                    <motion.span
                      layoutId="navPill"
                      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                      className="absolute inset-0 bg-primary/10 rounded-full"
                    />
                  )}
                  <Icon
                    className={`relative w-[19px] h-[19px] transition-colors duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground/55'}`}
                    strokeWidth={isActive ? 2.3 : 1.8}
                  />
                </span>
                <span className={`text-[10.5px] leading-none transition-colors duration-200 ${isActive ? 'text-primary font-semibold' : 'text-muted-foreground/55 font-medium'}`}>
                  {t(item.tKey)}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
