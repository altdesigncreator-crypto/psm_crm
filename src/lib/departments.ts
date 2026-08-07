export interface DepartmentRecord {
  code: string;
  name: string;
  is_active: boolean;
}

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
