/**
 * Single source of truth for the CRM's role/department model.
 *
 * Replaces the old roleUtils.ts (department_level string roles) and the
 * dead config/permissions.ts (RoleManagement's disconnected CRUD system).
 * Mirrors the RLS policies in database/crm.sql — this file is the client
 * side's *UX* layer (hide/disable things, route-guard navigation); the
 * database is the real security boundary.
 */

import { getDepartmentLabel as lookupDepartmentLabel } from '@/lib/departments';

export type RoleTier = 'boss' | 'super_admin' | 'admin' | 'manager' | 'sale';
/** Departments are dynamic data (public.departments table), not a fixed set
 * — see src/hooks/useDepartments.ts. This alias just keeps existing type
 * annotations meaningful. */
export type Department = string;

export const ROLE_TIERS: RoleTier[] = ['boss', 'super_admin', 'admin', 'manager', 'sale'];

export const ROLE_LABELS: Record<RoleTier, string> = {
  boss: 'Boss',
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  sale: 'Sales Person',
};

export interface CurrentUser {
  id: string;
  role: RoleTier | null;
  department: Department | null;
}

export function isExec(role: RoleTier | null | undefined): boolean {
  return role === 'boss' || role === 'super_admin';
}

export function isAdminOrAbove(role: RoleTier | null | undefined): boolean {
  return role === 'boss' || role === 'super_admin' || role === 'admin';
}

export function isManagerOrAbove(role: RoleTier | null | undefined): boolean {
  return isAdminOrAbove(role) || role === 'manager';
}

export function isManager(role: RoleTier | null | undefined): boolean {
  return role === 'manager';
}

export function isSale(role: RoleTier | null | undefined): boolean {
  return role === 'sale';
}

/** Department-scoped roles (admin/manager/sale) only see their own
 * department's data — only Boss/Super Admin are global. */
export function isDepartmentScoped(role: RoleTier | null | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'sale';
}

interface LeadRecord {
  ownerId?: string | null;
  departmentCode?: string | null;
}

/** Mirrors the `leads_select` RLS policy in database/crm.sql. */
export function canViewLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin' || user.role === 'manager') return lead.departmentCode === user.department;
  return lead.ownerId === user.id;
}

/** Mirrors the `leads_update` RLS policy — Admin edits any lead in their own
 * department; the "manager loses edit rights after handing a lead off"
 * business rule lives here and in the database. */
export function canEditLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return lead.departmentCode === user.department;
  if (user.role === 'manager') return lead.departmentCode === user.department && lead.ownerId === user.id;
  return lead.ownerId === user.id;
}

export function canDeleteLead(user: CurrentUser | null): boolean {
  return isExec(user?.role);
}

export function canAssignLead(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user?.role);
}

/** Admins and managers can view/monitor + warn/reassign leads in their own
 * department, even ones they don't own. */
export function canMonitorLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin' || user.role === 'manager') return lead.departmentCode === user.department;
  return lead.ownerId === user.id;
}

export function canAddFollowUp(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return lead.departmentCode === user.department;
  // Managers are deliberately excluded — FRD: Follow-up = "View Only" for Manager.
  return lead.ownerId === user.id;
}

export function canIssueWarning(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user?.role);
}

/** Mirrors the `warnings_insert` RLS policy for a general (not lead-tied)
 * staff warning — e.g. Admin warning a Manager directly from the Staff
 * page, rather than through a specific lead's follow-up trail. */
export function canWarnStaff(user: CurrentUser | null, target: { departmentCode?: string | null }): boolean {
  if (!user) return false;
  if (isAdminOrAbove(user.role)) return true;
  if (user.role === 'manager') return target.departmentCode === user.department;
  return false;
}

/** Route names as used in src/routes.tsx / nav config. */
export type RouteKey =
  | 'dashboard' | 'add-lead' | 'leads' | 'lead-detail' | 'pipeline' | 'follow-ups'
  | 'check-in' | 'check-in-gallery' | 'check-in-map'
  | 'notifications' | 'settings'
  | 'user-management' | 'role-management'
  | 'kpi-board' | 'agent-detail' | 'analytics' | 'team-activity';

/** Central route-level access map — the piece that was completely missing
 * before (routes.tsx only checked "is logged in", never role). */
export function canAccessRoute(role: RoleTier | null | undefined, routeKey: RouteKey): boolean {
  if (!role) return false;

  switch (routeKey) {
    case 'dashboard':
    case 'add-lead':
    case 'leads':
    case 'lead-detail':
    case 'pipeline':
    case 'follow-ups':
    case 'check-in':
    case 'check-in-gallery':
    case 'check-in-map':
    case 'notifications':
      return true; // every authenticated tier has some view of these (own/branch/all, enforced by RLS)
    case 'settings':
      return true; // personal profile/preferences page; system-config section within it is exec-gated
    case 'user-management':
      // FRD: creating/editing/deactivating staff accounts is Boss/Super Admin
      // only. Admin can still open this page to view the directory and issue
      // warnings (see canWarnStaff) — that's enforced inside the page itself,
      // not by blocking the route.
      return isAdminOrAbove(role);
    case 'role-management':
      return isExec(role);
    case 'kpi-board':
    case 'analytics':
      return isExec(role);
    case 'agent-detail':
      return isManagerOrAbove(role);
    case 'team-activity':
      // Daily staff-activity monitor — management tool; RLS scopes what each
      // tier sees (exec: all, admin/manager: own department).
      return isManagerOrAbove(role);
    default:
      return false;
  }
}

export function getRoleLabel(role: RoleTier | null | undefined): string {
  if (!role) return '—';
  return ROLE_LABELS[role] || role;
}

export function getDepartmentLabel(department: string | null | undefined): string {
  return lookupDepartmentLabel(department);
}
