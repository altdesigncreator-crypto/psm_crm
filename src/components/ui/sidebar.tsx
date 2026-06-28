// src/components/ui/sidebar.tsx

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { PanelLeft, LogOut, ChevronUp, User, Shield, Briefcase, LayoutDashboard, Settings, UserCheck } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { useIsMobile } from "../../hooks/use-mobile";
import { cn } from "../../lib/utils"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Separator } from "../../components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// IMPORT PERMISSION DEFINITIONS & PRESETS BASELINE
import { Permission, ROLE_PRESETS } from "@/config/permissions"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }
  return context
}

export const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }
>(({ defaultOpen = true, open: openProp, onOpenChange: setOpenProp, className, style, children, ...props }, ref) => {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open

  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((o) => !o) : setOpen((o) => !o)
  }, [isMobile, setOpen, setOpenMobile])

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === SIDEBAR_KEYBOARD_SHORTCUT && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // Explicit type assignment to satisfy type compatibility within the SidebarContext Provider interface
  const state: "expanded" | "collapsed" = open ? "expanded" : "collapsed"
  const contextValue = React.useMemo(() => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }), [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar])

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          style={{ "--sidebar-width": SIDEBAR_WIDTH, "--sidebar-width-icon": SIDEBAR_WIDTH_ICON, ...style } as React.CSSProperties}
          className={cn("group/sidebar-wrapper flex h-screen w-full overflow-hidden has-[[data-variant=inset]]:bg-sidebar", className)}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
})
SidebarProvider.displayName = "SidebarProvider"

export const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right"
    variant?: "sidebar" | "floating" | "inset"
    collapsible?: "offcanvas" | "icon" | "none"
  }
