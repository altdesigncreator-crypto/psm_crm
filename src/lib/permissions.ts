/**
 * Single source of truth for the CRM's role/permission model on the client.
 *
 * Roles are data (public.roles), not code: each role holds a set of
 * permissions (public.permissions), each at a scope — see
 * supabase/migrations/20261028120000_dynamic_roles_permissions.sql. This
 * file mirrors the SQL resolver (role_scope / lead_in_scope /
 * person_in_scope) so the UI hides what the database would refuse anyway.
 * The database is the real security boundary; this is the UX layer.
 *
 * Nothing here names a specific role. Ask "can this role do X?", never
 * "is this an Admin?".
 */

import { useSyncExternalStore } from 'react';
import { branchOfDepartment, getDepartmentLabel as lookupDepartmentLabel } from '@/lib/departments';
import type { Lang } from '@/lib/translations';

/** A role's key (public.roles.key) — 'boss', 'sale', or any custom role. */
export type RoleKey = string;
/** Departments are dynamic data (public.departments table), not a fixed set
 * — see src/hooks/useDepartments.ts. This alias just keeps existing type
 * annotations meaningful. */
export type Department = string;

/** Narrowest to widest. A branch owns departments, so a branch scope covers
 * every department in your own branch; only "all" crosses branches. */
export type Scope = 'own' | 'team' | 'department' | 'branch' | 'all';
export const SCOPES: Scope[] = ['own', 'team', 'department', 'branch', 'all'];

export type PermissionKey =
  | 'leads.view' | 'leads.edit' | 'leads.followup' | 'leads.reassign' | 'leads.delete' | 'leads.import' | 'leads.bulk_delete'
  | 'enquiries.view' | 'enquiries.create' | 'enquiries.manage' | 'enquiries.manage_accepted' | 'enquiries.receive'
  | 'staff.view' | 'staff.manage' | 'staff.warn' | 'staff.notify' | 'attendance.manage' | 'attendance.delete'
  | 'teams.view' | 'teams.manage' | 'teams.lead' | 'teams.join'
  | 'reports.kpi' | 'reports.team_activity' | 'reports.project_insights'
  | 'catalog.manage' | 'map.manage' | 'system.configure' | 'audit.view' | 'roles.manage';

export type PermissionCategory = 'leads' | 'enquiries' | 'staff' | 'teams' | 'reports' | 'system';

export interface RoleRecord {
  key: RoleKey;
  name: string;
  name_mm: string | null;
  description: string | null;
  /** Lower is more senior. You can only edit roles ranked below your own. */
  rank: number;
  is_system: boolean;
  /** The all-access role: implicitly holds every permission at its widest scope. */
  is_owner: boolean;
  requires_department: boolean;
}

export interface PermissionRecord {
  key: PermissionKey;
  category: PermissionCategory;
  /** Scopes this permission supports, narrowest first. */
  scopes: Scope[];
  sort_order: number;
  description: string;
  /** 'capability' marks eligibility (can lead a team, can receive
   * enquiries) rather than access, and never counts as escalation. */
  kind: 'access' | 'capability';
}

export interface RoleGrant {
  role_key: RoleKey;
  permission_key: PermissionKey;
  scope: Scope;
}

// ---------------------------------------------------------------------------
// Catalog store — loaded by AuthContext, kept live over realtime. A plain
// external store (like appUpdate.ts) so non-React helpers can read it.
// ---------------------------------------------------------------------------

export interface RbacCatalog {
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  grants: RoleGrant[];
  /** A catalog is present (fresh or from cache). Until then every check
   * fails closed, so callers must wait rather than treat it as "denied". */
  loaded: boolean;
  /** The most recent load failed — a retry is pending. */
  failed: boolean;
}

export type RbacCatalogData = Pick<RbacCatalog, 'roles' | 'permissions' | 'grants'>;

let catalog: RbacCatalog = { roles: [], permissions: [], grants: [], loaded: false, failed: false };
let grantIndex = new Map<string, Scope>();
const listeners = new Set<() => void>();

