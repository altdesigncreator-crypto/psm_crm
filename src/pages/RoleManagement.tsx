import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, ShieldAlert, Check, X, Users2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import {
  ROLE_TIERS, isExec, isAdminOrAbove, isManagerOrAbove, getRoleLabel,
  canViewLead, canEditLead, canDeleteLead, canAssignLead, canAddFollowUp,
  canWarnStaff, canAccessRoute,
  type RoleTier, type CurrentUser,
} from '@/lib/permissions';

type Access = 'yes' | 'no' | 'own' | 'team' | 'branch' | 'view';

const ACCESS_LABEL_KEY: Record<Access, string> = {
  yes: 'roleManagement.access.full', no: 'roleManagement.access.noAccess', own: 'roleManagement.access.ownOnly',
  team: 'roleManagement.access.ownTeam', branch: 'roleManagement.access.department', view: 'roleManagement.access.viewOnly',
};
const ACCESS_STYLE: Record<Access, string> = {
  yes: 'bg-success/10 text-success border-success/20',
  no: 'bg-destructive/10 text-destructive border-destructive/20',
  own: 'bg-info/10 text-info border-info/20',
  team: 'bg-primary/10 text-primary border-primary/20',
  branch: 'bg-warning/10 text-warning border-warning/20',
  view: 'bg-muted text-muted-foreground border-border',
};

// This page used to be a hand-typed table of Access values, which could
// silently drift out of sync with the actual rules in src/lib/permissions.ts
// (the file that already claims to be the "single source of truth"). Every
// row below instead calls the real exported permission functions — the same
// ones every other page in the app uses to gate its own UI — against a
// small set of representative synthetic scenarios, and classifies the
// result. If a rule changes in permissions.ts, this page updates itself
// with it.

const ME = 'me';
const SOMEONE_ELSE = 'someone-else';
const MY_DEPT = 'dept-a';
const OTHER_DEPT = 'dept-b';
const MY_TEAM = 'team-a';
const OTHER_TEAM = 'team-b';

function userFor(role: RoleTier): CurrentUser {
  return { id: ME, role, department: MY_DEPT, managedTeamIds: [MY_TEAM] };
}

// Four scenarios, from narrowest to broadest, so a permission function's
// real behavior can be classified mechanically instead of guessed:
//   ownLead   — a lead this exact user owns
//   teamLead  — someone else's lead, filed under this user's own team
//   deptLead  — someone else's lead, same department but a different team
//   otherLead — a lead in a different department entirely
const ownLead = { ownerId: ME, departmentCode: MY_DEPT, teamId: MY_TEAM };
const teamLead = { ownerId: SOMEONE_ELSE, departmentCode: MY_DEPT, teamId: MY_TEAM };
const deptLead = { ownerId: SOMEONE_ELSE, departmentCode: MY_DEPT, teamId: OTHER_TEAM };
const otherLead = { ownerId: SOMEONE_ELSE, departmentCode: OTHER_DEPT, teamId: OTHER_TEAM };

function classifyLeadAccess(
  role: RoleTier,
  check: (user: CurrentUser, lead: { ownerId: string; departmentCode: string; teamId: string }) => boolean
): Access {
  const user = userFor(role);
  const own = check(user, ownLead);
  const team = check(user, teamLead);
  const dept = check(user, deptLead);
  const other = check(user, otherLead);

  if (own && team && dept && other) return 'yes';
  if (own && team && dept && !other) return 'branch';
  if (own && team && !dept) return 'team';
  if (own && !team) return 'own';
  return 'no';
}

// Same idea for canWarnStaff, which scopes by target person rather than by
// lead: a teammate managed by this user, a colleague in the same
// department but a different team, or someone in a different department.
const teammate = { id: 'teammate', departmentCode: MY_DEPT };
const deptColleague = { id: 'dept-colleague', departmentCode: MY_DEPT };
const strangerInOtherDept = { id: 'stranger', departmentCode: OTHER_DEPT };

function classifyWarnStaffAccess(role: RoleTier): Access {
  const user = userFor(role);
  const managedPersonIds = [teammate.id];
  const own = canWarnStaff(user, teammate, managedPersonIds);
  const dept = canWarnStaff(user, deptColleague, managedPersonIds);
  const other = canWarnStaff(user, strangerInOtherDept, managedPersonIds);

  if (own && dept && other) return 'yes';
  if (own && dept && !other) return 'branch';
  if (own && !dept) return 'team';
  return 'no';
}

function classifyBoolean(fn: (role: RoleTier) => boolean, role: RoleTier): Access {
  return fn(role) ? 'yes' : 'no';
}

// User Management's route is gated by isAdminOrAbove (canAccessRoute), but
// the page itself further restricts Admin to read-only (see UserManagement's
// own `canManageStaff = isExec(role)`) — captured here as 'view' rather than
// pretending the route gate is the whole story.
function classifyStaffManagementAccess(role: RoleTier): Access {
  if (isExec(role)) return 'yes';
  if (isAdminOrAbove(role)) return 'view';
  return 'no';
}

interface MatrixRow {
  feature: string;
  note?: string;
  access: Record<RoleTier, Access>;
}

