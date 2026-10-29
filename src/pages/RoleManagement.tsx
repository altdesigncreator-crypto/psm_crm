import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, Crown, Loader2, Lock, MoreHorizontal, Plus, RotateCcw, Shield, ShieldAlert,
  Trash2, Users2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { useProfiles } from '@/hooks/useProfiles';
import AccessChangeList from '@/components/AccessChangeList';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SCOPES, canAccessRoute, canEditRole, diffGrants, getRole, getRoleLabel, maxGrantableScope, roleGrants, roleScope, scopeRank,
  type Grants, type PermissionCategory, type PermissionKey, type PermissionRecord, type RoleRecord, type Scope,
} from '@/lib/permissions';

const CATEGORY_ORDER: PermissionCategory[] = ['leads', 'enquiries', 'staff', 'teams', 'reports', 'system'];

/** A built-in role's factory settings (public.role_defaults). */
interface RoleDefault {
  role_key: string;
  name: string;
  name_mm: string | null;
  rank: number;
  requires_department: boolean;
  grants: Grants;
}

interface Draft {
  name: string;
  name_mm: string;
  description: string;
  rank: number;
  requires_department: boolean;
  grants: Grants;
}

function draftOf(role: RoleRecord): Draft {
  return {
    name: role.name,
    name_mm: role.name_mm ?? '',
    description: role.description ?? '',
    rank: role.rank,
    requires_department: role.requires_department,
    grants: roleGrants(role.key),
  };
}

/** The draft a built-in role would have at its defaults. The description
 * isn't part of the defaults, so it's kept as is. */
function defaultDraftOf(d: RoleDefault, description: string): Draft {
  return { name: d.name, name_mm: d.name_mm ?? '', description, rank: d.rank, requires_department: d.requires_department, grants: d.grants };
}

function sameDraft(a: Draft, b: Draft): boolean {
  const keys = new Set([...Object.keys(a.grants), ...Object.keys(b.grants)]) as Set<PermissionKey>;
  return a.name === b.name && a.name_mm === b.name_mm && a.description === b.description
    && a.rank === b.rank && a.requires_department === b.requires_department
    && [...keys].every((k) => a.grants[k] === b.grants[k]);
}

function slugify(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `role_${slug}`.slice(0, 40);
}

/** Off / Own / Team / Department / All, limited to what the permission
 * supports. Options wider than the editor's own access are disabled. */
function ScopeControl({ permission, value, maxRank, disabled, onChange }: {
  permission: PermissionRecord;
  value: Scope | undefined;
  maxRank: number;
  disabled: boolean;
  onChange: (next: Scope | undefined) => void;
}) {
  const { t } = useTranslation();
  const label = t(`perm.${permission.key}`);

  if (permission.scopes.length === 1) {
    const only = permission.scopes[0];
    const blocked = !value && scopeRank(only) > maxRank;
    return (
      <Switch
        checked={!!value}
        disabled={disabled || blocked}
        onCheckedChange={(on) => onChange(on ? only : undefined)}
        aria-label={label}
        title={blocked ? t('roleManagement.widerThanYours') : undefined}
      />
    );
  }

  const options: (Scope | undefined)[] = [undefined, ...permission.scopes];
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full shrink-0 rounded-lg border border-border bg-muted/40 p-0.5 sm:inline-flex sm:w-auto">
      {options.map((opt) => {
        const selected = value === opt;
        const blocked = !selected && scopeRank(opt) > maxRank;
        return (
          <button
            key={opt ?? 'off'}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || blocked}
            title={blocked ? t('roleManagement.widerThanYours') : t(`roleManagement.scopeHint.${opt ?? 'off'}`)}
            onClick={() => onChange(opt)}
            className={`min-h-9 flex-1 rounded-md px-2 text-xs font-medium transition-colors sm:flex-none sm:px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed ${
              selected
                ? opt ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground'
            }`}
          >
            {t(`roleManagement.scope.${opt ?? 'off'}`)}
          </button>
        );
      })}
    </div>
  );
}