export const rbacStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => catalog,
  set(next: RbacCatalogData) {
    catalog = {
      roles: [...next.roles].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)),
      permissions: [...next.permissions].sort((a, b) => a.sort_order - b.sort_order),
      grants: next.grants,
      loaded: true,
      failed: false,
    };
    grantIndex = new Map(next.grants.map((g) => [`${g.role_key}|${g.permission_key}`, g.scope]));
    listeners.forEach((l) => l());
  },
  /** Keeps whatever catalog is already held (a cached one stays usable). */
  markFailed() {
    if (catalog.failed) return;
    catalog = { ...catalog, failed: true };
    listeners.forEach((l) => l());
  },
};

export function useRbacCatalog(): RbacCatalog {
  return useSyncExternalStore(rbacStore.subscribe, rbacStore.getSnapshot, rbacStore.getSnapshot);
}

export function getRole(roleKey: RoleKey | null | undefined): RoleRecord | undefined {
  return roleKey ? catalog.roles.find((r) => r.key === roleKey) : undefined;
}

/** All roles, most senior first. */
export function getRoles(): RoleRecord[] {
  return catalog.roles;
}

// ---------------------------------------------------------------------------
// Resolver — mirrors public.role_scope() in SQL.
// ---------------------------------------------------------------------------

export function scopeRank(scope: Scope | null | undefined): number {
  return scope ? SCOPES.indexOf(scope) + 1 : 0;
}

/** A role's scope for a permission as a rank (0 = none, then SCOPES order;
 * compare against scopeRank('…'), never a number). Unknown roles or
 * permissions resolve to 0 — fail closed. */
export function roleScope(roleKey: RoleKey | null | undefined, permission: PermissionKey): number {
  const role = getRole(roleKey);
  const perm = catalog.permissions.find((p) => p.key === permission);
  if (!role || !perm) return 0;
  if (role.is_owner) return Math.max(...perm.scopes.map(scopeRank));
  return scopeRank(grantIndex.get(`${role.key}|${permission}`));
}

export function scopeOf(roleKey: RoleKey | null | undefined, permission: PermissionKey): Scope | null {
  const rank = roleScope(roleKey, permission);
  return rank ? SCOPES[rank - 1] : null;
}

/** Does the role hold `permission` at `min` scope or wider? */
export function hasPermission(roleKey: RoleKey | null | undefined, permission: PermissionKey, min: Scope = 'own'): boolean {
  return roleScope(roleKey, permission) >= scopeRank(min);
}

/** Does the role see more than its own department (a whole branch, or
 * everything)? Drives whether department columns and filters are worth showing. */
export function seesAllDepartments(roleKey: RoleKey | null | undefined): boolean {
  return hasPermission(roleKey, 'leads.view', 'branch');
}

/** Does the role see every branch? Only then is a branch picker meaningful. */
export function seesAllBranches(roleKey: RoleKey | null | undefined): boolean {
  return hasPermission(roleKey, 'leads.view', 'all');
}

/** Mirrors public.role_within_user(): is every access permission of
 * `roleKey` within what `holderRoleKey` holds? The owner role is only
 * within another owner. */
export function roleWithin(roleKey: RoleKey, holderRoleKey: RoleKey | null | undefined): boolean {
  const role = getRole(roleKey);
  const holder = getRole(holderRoleKey);
  if (!role || !holder) return false;
  if (role.is_owner) return holder.is_owner;
  return catalog.permissions
    .filter((p) => p.kind === 'access')
    .every((p) => roleScope(roleKey, p.key) <= roleScope(holderRoleKey, p.key));
}

/** Can a holder of `myRole` give someone `targetRole` (or manage someone
 * who has it)? Mirrors public.user_can_assign_role(). */
export function canAssignRole(myRole: RoleKey | null | undefined, targetRole: RoleKey): boolean {
  return hasPermission(myRole, 'staff.manage', 'all') && roleWithin(targetRole, myRole);
}

/** Can a holder of `myRole` edit `target`'s definition? Mirrors the
 * enforce_role_rules trigger: only roles junior to your own, never the owner. */