function buildMatrix(): MatrixRow[] {
  const rowFromLead = (feature: string, check: (u: CurrentUser, l: any) => boolean, note?: string): MatrixRow => ({
    feature,
    note,
    access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyLeadAccess(r, check)])) as Record<RoleTier, Access>,
  });
  const rowFromBoolean = (feature: string, fn: (role: RoleTier) => boolean, note?: string): MatrixRow => ({
    feature,
    note,
    access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyBoolean(fn, r)])) as Record<RoleTier, Access>,
  });

  return [
    rowFromLead('Dashboard', canViewLead, 'Same visibility scope as the lead list — figures shown are drawn from whatever leads a role can see.'),
    rowFromLead('Lead Management (View)', canViewLead),
    rowFromLead('Edit Lead', canEditLead, 'Narrower than viewing for Manager — a manager loses edit rights the moment a lead is handed off to a salesperson.'),
    rowFromLead('Delete Lead', canDeleteLead, 'Admin has no delete rights at all, by design.'),
    rowFromBoolean('Assign / Reassign Lead', (r) => canAssignLead(userFor(r))),
    rowFromLead('Follow-up (Add)', canAddFollowUp, "Manager can only add on a lead they personally own — otherwise view only, via the Pipeline/Lead Management rows above."),
    rowFromLead('Pipeline', canViewLead),
    rowFromLead('Reports', canViewLead),
    { feature: 'Warnings (Issue to Staff)', access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyWarnStaffAccess(r)])) as Record<RoleTier, Access>, note: 'Admin is deliberately not department-scoped here — Admin can warn any staff member, including Managers.' },
    { feature: 'KPI Board', access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyBoolean((role) => canAccessRoute(role, 'kpi-board'), r)])) as Record<RoleTier, Access> },
    { feature: 'Analytics', access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyBoolean((role) => canAccessRoute(role, 'analytics'), r)])) as Record<RoleTier, Access> },
    { feature: 'User Management', access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyStaffManagementAccess(r)])) as Record<RoleTier, Access>, note: "Admin can open the staff directory but can't create, edit, reset passwords, or deactivate accounts." },
    { feature: 'Team Management', access: Object.fromEntries(ROLE_TIERS.map((r) => [r, classifyBoolean((role) => canAccessRoute(role, 'team-management'), r)])) as Record<RoleTier, Access> },
    rowFromBoolean('Department Management', isExec),
    rowFromBoolean('System Settings', isExec, 'Everyone can reach their own profile settings — this row is the exec-only system-configuration section within it.'),
  ];
}

const MATRIX = buildMatrix();

function AccessBadge({ value }: { value: Access }) {
  const { t } = useTranslation();
  const Icon = value === 'no' ? X : value === 'yes' ? Check : Shield;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${ACCESS_STYLE[value]}`}>
      <Icon className="w-3 h-3" /> {t(ACCESS_LABEL_KEY[value])}
    </span>
  );
}

export default function RoleManagement() {
  const { role } = useAuth();
  const { t, lang } = useTranslation();
  usePageHeader(t('roleManagement.pageTitle'), t('roleManagement.subtitle'));

  if (!isExec(role)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-lg font-semibold text-foreground">{t('roleManagement.accessDenied')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">{t('roleManagement.accessDeniedDesc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="md:hidden">
        <h1 className="text-xl md:text-2xl font-semibold text-foreground flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> {t('roleManagement.pageTitle')}</h1>
      </div>

      <Card className="shadow-card rounded-xl border-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Users2 className="w-4 h-4 text-primary" /> {t('roleManagement.permissionMatrix')}</CardTitle>
          <CardDescription>{t('roleManagement.matrixDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent bg-muted/30">
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('roleManagement.feature')}</TableHead>
                  {ROLE_TIERS.map((r) => (<TableHead key={r} className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{getRoleLabel(r, lang)}</TableHead>))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {MATRIX.map((row) => (
                  <TableRow key={row.feature} className="table-row-zebra hover:bg-primary/5 align-top">
                    <TableCell className="whitespace-nowrap text-sm font-medium">
                      {row.feature}
                      {row.note && <p className="text-xs font-normal text-muted-foreground mt-1 max-w-[260px] whitespace-normal leading-snug">{row.note}</p>}
                    </TableCell>
                    {ROLE_TIERS.map((r) => (<TableCell key={r} className="whitespace-nowrap py-3"><AccessBadge value={row.access[r]} /></TableCell>))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-5 md:p-6 space-y-2 text-sm text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">Key business rule:</strong> once a manager assigns a lead to a salesperson, ownership transfers — the manager can monitor and reassign, but can no longer edit that lead's business data or add follow-ups to it.</p>
          <p><strong className="text-foreground">Own team vs. Department:</strong> Manager access is scoped to leads filed under a team they run, which is narrower than the whole department — Admin, Boss, and Super Admin are the tiers scoped at the department level or above.</p>
          <p>Department scoping (House / Condo / Project) applies to Admin and, indirectly, to Manager (via their team's department); Boss and Super Admin see across all departments.</p>
        </CardContent>
      </Card>
    </div>
  );
}
