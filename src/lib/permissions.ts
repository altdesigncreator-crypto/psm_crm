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
import { translations, type Lang } from '@/lib/translations';

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
  /** Ids of teams this user manages (role 'manager' only) — used to narrow
   * lead/staff visibility from "whole department" to "my team(s)" while
   * Admin/exec stay department-wide/global. See src/contexts/AuthContext's
   * myTeamIds, which this is populated from for the signed-in user. */
  managedTeamIds?: string[];
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
  teamId?: string | null;
}

/** Manager's team-scoped check shared by canViewLead/canMonitorLead — a
 * lead filed under a team is visible only to that team's manager. A lead
 * with no team_id is invisible to every manager (only Admin/exec and the
 * lead's own owner can still see it) — no whole-department fallback,
 * exactly mirroring manager_scoped_lead() in database/crm.sql. */
function managerCanSeeLead(user: CurrentUser, lead: LeadRecord): boolean {
  if (!lead.teamId) return false;
  return (user.managedTeamIds || []).includes(lead.teamId);
}

/** Mirrors the `leads_select` RLS policy in database/crm.sql. */
export function canViewLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return lead.departmentCode === user.department;
  if (user.role === 'manager') return managerCanSeeLead(user, lead);
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

/** Mirrors the `leads_delete` RLS policy — Boss/Super Admin can delete any
 * lead; a Manager or Sales Person may only delete a lead they currently own
 * (not the rest of their department/team). Admin has no delete rights,
 * unchanged from the original FRD rule. */
export function canDeleteLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'manager' || user.role === 'sale') return lead.ownerId === user.id;
  return false;
}

export function canAssignLead(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user?.role);
}

/** Admins can view/monitor + warn/reassign any lead in their own department;
 * Managers are narrowed to leads filed under a team they run (see
 * managerCanSeeLead). */
export function canMonitorLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return lead.departmentCode === user.department;
  if (user.role === 'manager') return managerCanSeeLead(user, lead);
  return lead.ownerId === user.id;
}

export function canAddFollowUp(user: CurrentUser | null, lead: LeadRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return lead.departmentCode === user.department;
  // Manager is otherwise "view only" for follow-ups (can't add on a lead
  // they merely manage/monitor), but can add on a lead they personally own
  // — AddLead.tsx lets a manager-or-above assign a lead to themselves, and
  // that self-owned case falls through to the generic owner-match below,
  // same as it already works for a sale rep.
  return lead.ownerId === user.id;
}

export function canIssueWarning(user: CurrentUser | null): boolean {
  return isManagerOrAbove(user?.role);
}

/** Mirrors the `warnings_insert` RLS policy for a general (not lead-tied)
 * staff warning — e.g. Admin warning a Manager directly from the Staff
 * page, rather than through a specific lead's follow-up trail. Manager is
 * narrowed to people on a team they run (`managedPersonIds`, computed by
 * the caller from useTeams()) rather than the whole department. */
export function canWarnStaff(
  user: CurrentUser | null,
  target: { id: string; departmentCode?: string | null },
  managedPersonIds?: string[]
): boolean {
  if (!user) return false;
  if (isAdminOrAbove(user.role)) return true;
  if (user.role === 'manager') return (managedPersonIds || []).includes(target.id);
  return false;
}

interface EnquiryRecord {
  assignedTo?: string | null;
  status?: string;
}

/** Mirrors the `enquiries_insert` RLS policy — only Admin (own department)
 * or exec (global) can log and assign a new enquiry. */
export function canAssignEnquiry(user: CurrentUser | null): boolean {
  return isAdminOrAbove(user?.role);
}

/** Mirrors the `enquiries_select` RLS policy. */
export function canViewEnquiry(user: CurrentUser | null, enquiry: EnquiryRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return true; // department match is enforced by the query/RLS, not knowable client-side without the assignee's department
  return enquiry.assignedTo === user.id;
}

/** Mirrors the `enquiries_update` RLS policy for the assignee's own accept/
 * convert actions — Admin/exec corrections go through canViewEnquiry's
 * broader visibility instead, since they're allowed regardless of status
 * (pending only, for a plain admin — enforced by RLS). */
export function canActOnEnquiry(user: CurrentUser | null, enquiry: EnquiryRecord): boolean {
  if (!user) return false;
  return enquiry.assignedTo === user.id;
}

/** Mirrors the `enquiries_update` / `enquiries_delete` RLS policies for the
 * Admin/exec correction-and-cleanup path (distinct from canActOnEnquiry's
 * assignee-only accept/convert path). Exec can edit or delete an enquiry
 * regardless of status; a plain Admin only while it's still `pending` —
 * once accepted it's part of the assignee's own workflow and, once deleted
 * would be, part of the audit trail — the database enforces the same cutoff
 * independently, this just keeps the UI from offering an action RLS would
 * reject anyway. */
export function canEditEnquiry(user: CurrentUser | null, enquiry: EnquiryRecord): boolean {
  if (!user) return false;
  if (isExec(user.role)) return true;
  if (user.role === 'admin') return enquiry.status === 'pending';
  return false;
}

export const canDeleteEnquiry = canEditEnquiry;

/** Route names as used in src/routes.tsx / nav config. */
export type RouteKey =
  | 'dashboard' | 'add-lead' | 'leads' | 'lead-detail' | 'pipeline' | 'follow-ups'
  | 'notifications' | 'settings' | 'psm-map' | 'enquiries'
  | 'user-management' | 'role-management' | 'team-management'
  | 'kpi-board' | 'profile' | 'analytics' | 'team-activity';

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
    case 'notifications':
    case 'psm-map':
    case 'enquiries':
      return true; // every authenticated tier has some view of these (own/branch/all, enforced by RLS)
    case 'settings':
      return true; // personal profile/preferences page; system-config section within it is exec-gated
    case 'user-management':
      return isAdminOrAbove(role);
    case 'role-management':
      return isExec(role);
    case 'team-management':
      return isAdminOrAbove(role);
    case 'kpi-board':
    case 'analytics':
      return isExec(role);
    case 'profile':
      return true;
    case 'team-activity':
      return isManagerOrAbove(role);
    default:
      return false;
  }
}

export function getRoleLabel(role: RoleTier | null | undefined, lang: Lang = 'en'): string {
  if (!role) return '—';
  return translations[`role.${role}`]?.[lang] || ROLE_LABELS[role] || role;
}

export function getDepartmentLabel(department: string | null | undefined): string {
  return lookupDepartmentLabel(department);
}