export function canEditRole(myRole: RoleKey | null | undefined, target: RoleRecord): boolean {
  const me = getRole(myRole);
  return !!me && hasPermission(myRole, 'roles.manage') && !target.is_owner && target.rank > me.rank;
}

export type Grants = Partial<Record<PermissionKey, Scope>>;

/** A role's effective permissions as a grants map (the owner role's are
 * implicit: every permission at its widest scope). */
export function roleGrants(roleKey: RoleKey | null | undefined): Grants {
  const grants: Grants = {};
  for (const p of catalog.permissions) {
    const rank = roleScope(roleKey, p.key);
    if (rank) grants[p.key] = SCOPES[rank - 1];
  }
  return grants;
}

export interface PermissionChange {
  permission: PermissionRecord;
  from: Scope | null;
  to: Scope | null;
  /** True when the change gives more access (or eligibility) than before. */
  widens: boolean;
}

/** Every permission whose scope differs between two grant sets, in catalog
 * order — what confirmation dialogs show before a role or person changes. */
export function diffGrants(from: Grants, to: Grants): PermissionChange[] {
  return catalog.permissions
    .filter((p) => from[p.key] !== to[p.key])
    .map((p) => ({
      permission: p,
      from: from[p.key] ?? null,
      to: to[p.key] ?? null,
      widens: scopeRank(to[p.key]) > scopeRank(from[p.key]),
    }));
}

/** The widest scope of `permission` a holder of `myRole` may grant to a role
 * — capabilities aren't access, so they're always grantable. */
export function maxGrantableScope(myRole: RoleKey | null | undefined, permission: PermissionRecord): number {
  return permission.kind === 'capability' ? scopeRank('all') : roleScope(myRole, permission.key);
}

// ---------------------------------------------------------------------------
// Record-level checks — mirror the RLS policies.
// ---------------------------------------------------------------------------

export interface CurrentUser {
  id: string;
  role: RoleKey | null;
  department: Department | null;
  /** Ids of teams this user manages — used by 'team'-scoped permissions.
   * Populated from AuthContext's managedTeamIds for the signed-in user. */
  managedTeamIds?: string[];
}

interface LeadRecord {
  ownerId?: string | null;
  departmentCode?: string | null;
  teamId?: string | null;
}

function sameBranch(departmentCode: string | null | undefined, user: CurrentUser): boolean {
  const branch = branchOfDepartment(departmentCode);
  return !!branch && branch === branchOfDepartment(user.department);
}

/** Mirrors public.lead_in_scope(). Pass `includeOwner: false` where owning
 * a lead grants nothing by itself (reassigning). */
function leadInScope(scope: number, user: CurrentUser, lead: LeadRecord, includeOwner = true): boolean {
  if (scope >= scopeRank('all')) return true;
  if (scope >= scopeRank('branch') && sameBranch(lead.departmentCode, user)) return true;
  if (scope >= scopeRank('department') && !!lead.departmentCode && lead.departmentCode === user.department) return true;
  if (scope >= scopeRank('team') && !!lead.teamId && (user.managedTeamIds || []).includes(lead.teamId)) return true;
  return includeOwner && scope >= scopeRank('own') && !!lead.ownerId && lead.ownerId === user.id;
}

/** Mirrors public.person_in_scope(): the people you oversee — never yourself. */
function personInScope(scope: number, user: CurrentUser, person: { id: string; departmentCode?: string | null }, managedPersonIds?: string[]): boolean {
  if (scope >= scopeRank('all')) return true;
  if (scope >= scopeRank('branch') && sameBranch(person.departmentCode, user)) return true;
  if (scope >= scopeRank('department') && !!person.departmentCode && person.departmentCode === user.department) return true;
  return scope >= scopeRank('team') && (managedPersonIds || []).includes(person.id);
}

/** Mirrors the `leads_select` RLS policy. */
export function canViewLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  return !!user && leadInScope(roleScope(user.role, 'leads.view'), user, lead);
}

/** Mirrors the `leads_update` RLS policy. */
export function canEditLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  return !!user && leadInScope(roleScope(user.role, 'leads.edit'), user, lead);
}

/** Mirrors the `leads_delete` RLS policy. */
export function canDeleteLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  return !!user && leadInScope(roleScope(user.role, 'leads.delete'), user, lead);
}