>(({ side = "left", variant = "sidebar", collapsible = "offcanvas", className, children, ...props }, ref) => {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div className={cn("flex h-screen w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground overflow-y-auto", className)} ref={ref} {...props}>
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent data-sidebar="sidebar" data-mobile="true" className="w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden" style={{ "--sidebar-width": SIDEBAR_WIDTH_MOBILE } as React.CSSProperties} side={side}>
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Mobile navigation drawer container.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col overflow-y-auto">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div ref={ref} className="group peer hidden text-sidebar-foreground md:block" data-state={state} data-collapsible={state === "collapsed" ? collapsible : ""} data-variant={variant} data-side={side}>
      <div className={cn("relative w-[--sidebar-width] bg-transparent transition-[width] duration-200 ease-linear", "group-data-[collapsible=offcanvas]:w-0", variant === "floating" || variant === "inset" ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]" : "group-data-[collapsible=icon]:w-[--sidebar-width-icon]")} />
      <div className={cn("fixed inset-y-0 z-10 hidden h-screen w-[--sidebar-width] transition-[left,right,width] duration-200 ease-linear md:flex", side === "left" ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]" : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]", variant === "floating" || variant === "inset" ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]" : "group-data-[collapsible=icon]:w-[--sidebar-width-icon] group-data-[side=left]:border-r", className)} {...props}>
        <div data-sidebar="sidebar" className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
})
Sidebar.displayName = "Sidebar"

// --- EXTENSION: USER ACCOUNT DRAWER WITH LIVE PRESETS MATRIX LOOKUP ---
export function SidebarUserAccount() {
  const { state } = useSidebar();
  const [user, setUser] = React.useState<{ name: string; email: string; role: string } | null>(null);

  React.useEffect(() => {
    try {
      const session = localStorage.getItem("psm_staff_session");
      if (session) {
        setUser(JSON.parse(session));
      }
    } catch (e) {
      console.error("Failed to parse user session parameters", e);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("psm_staff_session");
    window.location.href = "/login";
  };

  if (!user) return <div className="p-2"><Skeleton className="h-12 w-full rounded-lg" /></div>;

  const currentRoleConfig = ROLE_PRESETS[user.role.toLowerCase()] || { name: user.role, permissions: [] };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-sidebar-accent transition-colors duration-200 group-data-[state=collapsed]:justify-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              {state !== "collapsed" && (
                <div className="flex flex-1 flex-col min-w-0">
                  <span className="font-medium text-foreground truncate text-xs">{user.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate uppercase tracking-wider font-semibold">{currentRoleConfig.name}</span>
                </div>
              )}
              {state !== "collapsed" && <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-auto" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 mb-2">
            <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1">
              Logged in as <span className="font-medium text-foreground block truncate">{user.email}</span>
            </div>
            <DropdownMenuItem asChild>
              <Link to="/settings" className="cursor-pointer gap-2 flex items-center w-full">
                <User className="h-4 w-4" /> စနစ်ပြင်ဆင်မှုများ
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer gap-2 flex items-center w-full">
              <LogOut className="h-4 w-4" /> ထွက်ရန်
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// --- EXTENSION: POSITION NAVIGATION DESIGNED WITH SECURITY ACCESS OVERRIDES MATRIX ---
export interface NavigationItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermission: Permission;
}

export function SidebarNavigationLinks({ items }: { items: NavigationItem[] }) {
  const location = useLocation();
  const [userPermissions, setUserPermissions] = React.useState<Permission[]>([]);

  React.useEffect(() => {
    try {
      const session = localStorage.getItem("psm_staff_session");
      if (session) {
        const parsed = JSON.parse(session);
        // Fallback to role preset only if custom permissions array is empty or missing
        const rolePermissions = ROLE_PRESETS[parsed.role.toLowerCase()]?.permissions || [];
        setUserPermissions(parsed.permissions && parsed.permissions.length > 0 ? parsed.permissions : rolePermissions);
      }
    } catch (e) {
      console.error("Error reading security tokens for dynamic links layout", e);
    }
  }, [location.pathname]); // re-evaluate on navigation adjustments

  const visibleItems = items.filter(item => userPermissions.includes(item.requiredPermission));

  if (visibleItems.length === 0) return null;

  return (
    <SidebarMenu>
      {visibleItems.map((item) => {
        const isActive = location.pathname === item.path;
        const Icon = item.icon;
        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton isActive={isActive} asChild tooltip={item.name}>
              <Link to={item.path}>
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export const SidebarTrigger = React.forwardRef<React.ElementRef<typeof Button>, React.ComponentProps<typeof Button>>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar()
  return (
    <Button ref={ref} data-sidebar="trigger" variant="ghost" size="icon" className={cn("h-7 w-7", className)} onClick={(e) => { onClick?.(e); toggleSidebar() }} {...props}>
      <PanelLeft />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
})
SidebarTrigger.displayName = "SidebarTrigger"

export const SidebarRail = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(({ className, ...props }, ref) => {
  const { toggleSidebar } = useSidebar()
  return <button ref={ref} data-sidebar="rail" aria-label="Toggle Sidebar" tabIndex={-1} onClick={toggleSidebar} title="Toggle Sidebar" className={cn("absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 sm:flex", className)} {...props} />
})
SidebarRail.displayName = "SidebarRail"

export const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentProps<"main">>(({ className, ...props }, ref) => (
  <main ref={ref} className={cn("relative flex h-screen flex-1 flex-col bg-background overflow-y-auto", className)} {...props} />
))
SidebarInset.displayName = "SidebarInset"

export const SidebarInput = React.forwardRef<React.ElementRef<typeof Input>, React.ComponentProps<typeof Input>>(({ className, ...props }, ref) => (
  <Input ref={ref} data-sidebar="input" className={cn("h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", className)} {...props} />
))
SidebarInput.displayName = "SidebarInput"

export const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
  <div ref={ref} data-sidebar="header" className={cn("flex flex-col gap-2 p-2 shrink-0", className)} {...props} />
))
SidebarHeader.displayName = "SidebarHeader"

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
  <div ref={ref} data-sidebar="footer" className={cn("flex flex-col gap-2 p-2 shrink-0", className)} {...props} />
))
SidebarFooter.displayName = "SidebarFooter"

export const SidebarSeparator = React.forwardRef<React.ElementRef<typeof Separator>, React.ComponentProps<typeof Separator>>(({ className, ...props }, ref) => (
  <Separator ref={ref} data-sidebar="separator" className={cn("mx-2 w-auto bg-sidebar-border", className)} {...props} />
))
SidebarSeparator.displayName = "SidebarSeparator"

export const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
  <div ref={ref} data-sidebar="content" className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto group-data-[collapsible=icon]:overflow-hidden", className)} {...props} />
))
SidebarContent.displayName = "SidebarContent"

export const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
  <div ref={ref} data-sidebar="group" className={cn("relative flex w-full min-w-0 flex-col p-2", className)} {...props} />
))
SidebarGroup.displayName = "SidebarGroup"

export const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { asChild?: boolean }>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "div"
  return <Comp ref={ref} data-sidebar="group-label" className={cn("flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none", className)} {...props} />
})
SidebarGroupLabel.displayName = "SidebarGroupLabel"

