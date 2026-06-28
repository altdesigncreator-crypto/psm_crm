/**
 * Department-based role system for PSM Sale CRM.
 *
 * Role format: {department}_{level}
 *   Departments: house, condo, project
 *   Levels: sale, supervisor, supervisor2, manager, admin, admin_manager
 *
 * Cross-cutting roles (all departments):
 *   admin, chairman (legacy), project_manager
 */

export type Department = 'house' | 'condo' | 'project' | 'all';
export type RoleLevel = 'sale' | 'supervisor' | 'supervisor2' | 'manager' | 'admin' | 'admin_manager';

// All valid CRM roles
export const VALID_ROLES: string[] = [
  // House department
  'house_sale',
  'house_supervisor',
  'house_admin',
  'house_admin_manager',
  // Condo department
  'condo_sale',
  'condo_supervisor',
  'condo_supervisor2',
  'condo_manager',
  'condo_admin',
  // Project department
  'project_sale',
  'project_manager',
  // Legacy / cross-cutting
  'admin',
  'chairman',
  'sale',
];

// Department display names (Myanmar)
export const DEPARTMENT_NAMES: Record<string, string> = {
  house: 'အိမ်ရာ',
  condo: 'ကွန်ဒို',
  project: 'ပရောဂျက်',
  all: 'အားလုံး',
};

// Role display names (Myanmar)
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  house_sale: 'အိမ်ရာ အရောင်း',
  house_supervisor: 'အိမ်ရာ အကြီးကြပ်',
  house_admin: 'အိမ်ရာ အိတ်စ်',
  house_admin_manager: 'အိမ်ရာ အထောက်အကူပြုပါတီ',
  condo_sale: 'ကွန်ဒို အရောင်း',
  condo_supervisor: 'ကွန်ဒို အကြီးကြပ်',
  condo_supervisor2: 'ကွန်ဒို အကြီးကြပ် (၂)',
  condo_manager: 'ကွန်ဒို စီမံခန့်ခွဲသူ',
  condo_admin: 'ကွန်ဒို အိတ်စ်',
  project_sale: 'ပရောဂျက် အရောင်း',
  project_manager: 'ပရောဂျက် စီမံခန့်ခွဲသူ',
  admin: 'အထွေထွေ အိတ်စ်',
  chairman: 'ဥက္ကဋ္ဌ',
  sale: 'အရောင်း',
};

/**
 * Roles whose underlying name contains "admin" but whose ACTUAL access level
 * is Manager (own-department only) — NOT cross-department Admin.
 * Confirmed business rule: condo_admin and house_admin behave as department
 * managers, not as global admins. Only `admin` itself and `house_admin_manager`
 * are true cross-department Admin-level roles.
 */
const MANAGER_LEVEL_OVERRIDES = new Set(['condo_admin', 'house_admin']);

/** True cross-department Admin-level roles (see ALL departments). */
const ADMIN_LEVEL_OVERRIDES = new Set(['admin', 'house_admin_manager']);

export function getDepartment(role: string | null | undefined): Department {
  if (!role) return 'all';
  const lower = role.toLowerCase().trim();
  if (lower === 'admin' || lower === 'chairman') return 'all';
  if (ADMIN_LEVEL_OVERRIDES.has(lower)) return 'all';
  if (MANAGER_LEVEL_OVERRIDES.has(lower)) {
    if (lower.startsWith('house_')) return 'house';
    if (lower.startsWith('condo_')) return 'condo';
  }
  if (lower.startsWith('house_')) return 'house';
  if (lower.startsWith('condo_')) return 'condo';
  if (lower.startsWith('project_')) return 'project';
  return 'all';
}

export function getRoleLevel(role: string | null | undefined): RoleLevel | null {
  if (!role) return null;
  const lower = role.toLowerCase().trim();
  if (lower === 'admin' || lower === 'chairman') return 'admin';
  if (ADMIN_LEVEL_OVERRIDES.has(lower)) return 'admin';
  if (MANAGER_LEVEL_OVERRIDES.has(lower)) return 'manager';

  const parts = lower.split('_');
  const level = parts.slice(1).join('_');
  const levelMap: Record<string, RoleLevel> = {
    sale: 'sale',
    supervisor: 'supervisor',
    supervisor2: 'supervisor2',
    manager: 'manager',
    admin: 'admin',
    admin_manager: 'admin_manager',
  };
  return levelMap[level] || null;
}

export function normalizeRole(role: string | null | undefined): string | null {
  if (!role) return null;
  const lower = role.toLowerCase().trim();
  if (VALID_ROLES.includes(lower)) return lower;
  const legacyMap: Record<string, string> = {
    boss: 'chairman',
    sales: 'sale',
    projectmanager: 'project_manager',
    condomanager: 'condo_manager',
    housemanager: 'house_admin_manager',
  };
  return legacyMap[lower] || lower;
}

