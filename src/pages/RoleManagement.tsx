import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, ShieldAlert, Check, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_TIERS, ROLE_LABELS, isExec } from '@/lib/permissions';

type Access = 'yes' | 'no' | 'own' | 'branch' | 'view';

const ACCESS_LABEL: Record<Access, string> = { yes: 'Full', no: 'No access', own: 'Own only', branch: 'Department', view: 'View only' };
const ACCESS_STYLE: Record<Access, string> = {
  yes: 'bg-success/10 text-success border-success/20',
  no: 'bg-destructive/10 text-destructive border-destructive/20',
  own: 'bg-info/10 text-info border-info/20',
  branch: 'bg-warning/10 text-warning border-warning/20',
  view: 'bg-muted text-muted-foreground border-border',
};

// Mirrors the FRD's Permission Matrix (section 5) and the RLS policies in
// database/crm.sql — this page is a read-only reference, not a live editor,
// since the actual enforcement lives in Postgres RLS + src/lib/permissions.ts.
const MATRIX: { feature: string; access: Record<string, Access> }[] = [
  { feature: 'Dashboard', access: { boss: 'yes', super_admin: 'yes', admin: 'yes', manager: 'branch', sale: 'own' } },
  { feature: 'Lead Management', access: { boss: 'yes', super_admin: 'yes', admin: 'yes', manager: 'branch', sale: 'own' } },
  { feature: 'Delete Lead', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'no', sale: 'no' } },
  { feature: 'Assign / Reassign Lead', access: { boss: 'yes', super_admin: 'yes', admin: 'yes', manager: 'yes', sale: 'no' } },
  { feature: 'Follow-up', access: { boss: 'yes', super_admin: 'yes', admin: 'yes', manager: 'view', sale: 'own' } },
  { feature: 'Pipeline', access: { boss: 'yes', super_admin: 'yes', admin: 'yes', manager: 'branch', sale: 'own' } },
  { feature: 'Check-in', access: { boss: 'yes', super_admin: 'yes', admin: 'view', manager: 'view', sale: 'own' } },
  { feature: 'Warnings', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'yes', sale: 'view' } },
  { feature: 'Reports', access: { boss: 'yes', super_admin: 'yes', admin: 'yes', manager: 'branch', sale: 'own' } },
  { feature: 'KPI', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'no', sale: 'no' } },
  { feature: 'Analytics', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'no', sale: 'no' } },
  { feature: 'User Management', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'no', sale: 'no' } },
  { feature: 'Department Management', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'no', sale: 'no' } },
  { feature: 'Settings', access: { boss: 'yes', super_admin: 'yes', admin: 'no', manager: 'no', sale: 'no' } },
];

function AccessBadge({ value }: { value: Access }) {
  const Icon = value === 'no' ? X : value === 'yes' ? Check : Shield;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${ACCESS_STYLE[value]}`}>
      <Icon className="w-3 h-3" /> {ACCESS_LABEL[value]}
    </span>
  );
}

export default function RoleManagement() {
  const { role } = useAuth();

  if (!isExec(role)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">Role reference is restricted to Boss and Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold text-foreground flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Role & Permission Reference</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Access levels are fixed by role tier and enforced at the database level (Postgres row-level security) — this page is a reference, not an editor.
        </p>
      </div>

      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Permission Matrix</CardTitle>
          <CardDescription>Mirrors the access rules enforced in database/crm.sql</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap text-xs font-semibold">Feature</TableHead>
                  {ROLE_TIERS.map((r) => (<TableHead key={r} className="whitespace-nowrap text-xs font-semibold">{ROLE_LABELS[r]}</TableHead>))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {MATRIX.map((row) => (
                  <TableRow key={row.feature} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-sm font-medium">{row.feature}</TableCell>
                    {ROLE_TIERS.map((r) => (<TableCell key={r} className="whitespace-nowrap"><AccessBadge value={row.access[r]} /></TableCell>))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-5 md:p-6 space-y-2 text-sm text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">Key business rule:</strong> once a manager assigns a lead to a salesperson, ownership transfers — the manager can monitor, warn, and reassign, but can no longer edit that lead's business data or follow-up history.</p>
          <p>Department scoping (House / Condo / Project) applies to Manager and Sales tiers; Admin, Boss, and Super Admin see across all departments.</p>
        </CardContent>
      </Card>
    </div>
  );
}