export const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
  <div ref={ref} data-sidebar="group-content" className={cn("w-full text-sm", className)} {...props} />
))
SidebarGroupContent.displayName = "SidebarGroupContent"

export const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(({ className, ...props }, ref) => (
  <ul ref={ref} data-sidebar="menu" className={cn("flex w-full min-w-0 flex-col gap-1 list-none p-0 m-0", className)} {...props} />
))
SidebarMenu.displayName = "SidebarMenu"

export const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(({ className, ...props }, ref) => (
  <li ref={ref} data-sidebar="menu-item" className={cn("group/menu-item relative list-none", className)} {...props} />
))
SidebarMenuItem.displayName = "SidebarMenuItem"

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] disabled:pointer-events-none disabled:opacity-50 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-medium data-[active=true]:shadow-sm",
        outline: "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent",
      },
      size: {
        default: "h-9 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface SidebarMenuButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ asChild = false, isActive = false, variant = "default", size = "default", tooltip, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const { isMobile, state } = useSidebar()
    const button = (
      <Comp
        ref={ref}
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    )

    if (!tooltip) return button

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    )
  }
)
SidebarMenuButton.displayName = "SidebarMenuButton"

// --- EXPORTED LIVE READY-TO-USE APPLICATION SIDEBAR COMPONENT ---
export function AppSidebar() {
  const coreOperations: NavigationItem[] = [
    { name: "ဒက်ရှ်ဘုတ်", path: "/dashboard", icon: LayoutDashboard, requiredPermission: "view_dashboard" },
    { name: "Check-Ins မှတ်တမ်း", path: "/checkins", icon: UserCheck, requiredPermission: "view_check_in" },
  ];

  const staffManagement: NavigationItem[] = [
    { name: "ဝန်ထမ်းများ စီမံရန်", path: "/salestuffs", icon: Briefcase, requiredPermission: "manage_staff" },
  ];

  const systemControl: NavigationItem[] = [
    { name: "ရာထူးနှင့် လုပ်ပိုင်ခွင့်များ", path: "/role-management", icon: Shield, requiredPermission: "manage_settings" },
    { name: "စနစ် အထွေထွေပြင်ဆင်မှု", path: "/settings", icon: Settings, requiredPermission: "manage_settings" },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="font-bold text-sm px-3 py-3 text-primary tracking-wider border-b border-sidebar-border/50">
          PSM REAL ESTATE
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Core Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarNavigationLinks items={coreOperations} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Staff Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarNavigationLinks items={staffManagement} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Security & Controls</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarNavigationLinks items={systemControl} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/50 pt-2">
        <SidebarUserAccount />
      </SidebarFooter>
    </Sidebar>
  );
}