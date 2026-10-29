import type { EnquiryCategory } from '@/types';

/** A branch (Yangon, Mandalay, …) owns departments; everything that belongs
 * to a department — staff, teams, leads, enquiries — belongs to its branch. */
export interface BranchRecord {
  code: string;
  name: string;
  name_mm: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface DepartmentRecord {
  code: string;
  name: string;
  branch_code: string;
  /** Which project / lead-source list (Condo or House & Land) its forms use. */
  category: EnquiryCategory | null;
  is_active: boolean;
}

// Every department and branch, inactive ones included — saved records still
// reference them, and branch scopes resolve through them. Loaded at sign-in
// (AuthContext) and refreshed by useDepartments/useBranches.
let departments: DepartmentRecord[] = [];
let branches: BranchRecord[] = [];

export function setDepartmentsCache(list: DepartmentRecord[]) {
  departments = list;
}

export function setBranchesCache(list: BranchRecord[]) {
  branches = [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function getDepartmentsCache(): DepartmentRecord[] {
  return departments;
}

export function getBranchesCache(): BranchRecord[] {
  return branches;
}

export function getDepartment(code?: string | null): DepartmentRecord | undefined {
  return code ? departments.find((d) => d.code === code) : undefined;
}

export function branchOfDepartment(code?: string | null): string | null {
  return getDepartment(code)?.branch_code ?? null;
}

export function getBranchLabel(code?: string | null, lang: 'en' | 'mm' = 'en'): string {
  if (!code) return '—';
  const b = branches.find((x) => x.code === code);
  return (b && ((lang === 'mm' && b.name_mm) || b.name)) || code;
}

/** Labels only need the branch once there's more than one to tell apart. */
export function hasMultipleBranches(): boolean {
  return branches.filter((b) => b.is_active).length > 1;
}

/** "Condo", or "Mandalay · Condo" when there are several branches. */
export function getDepartmentLabel(code?: string | null): string {
  if (!code) return '—';
  const d = getDepartment(code);
  if (!d) return code;
  return hasMultipleBranches() ? `${getBranchLabel(d.branch_code)} · ${d.name}` : d.name;
}

/** Departments in branch order, then by name — how every picker lists them. */
export function sortDepartments<T extends Pick<DepartmentRecord, 'branch_code' | 'name'>>(list: T[]): T[] {
  const rank = new Map(branches.map((b, i) => [b.code, i]));
  return [...list].sort((a, b) => (rank.get(a.branch_code) ?? 99) - (rank.get(b.branch_code) ?? 99) || a.name.localeCompare(b.name));
}