/** Check if the role is a salesperson from any department */
export function isSaleRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const normalized = normalizeRole(role) || '';
  return normalized === 'sale' || normalized.endsWith('_sale');
}

/**
 * True cross-department Admin/Chairman only.
 * NOTE: condo_admin and house_admin are intentionally EXCLUDED here —
 * despite their name containing "admin", confirmed business rule treats
 * them as Manager-level (own department only). See MANAGER_LEVEL_OVERRIDES.
 */
export function isAdmin(role: string | null | undefined): boolean {
  if (!role) return false;
  const lower = normalizeRole(role) || '';
  return lower === 'admin' || lower === 'chairman' || ADMIN_LEVEL_OVERRIDES.has(lower);
}

/** True if this role is Chairman (top of hierarchy). */
export function isChairman(role: string | null | undefined): boolean {
  const lower = normalizeRole(role) || '';
  return lower === 'chairman';
}

/** Manager-level or above: project_manager, condo_manager, condo_admin, house_admin, admin, chairman. */
export function isManagerLevel(role: string | null | undefined): boolean {
  if (!role) return false;
  if (isAdmin(role)) return true;
  const lower = normalizeRole(role) || '';
  if (MANAGER_LEVEL_OVERRIDES.has(lower)) return true;
  return getRoleLevel(lower) === 'manager';
}

/**
 * Supervisor-level or above (supervisor, supervisor2, manager, admin, chairman).
 * Used for pages that should be hidden from plain "sale" roles.
 */
export function isManagement(role: string | null | undefined): boolean {
  if (!role) return false;
  if (isAdmin(role)) return true;
  const level = getRoleLevel(role);
  return level === 'supervisor' || level === 'supervisor2' || level === 'manager' || level === 'admin_manager';
}

export function isSupervisor(role: string | null | undefined): boolean {
  if (!role) return false;
  const level = getRoleLevel(role);
  return level === 'supervisor'
    || level === 'supervisor2'
    || level === 'manager'
    || level === 'admin'
    || level === 'admin_manager';
}

export function sameDepartment(role1: string, role2: string): boolean {
  const dept1 = getDepartment(role1);
  const dept2 = getDepartment(role2);
  if (dept1 === 'all' || dept2 === 'all') return true;
  return dept1 === dept2;
}

/**
 * Centralized data-visibility check for an individual lead/record.
 */
export function canViewLead(
  viewerRole: string | null | undefined,
  viewerEmail: string | null | undefined,
  record: { assignedAgent?: string | null; department?: string | null },
): boolean {
  if (!viewerRole) return false;

  // 1. Chairman / Admin — sees everything, no restriction.
  if (isAdmin(viewerRole)) return true;

  // 2. Manager-level — sees everything in their own department.
  if (isManagerLevel(viewerRole)) {
    const viewerDept = getDepartment(viewerRole);
    const recordDept = (record.department || 'house') as Department;
    return viewerDept === 'all' || viewerDept === recordDept;
  }

  // 3. Sale / Supervisor — own records only. No peer-to-peer visibility.
  if (!viewerEmail) return false;
  return (record.assignedAgent || '').toLowerCase() === viewerEmail.toLowerCase();
}

/**
 * Filters a list of leads down to what `viewerRole`/`viewerEmail` is allowed to see.
 */
export function filterVisibleLeads<T extends { assignedAgent?: string | null; department?: string | null }>(
  leads: T[],
  viewerRole: string | null | undefined,
  viewerEmail: string | null | undefined,
): T[] {
  return leads.filter((lead) => canViewLead(viewerRole, viewerEmail, lead));
}

export function canAccessPage(role: string | null | undefined, page: string): boolean {
  if (!role) return false;
  
  // Strict Security Rule: Sales staff from ANY department are instantly blocked from configuration hubs
  if (isSaleRole(role)) {
    if (page.startsWith('user-management') || page.startsWith('role-management')) {
      return false;
    }
  }

  const publicPages = ['dashboard', 'add-lead', 'leads', 'lead', 'check-in', 'check-in-gallery', 'notifications', 'agent'];
  if (publicPages.some((p) => page.startsWith(p))) return true;

  // Hubs accessible exclusively by top admins
  const adminPages = ['user-management', 'role-management', 'audit-log'];
  if (adminPages.some((p) => page.startsWith(p))) return isAdmin(role);
  
  if (page.startsWith('kpi')) return isManagement(role);
  if (page.startsWith('agent')) return isManagement(role);
  return false;
}

export function getRoleDisplayName(role: string | null | undefined): string {
  if (!role) return '—';
  const normalized = normalizeRole(role) || role;
  return ROLE_DISPLAY_NAMES[normalized] || role;
}

export function getDepartmentDisplayName(role: string | null | undefined): string {
  const dept = getDepartment(role);
  return DEPARTMENT_NAMES[dept] || '—';
}