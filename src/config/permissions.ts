// src/config/permissions.ts

export type Permission = 
  | 'view_dashboard'
  | 'manage_staff'
  | 'view_leads'
  | 'manage_leads'
  | 'view_check_in'
  | 'view_kpi'
  | 'manage_settings';

export interface RoleConfig {
  name: string;
  permissions: Permission[];
}

export const SYSTEM_PERMISSIONS: { id: Permission; label: string; description: string }[] = [
  { id: 'view_dashboard', label: 'Dashboard View', description: 'Can view administrative summaries, analytics widgets, and operational overviews.' },
  { id: 'manage_staff', label: 'Staff Management', description: 'Can create, read, update profiles, change roles, and modify employment status of staff.' },
  { id: 'view_leads', label: 'View Leads Data', description: 'Can view available property sales leads, apartments, project descriptions, and customer inquiries.' },
  { id: 'manage_leads', label: 'Manage Leads Lifecycle', description: 'Can create new properties/leads, assign clients, update sales data, and edit values.' },
  { id: 'view_check_in', label: 'Attendance Tracking', description: 'Can access staff check-in matrix tables, geological markers, and attendance timestamps.' },
  { id: 'view_kpi', label: 'KPI Performance Analytics', description: 'Can view metrics, goal pipelines, conversion statistics, and target ratios.' },
  { id: 'manage_settings', label: 'System Configuration', description: 'Can control global system values, application rules, and customize user permissions configurations.' }
];

export const ROLE_PRESETS: Record<string, RoleConfig> = {
  admin: {
    name: 'Admin',
    permissions: [
      'view_dashboard', 'manage_staff', 'view_leads', 
      'manage_leads', 'view_check_in', 'view_kpi', 'manage_settings'
    ]
  },
  manager: {
    name: 'Manager',
    permissions: ['view_dashboard', 'view_leads', 'manage_leads', 'view_check_in', 'view_kpi']
  },
  sale: {
    name: 'Sale Person',
    permissions: ['view_dashboard', 'view_leads', 'view_check_in']
  }
};

/**
 * Validates access dynamically against a live memory record or static configuration presets.
 */
export function hasPermission(
  userRole: string | null | undefined, 
  permission: Permission, 
  dynamicRoles?: Record<string, RoleConfig> | null
): boolean {
  if (!userRole) return false;
  
  // Use custom dynamic roles from database if provided; otherwise, use defaults
  const roleConfig = dynamicRoles ? dynamicRoles[userRole] : ROLE_PRESETS[userRole];
  if (!roleConfig) return false;

  return roleConfig.permissions.includes(permission);
}