function RoleBadge({ role }: { role: RoleRecord }) {
  const { t } = useTranslation();
  if (role.is_owner) {
    return <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning"><Crown className="h-3 w-3" />{t('roleManagement.owner')}</span>;
  }
  if (role.is_system) {
    return <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{t('roleManagement.builtIn')}</span>;
  }
  return <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{t('roleManagement.custom')}</span>;
}

export default function RoleManagement() {
  const { role: myRole, rbac, refreshRbac } = useAuth();
  const { profiles } = useProfiles();
  const { t, lang } = useTranslation();
  usePageHeader(t('roleManagement.pageTitle'), t('roleManagement.subtitle'));

  const { roles, permissions } = rbac;
  const myRank = getRole(myRole)?.rank ?? Number.MAX_SAFE_INTEGER;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileShowEditor, setMobileShowEditor] = useState(false);
  const selected = roles.find((r) => r.key === selectedKey) ?? null;

  const peopleByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of profiles) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
    return counts;
  }, [profiles]);

  useEffect(() => {
    if (!selectedKey && roles.length) setSelectedKey(roles[0].key);
  }, [roles, selectedKey]);

  // ---- editor state ----
  // rbac is a dependency because roleGrants reads the live catalog.
  const baseline = useMemo(() => (selected ? draftOf(selected) : null), [selected, rbac]);
  // An edit is stored with the role it belongs to, and what's on screen is
  // derived from that — never synced by an effect. Selecting another role
  // can't carry one role's form over to it, read-only roles can never look
  // edited, and a live change by someone else never overwrites unsaved edits.
  const [edit, setEdit] = useState<{ key: string; draft: Draft } | null>(null);
  const draft = edit && edit.key === selectedKey ? edit.draft : baseline;
  const setDraft = (next: Draft) => { if (selectedKey) setEdit({ key: selectedKey, draft: next }); };
  const discardEdit = () => setEdit(null);

  // Where the role sits among the others — a bare number means little.
  const others = roles.filter((r) => r.key !== selectedKey);
  const nextSenior = draft ? others.filter((r) => r.rank < draft.rank).sort((a, b) => b.rank - a.rank)[0] : undefined;
  const nextJunior = draft ? others.filter((r) => r.rank > draft.rank).sort((a, b) => a.rank - b.rank)[0] : undefined;
  const dirty = !!edit && edit.key === selectedKey && !!baseline && !sameDraft(edit.draft, baseline);
  const editable = !!selected && canEditRole(myRole, selected);
  const [saving, setSaving] = useState(false);

  // ---- built-in defaults ----
  const [defaults, setDefaults] = useState<Map<string, RoleDefault>>(new Map());
  useEffect(() => {
    supabase.from('role_defaults').select('role_key, name, name_mm, rank, requires_department, grants').then(({ data }) => {
      setDefaults(new Map((data as RoleDefault[] | null ?? []).map((d) => [d.role_key, d])));
    });
  }, []);
  const roleDefault = selected && !selected.is_owner ? defaults.get(selected.key) : undefined;
  const defaultDraft = roleDefault && draft ? defaultDraftOf(roleDefault, draft.description) : null;
  // Shown while what's on screen (saved or not) isn't the default.
  const differsFromDefault = !!defaultDraft && !!draft && !sameDraft(draft, defaultDraft);
  const resetToDefaults = () => { if (defaultDraft) setDraft(defaultDraft); };

  // ---- switching roles with unsaved changes ----
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const openRole = (key: string) => {
    setSelectedKey(key);
    setMobileShowEditor(true);
  };
  const selectRole = (key: string) => {
    if (key === selectedKey) { setMobileShowEditor(true); return; }
    if (dirty) { setPendingKey(key); return; }
    openRole(key);
  };

  // ---- save, after reviewing exactly what changes ----
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const accessChanges = useMemo(
    () => (baseline && draft ? diffGrants(baseline.grants, draft.grants) : []),
    [baseline, draft],
  );
  const detailChanges = !baseline || !draft ? [] : ([
    ['roleManagement.name', baseline.name, draft.name],
    ['roleManagement.nameMm', baseline.name_mm, draft.name_mm],
    ['roleManagement.description', baseline.description, draft.description],
    ['roleManagement.rank', String(baseline.rank), String(draft.rank)],
    ['roleManagement.requiresDepartment', t(baseline.requires_department ? 'common.yes' : 'common.no'), t(draft.requires_department ? 'common.yes' : 'common.no')],
  ] as const).filter(([, from, to]) => from !== to);
  const removesFromTeams = !!baseline && !!draft && !!baseline.grants['teams.join'] && !draft.grants['teams.join'];
  const unsetsTeamManagers = !!baseline && !!draft && !!baseline.grants['teams.lead'] && !draft.grants['teams.lead'];

  const requestSave = () => {
    if (!draft?.name.trim()) { toast.error(t('roleManagement.nameRequired')); return; }
    if (draft.rank <= myRank) { toast.error(`${t('roleManagement.rankTooSeniorPrefix')} ${myRank}.`); return; }
    setConfirmSaveOpen(true);
  };

  const setGrant = (key: PermissionKey, scope: Scope | undefined) => {
    if (!draft) return;
    const grants = { ...draft.grants };
    if (scope) grants[key] = scope; else delete grants[key];
    setDraft({ ...draft, grants });
  };

  const save = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    const { error } = await supabase.rpc('save_role', {
      p_key: selected.key,
      p_name: draft.name,
      p_name_mm: draft.name_mm,
      p_description: draft.description,
      p_rank: draft.rank,
      p_requires_department: draft.requires_department,
      p_grants: draft.grants,
    });
    if (error) {
      setSaving(false);
      setConfirmSaveOpen(false);
      toast.error(error.message || t('roleManagement.saveError'));
      return;
    }
    // Show the saved version before dropping the local edit — otherwise the
    // old values flash back until the catalog catches up.
    await refreshRbac();
    discardEdit();
    setSaving(false);
    setConfirmSaveOpen(false);
    toast.success(t('roleManagement.saved'));
  };

  // ---- create / duplicate ----
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [startFrom, setStartFrom] = useState<string>('blank');
  const [creating, setCreating] = useState(false);

  const openCreate = (copyFrom?: string) => {
    setNewName(copyFrom ? `${getRoleLabel(copyFrom, 'en')} (${t('roleManagement.copySuffix')})` : '');
    setNewKey(copyFrom ? slugify(`${copyFrom}_copy`) : '');
    setKeyTouched(!!copyFrom);
    setStartFrom(copyFrom ?? 'blank');
    setCreateOpen(true);
  };

  const create = async () => {
    const key = newKey.trim();
    if (!newName.trim() || !/^[a-z][a-z0-9_]{1,39}$/.test(key)) { toast.error(t('roleManagement.keyInvalid')); return; }
    if (roles.some((r) => r.key === key)) { toast.error(t('roleManagement.keyTaken')); return; }
    // Copy only what the creator may grant — the database would refuse more.
    const source = startFrom === 'blank' ? undefined : roles.find((r) => r.key === startFrom);
    const grants: Grants = {};
    if (source) {
      for (const p of permissions) {
        const rank = Math.min(roleScope(source.key, p.key), maxGrantableScope(myRole, p));
        const allowed = p.scopes.filter((s) => scopeRank(s) <= rank);
        if (allowed.length) grants[p.key] = allowed[allowed.length - 1];
      }
    }
    const juniorMost = roles.reduce((max, r) => Math.max(max, r.rank), myRank);
    setCreating(true);
    const { error } = await supabase.rpc('save_role', {
      p_key: key,
      p_name: newName,
      p_name_mm: '',
      p_description: source?.description ?? '',
      p_rank: Math.max(source ? source.rank : juniorMost + 10, myRank + 1),
      p_requires_department: source?.requires_department ?? true,
      p_grants: grants,
    });
    setCreating(false);
    if (error) { toast.error(error.message || t('roleManagement.createError')); return; }
    await refreshRbac();
    toast.success(t('roleManagement.created'));
    setCreateOpen(false);
    setSelectedKey(key);
    setMobileShowEditor(true);
  };

  // ---- delete ----
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectedPeople = selected ? peopleByRole.get(selected.key) ?? 0 : 0;
  const deleteBlockedReason = !selected ? null
    : selected.is_system ? t('roleManagement.deleteBuiltIn')
      : selectedPeople > 0 ? t('roleManagement.deleteInUse')
        : null;

  const remove = async () => {
    if (!selected) return;
    setDeleting(true);
    const { error } = await supabase.from('roles').delete().eq('key', selected.key);
    setDeleting(false);
    setDeleteOpen(false);
    if (error) { toast.error(error.message || t('roleManagement.deleteError')); return; }
    toast.success(t('roleManagement.deleted'));
    setSelectedKey(null);
    setMobileShowEditor(false);
  };

  if (!canAccessRoute(myRole, 'role-management')) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-lg font-semibold text-foreground">{t('roleManagement.accessDenied')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">{t('roleManagement.accessDeniedDesc')}</p>
      </div>
    );
  }

  const byCategory = CATEGORY_ORDER
    .map((c) => ({ category: c, items: permissions.filter((p) => p.category === c) }))
    .filter((g) => g.items.length);

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        {/* ---- Role list ---- */}
        <Card className={`shadow-card rounded-xl border-0 ${mobileShowEditor ? 'hidden lg:block' : ''}`}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <p className="text-sm font-semibold text-foreground">{t('roleManagement.roles')}</p>
              <Button size="sm" className="h-9 gap-1.5" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> {t('roleManagement.newRole')}
              </Button>
            </div>
            <ul className="space-y-1" aria-label={t('roleManagement.roles')}>
              {roles.map((r) => {
                const active = r.key === selectedKey;
                const count = peopleByRole.get(r.key) ?? 0;
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => selectRole(r.key)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active ? 'bg-primary/10' : 'hover:bg-muted/60'}`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {r.is_owner ? <Crown className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{getRoleLabel(r.key, lang)}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">{count} {t('roleManagement.peopleSuffix')}</span>
                      </span>
                      <RoleBadge role={r} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* ---- Role editor ---- */}
        <div className={`min-w-0 space-y-4 ${mobileShowEditor ? '' : 'hidden lg:block'}`}>
          {!selected || !draft ? (
            <Card className="shadow-card rounded-xl border-0">
              <CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Users2 className="h-6 w-6" /> {t('roleManagement.selectRole')}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="shadow-card rounded-xl border-0">
                <CardContent className="p-4 md:p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <Button variant="ghost" size="icon" className="-ml-2 h-10 w-10 shrink-0 lg:hidden" onClick={() => setMobileShowEditor(false)} aria-label={t('roleManagement.backToRoles')}>
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-foreground">{getRoleLabel(selected.key, lang)}</h2>
                        <RoleBadge role={selected} />
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{selected.key} · {selectedPeople} {t('roleManagement.peopleSuffix')}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={t('roleManagement.moreActions')}>
                          <MoreHorizontal className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem className="gap-2 py-2" onClick={() => openCreate(selected.key)}>
                          <Copy className="h-4 w-4" /> {t('roleManagement.duplicate')}
                        </DropdownMenuItem>
                        {editable && differsFromDefault && (
                          <DropdownMenuItem className="gap-2 py-2" onClick={resetToDefaults}>
                            <RotateCcw className="h-4 w-4" /> {t('roleManagement.resetToDefaults')}
                          </DropdownMenuItem>
                        )}
                        {editable && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 py-2 text-destructive focus:text-destructive"
                              disabled={!!deleteBlockedReason}
                              onClick={() => setDeleteOpen(true)}
                            >
                              <Trash2 className="h-4 w-4" /> {t('roleManagement.delete')}
                            </DropdownMenuItem>
                            {deleteBlockedReason && <p className="px-2 pb-2 text-[11px] leading-snug text-muted-foreground">{deleteBlockedReason}</p>}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {(selected.is_owner || !editable) && (
                    <div role="note" className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {selected.is_owner ? t('roleManagement.ownerNote') : t('roleManagement.readOnlyNote')}
                    </div>
                  )}

                  {differsFromDefault && (
                    <div role="status" className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.07] p-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <p className="text-xs leading-relaxed text-foreground">{t('roleManagement.changedFromDefaults')}</p>
                      </div>
                      {editable && (
                        <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" onClick={resetToDefaults}>
                          <RotateCcw className="h-3.5 w-3.5" /> {t('roleManagement.resetToDefaults')}
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="role-name" className="text-xs font-medium text-muted-foreground">{t('roleManagement.name')}</Label>
                      <Input id="role-name" value={draft.name} disabled={!editable} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-11" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="role-name-mm" className="text-xs font-medium text-muted-foreground">{t('roleManagement.nameMm')}</Label>
                      <Input id="role-name-mm" value={draft.name_mm} disabled={!editable} maxLength={60} onChange={(e) => setDraft({ ...draft, name_mm: e.target.value })} className="h-11" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="role-description" className="text-xs font-medium text-muted-foreground">{t('roleManagement.description')}</Label>
                    <Textarea id="role-description" value={draft.description} disabled={!editable} rows={2} placeholder={t('roleManagement.descriptionPlaceholder')} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="role-rank" className="text-xs font-medium text-muted-foreground">{t('roleManagement.rank')}</Label>
                      <Input
                        id="role-rank" type="number" inputMode="numeric" min={myRank + 1} value={draft.rank} disabled={!editable}
                        onChange={(e) => setDraft({ ...draft, rank: Number.parseInt(e.target.value, 10) || 0 })}
                        className="h-11 tabular-nums"
                      />
                      {(nextSenior || nextJunior) && (
                        <p className="text-[11px] font-medium leading-snug text-foreground">
                          {[
                            nextSenior && `${t('roleManagement.moreSenior')}: ${getRoleLabel(nextSenior.key, lang)}`,
                            nextJunior && `${t('roleManagement.moreJunior')}: ${getRoleLabel(nextJunior.key, lang)}`,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      <p className="text-[11px] leading-snug text-muted-foreground">{t('roleManagement.rankHint')}</p>
                    </div>
                    <div className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0">
                        <Label htmlFor="role-dept" className="text-sm font-medium text-foreground">{t('roleManagement.requiresDepartment')}</Label>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('roleManagement.requiresDepartmentHint')}</p>
                      </div>
                      <Switch id="role-dept" checked={draft.requires_department} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, requires_department: v })} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {byCategory.map(({ category, items }) => (
                <Card key={category} className="shadow-card rounded-xl border-0">
                  <CardContent className="p-4 md:p-6">
                    <p className="mb-1 text-sm font-semibold text-foreground">{t(`roleManagement.category.${category}`)}</p>
                    <ul className="divide-y divide-border/60">
                      {items.map((p) => {
                        const value = selected.is_owner ? SCOPES[roleScope(selected.key, p.key) - 1] : draft.grants[p.key];
                        return (
                          <li key={p.key} className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                                {t(`perm.${p.key}`)}
                                {p.kind === 'capability' && (
                                  <span title={t('roleManagement.capabilityHint')} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{t('roleManagement.capability')}</span>
                                )}
                              </p>
                              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                                {lang === 'mm' ? t(`perm.${p.key}.desc`) : p.description}
                              </p>
                            </div>
                            <ScopeControl
                              permission={p}
                              value={value}
                              maxRank={maxGrantableScope(myRole, p)}
                              disabled={!editable}
                              onChange={(next) => setGrant(p.key, next)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ))}

              {/* Spacer so the sticky bar never covers the last row. */}
              {dirty && <div className="h-16" aria-hidden="true" />}
            </>
          )}
        </div>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-4 md:bottom-6 animate-fade-in-up">
          <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-elevated">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t('roleManagement.unsavedChanges')}</p>
            <Button variant="ghost" className="h-10" disabled={saving} onClick={discardEdit}>{t('roleManagement.discard')}</Button>
            <Button className="h-10 gap-1.5" disabled={saving} onClick={requestSave}>
              <Check className="h-4 w-4" /> {t('roleManagement.save')}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmSaveOpen} onOpenChange={(o) => !saving && setConfirmSaveOpen(o)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('roleManagement.confirmSaveTitle')} {selected ? getRoleLabel(selected.key, lang) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedPeople > 0
                ? `${t('roleManagement.confirmSaveAffectsPrefix')} ${selectedPeople} ${t('roleManagement.confirmSaveAffectsSuffix')}`
                : t('roleManagement.confirmSaveNoPeople')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[50dvh] space-y-3 overflow-y-auto">
            {selected?.is_system && (
              <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/[0.07] p-3 text-xs leading-relaxed text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {t('roleManagement.confirmSaveBuiltIn')}
              </p>
            )}
            {(removesFromTeams || unsetsTeamManagers) && selectedPeople > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                {[removesFromTeams && t('roleManagement.confirmSaveLeavesTeams'), unsetsTeamManagers && t('roleManagement.confirmSaveStopsManaging')].filter(Boolean).join(' ')}
              </p>
            )}
            {detailChanges.length > 0 && (
              <ul className="divide-y divide-border/60 rounded-xl border border-border">
                {detailChanges.map(([labelKey, from, to]) => (
                  <li key={labelKey} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{t(labelKey)}</span>
                    <span className="max-w-[35%] truncate text-xs text-muted-foreground">{from || '—'}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="max-w-[35%] truncate text-xs font-medium text-foreground">{to || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
            {accessChanges.length > 0 && <AccessChangeList changes={accessChanges} />}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t('common.cancel')}</AlertDialogCancel>
            <Button disabled={saving} onClick={save} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? t('roleManagement.saving') : t('roleManagement.save')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingKey} onOpenChange={(o) => { if (!o) setPendingKey(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('roleManagement.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('roleManagement.discardBodyPrefix')} {selected ? getRoleLabel(selected.key, lang) : ''} {t('roleManagement.discardBodySuffix')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('roleManagement.keepEditing')}</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                const key = pendingKey;
                setPendingKey(null);
                discardEdit();
                if (key) openRole(key);
              }}
            >
              {t('roleManagement.discard')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('roleManagement.createTitle')}</DialogTitle>
            <DialogDescription>{t('roleManagement.createDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-role-name" className="text-xs font-medium text-muted-foreground">{t('roleManagement.name')}</Label>
              <Input
                id="new-role-name" autoFocus value={newName} maxLength={60} className="h-11"
                onChange={(e) => { setNewName(e.target.value); if (!keyTouched) setNewKey(slugify(e.target.value)); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role-key" className="text-xs font-medium text-muted-foreground">{t('roleManagement.key')}</Label>
              <Input
                id="new-role-key" value={newKey} maxLength={40} className="h-11 font-mono"
                onChange={(e) => { setKeyTouched(true); setNewKey(e.target.value.toLowerCase()); }}
              />
              <p className="text-[11px] leading-snug text-muted-foreground">{t('roleManagement.keyHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{t('roleManagement.startFrom')}</Label>
              <Select value={startFrom} onValueChange={setStartFrom}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">{t('roleManagement.blank')}</SelectItem>
                  {roles.map((r) => (<SelectItem key={r.key} value={r.key}>{getRoleLabel(r.key, lang)}</SelectItem>))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">{t('roleManagement.startFromHint')}</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" disabled={creating} onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button className="h-11 gap-1.5" disabled={creating || !newName.trim() || !newKey.trim()} onClick={create}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('roleManagement.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('roleManagement.deleteTitle')} {selected ? getRoleLabel(selected.key, lang) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>{t('roleManagement.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={remove} className="gap-1.5">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t('roleManagement.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