/** Whether the user can assign leads to other people at all. */
export function canAssignLead(user: CurrentUser | null): boolean {
  return hasPermission(user?.role, 'leads.reassign');
}

/** Mirrors public.reassign_lead(): owning a lead isn't enough to reassign it. */
export function canReassignLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  return !!user && leadInScope(roleScope(user.role, 'leads.reassign'), user, lead, false);
}

/** Mirrors the follow_ups / appointments / site_visits write policies. */
export function canAddFollowUp(user: CurrentUser | null, lead: LeadRecord): boolean {
  return !!user && leadInScope(roleScope(user.role, 'leads.followup'), user, lead);
}

/** Can the user warn staff over this lead? Requires seeing the lead and
 * holding staff.warn. */
export function canWarnOnLead(user: CurrentUser | null, lead: LeadRecord): boolean {
  return canViewLead(user, lead) && hasPermission(user?.role, 'staff.warn');
}

/** Mirrors the `warnings_insert` RLS policy. `managedPersonIds` — people on
 * teams the user runs — is computed by the caller from useTeams(). */
export function canWarnStaff(
  user: CurrentUser | null,
  target: { id: string; departmentCode?: string | null },
  managedPersonIds?: string[]
): boolean {
  return !!user && personInScope(roleScope(user.role, 'staff.warn'), user, target, managedPersonIds);
}

interface EnquiryRecord {
  assignedTo?: string | null;
  status?: string;
}

/** Mirrors the `enquiries_insert` RLS policy. */
export function canAssignEnquiry(user: CurrentUser | null): boolean {
  return hasPermission(user?.role, 'enquiries.create', 'department');
}

/** The assignee's own accept/convert path (enquiries_update). */
export function canActOnEnquiry(user: CurrentUser | null, enquiry: EnquiryRecord): boolean {
  return !!user && enquiry.assignedTo === user.id && hasPermission(user.role, 'enquiries.view');
}

/** Mirrors the correction/cleanup path of `enquiries_update` /
 * `enquiries_delete`: pending only, unless enquiries.manage_accepted. The
 * assignee's department is enforced by RLS (not knowable client-side
 * without the assignee's profile). */
export function canEditEnquiry(user: CurrentUser | null, enquiry: EnquiryRecord): boolean {
  if (!user || !hasPermission(user.role, 'enquiries.manage', 'department')) return false;
  return enquiry.status === 'pending' || hasPermission(user.role, 'enquiries.manage_accepted');
}

export const canDeleteEnquiry = canEditEnquiry;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Route names as used in src/routes.tsx / nav config. */
export type RouteKey =
  | 'dashboard' | 'add-lead' | 'leads' | 'lead-detail' | 'pipeline' | 'follow-ups'
  | 'notifications' | 'settings' | 'psm-map' | 'enquiries'
  | 'user-management' | 'role-management' | 'team-management'
  | 'kpi-board' | 'profile' | 'analytics' | 'team-activity' | 'project-insights';

export function canAccessRoute(role: RoleKey | null | undefined, routeKey: RouteKey): boolean {
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
    case 'settings':
    case 'profile':
      return true; // everyone has some view of these (scoped by RLS)
    case 'user-management':
      return hasPermission(role, 'staff.manage') || hasPermission(role, 'staff.view', 'department');
    case 'role-management':
      return hasPermission(role, 'roles.manage');
    case 'team-management':
      return hasPermission(role, 'teams.manage', 'department');
    case 'kpi-board':
    case 'analytics':
      return hasPermission(role, 'reports.kpi');
    case 'team-activity':
      return hasPermission(role, 'reports.team_activity');
    case 'project-insights':
      return hasPermission(role, 'reports.project_insights');
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function getRoleLabel(role: RoleKey | null | undefined, lang: Lang = 'en'): string {
  if (!role) return '—';
  const record = getRole(role);
  if (!record) return role;
  return (lang === 'mm' && record.name_mm) || record.name;
}

export function getDepartmentLabel(department: string | null | undefined): string {
  return lookupDepartmentLabel(department);
}
