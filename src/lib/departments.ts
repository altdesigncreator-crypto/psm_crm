export interface DepartmentRecord {
  code: string;
  name: string;
  is_active: boolean;
}

// Module-level cache so getDepartmentLabel() can resolve a code to a name
// synchronously anywhere in the app (tables, badges, exports) without every
// call site needing to fetch/await. Populated by useDepartments() the first
// time it runs in the session.
let cache: DepartmentRecord[] = [];

export function setDepartmentsCache(list: DepartmentRecord[]) {
  cache = list;
}

export function getDepartmentsCache(): DepartmentRecord[] {
  return cache;
}

export function getDepartmentLabel(code?: string | null): string {
  if (!code) return '—';
  return cache.find((d) => d.code === code)?.name || code;
}
