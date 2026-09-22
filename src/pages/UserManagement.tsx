import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import NameLink from '@/components/NameLink';
import AvatarCropDialog from '@/components/AvatarCropDialog';
import StorageImage from '@/components/StorageImage';
import { processCapturedImage } from '@/lib/cameraUtils';
import {
  User as UserIcon, Search, Filter, SlidersHorizontal, Download, FileSpreadsheet, FileText,
  Briefcase, Phone, Mail, ShieldAlert, UserPlus, Loader2, Edit2, AlertTriangle, KeyRound, Trash2, Camera,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { exportAsExcel, exportAsCSV } from '@/lib/exportUtils';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';
import { ROLE_TIERS, isExec, isAdminOrAbove, canWarnStaff, getDepartmentLabel, getRoleLabel, type RoleTier, type Department } from '@/lib/permissions';
import { useDepartments } from '@/hooks/useDepartments';
import { useTeams } from '@/hooks/useTeams';
import { WARNING_REASONS, type WarningReason } from '@/types';
import type { Profile } from '@/types';
import { toast } from 'sonner';
import { cacheGet, cacheSetDebounced } from '@/lib/localCache';

const STAFF_CACHE_TTL_MS = 5 * 60 * 1000;
const staffCacheKey = (userId: string) => `staff-directory:${userId}`;

export default function UserManagement() {
  const { user, role } = useAuth();
  const { departments } = useDepartments();
  const { teams, teamsOf, teamsManagedBy, membersOf } = useTeams();
  const { t, lang } = useTranslation();
  usePageHeader(t('userManagement.pageTitle'), t('userManagement.subtitle'));
  const cachedStaff = user ? cacheGet<Profile[]>(staffCacheKey(user.id), STAFF_CACHE_TTL_MS) : undefined;
  const [staff, setStaff] = useState<Profile[]>(cachedStaff ?? []);
  const [loading, setLoading] = useState(cachedStaff === undefined);

  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<RoleTier>('sale');
  const [newDept, setNewDept] = useState<Department>('');
  const [newPassword, setNewPassword] = useState('');

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<RoleTier>('sale');
  const [editDept, setEditDept] = useState<Department>('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [warnTarget, setWarnTarget] = useState<Profile | null>(null);
  const [warningReason, setWarningReason] = useState<WarningReason>('no_activity');
  const [warningMessage, setWarningMessage] = useState('');
  const [savingWarning, setSavingWarning] = useState(false);

  const canManageStaff = isExec(role);
  const canView = isAdminOrAbove(role);

  const managedPersonIds = useMemo(() => {
    if (role !== 'manager' || !user) return [];
    return teamsManagedBy(user.id).flatMap((t) => membersOf(t.id));
  }, [role, user, teamsManagedBy, membersOf]);

  const teamNamesFor = (s: Profile): string[] => {
    const ids = s.role === 'manager' ? teamsManagedBy(s.id).map((t) => t.id) : teamsOf(s.id);
    return ids.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean) as string[];
  };

  useEffect(() => {
    if (!newDept && departments.length > 0) setNewDept(departments[0].code);
  }, [departments, newDept]);

  useEffect(() => {
    if (!canView || !user) return;
    let active = true;
    const writeCache = (list: Profile[]) => { cacheSetDebounced(staffCacheKey(user.id), list); return list; };
    const load = async () => {
      try {
        const chunkSize = 1000;
        const all: Profile[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await supabase.from('profiles').select('*').order('name').range(from, from + chunkSize - 1);
          if (error) throw error;
          const rows = (data || []) as Profile[];
          all.push(...rows);
          if (rows.length < chunkSize) break;
          from += chunkSize;
        }
        if (!active) return;
        setStaff(writeCache(all));
      } catch {
        if (active) toast.error(t('userManagement.loadError'));
      }
      if (active) setLoading(false);
    };
    load();
    const channel = supabase
      .channel('user-management')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, (payload) => {
        const row = payload.new as Profile;
        setStaff((prev) => writeCache(prev.some((s) => s.id === row.id) ? prev : [...prev, row].sort((a, b) => a.name.localeCompare(b.name))));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const row = payload.new as Profile;
        setStaff((prev) => writeCache(prev.map((s) => (s.id === row.id ? row : s)).sort((a, b) => a.name.localeCompare(b.name))));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'profiles' }, (payload) => {
        const oldId = (payload.old as { id: string }).id;
        setStaff((prev) => writeCache(prev.filter((s) => s.id !== oldId)));
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [canView, user?.id]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-lg font-semibold text-foreground">{t('userManagement.accessDenied')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">{t('userManagement.restrictedDesc')}</p>
      </div>
    );
  }

  const filteredStaff = useMemo(() => {
    return staff.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || s.name.toLowerCase().includes(q) || (s.phone || '').includes(searchQuery) || s.email.toLowerCase().includes(q);
      const matchesDept = deptFilter === 'all' || s.department_code === deptFilter;
      const matchesRole = roleFilter === 'all' || s.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchesSearch && matchesDept && matchesRole && matchesStatus;
    });
  }, [staff, searchQuery, deptFilter, roleFilter, statusFilter]);

  const exportRows = filteredStaff.map((s) => ({
    name: s.name, phone: s.phone || '', email: s.email,
    status: s.status, department: s.department_code || '', role: s.role,
  } as any));

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || newPassword.length < 6) {
      toast.error(t('userManagement.requiredFieldsError'));
      return;
    }
    setIsSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('create-staff-user', {
        body: {
          name: newName.trim(), email: newEmail.trim().toLowerCase(), phone: newPhone.trim() || undefined,
          password: newPassword, role: newRole, department: newRole === 'boss' || newRole === 'super_admin' ? null : newDept,
        },
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, t('userManagement.createStaffError')));
      if (data?.error) throw new Error(data.error);

      toast.success(t('userManagement.staffCreatedToast'));
      setNewName(''); setNewEmail(''); setNewPhone(''); setNewPassword(''); setNewRole('sale'); setNewDept(departments[0]?.code || '');
      setIsAddOpen(false);
    } catch (err: any) {
      toast.error(err.message || t('userManagement.createStaffError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRowClick = (s: Profile) => {
    if (!canManageStaff) return;
    setSelectedStaffId(s.id);
    setEditName(s.name);
    setEditPhone(s.phone || '');
    setEditRole(s.role);
    setEditDept(s.department_code || departments[0]?.code || '');
    setEditStatus(s.status);
    setEditAvatarUrl(s.avatar_url || null);
    setResetPassword('');
    setIsEditOpen(true);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedStaffId) return;
    if (!file.type.startsWith('image/')) { toast.error(t('userManagement.imageFileRequired')); if (avatarInputRef.current) avatarInputRef.current.value = ''; return; }
    try {
      const { previewUrl } = await processCapturedImage(file);
      setCropImageSrc(previewUrl);
    } catch {
      setCropImageSrc(URL.createObjectURL(file));
    }
  };

  const handleAvatarCropped = async (blob: Blob) => {
    if (!selectedStaffId) return;
    setUploadingAvatar(true);
    try {
      const path = `${selectedStaffId}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, blob);
      if (uploadErr) throw uploadErr;
      const avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;

      const { error } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', selectedStaffId);
      if (error) throw error;

      setEditAvatarUrl(avatarUrl);
      toast.success(t('userManagement.photoUpdatedToast'));
      setCropImageSrc(null);
    } catch {
      toast.error(t('userManagement.photoUpdateError'));
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleOpenWarn = (e: React.MouseEvent, s: Profile) => {
    e.stopPropagation();
    setWarnTarget(s);
    setWarningReason('no_activity');
    setWarningMessage('');
  };

  const handleIssueWarning = async () => {
    if (!warnTarget || !user) return;
    setSavingWarning(true);
    const { error } = await supabase.from('warnings').insert({
      lead_id: null, issued_to: warnTarget.id, issued_by: user.id,
      reason: warningReason, message: warningMessage.trim() || null,
    });
    setSavingWarning(false);
    if (error) { toast.error(error.message || t('userManagement.issueWarningError')); return; }
    toast.success(`${t('userManagement.warningIssuedToastPrefix')} ${warnTarget.name}${t('userManagement.warningIssuedToastSuffix')}.`);
    setWarnTarget(null);
  };

  const handleResetPassword = async () => {
    if (resetPassword.length < 6) { toast.error(t('userManagement.pwTooShort')); return; }
    setIsResetting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('reset-staff-password', {
        body: { userId: selectedStaffId, newPassword: resetPassword },
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, t('userManagement.resetPasswordError')));
      if (data?.error) throw new Error(data.error);
      toast.success(`${t('userManagement.pwResetForToast')} ${data?.name || editName}.`);
      setResetPassword('');
    } catch (err: any) {
      toast.error(err.message || t('userManagement.resetPasswordError'));
    } finally {
      setIsResetting(false);
    }
  };

  const handleDeleteStaff = async () => {
    setIsDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('delete-staff-user', {
        body: { userId: selectedStaffId },
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, t('userManagement.deleteAccountError')));
      if (data?.error) throw new Error(data.error);
      toast.success(`${data?.name || editName}${t('userManagement.accountDeletedToastSuffix')}`);
      setDeleteConfirmOpen(false);
      setIsEditOpen(false);
    } catch (err: any) {
      toast.error(err.message || t('userManagement.deleteAccountError'));
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) { toast.error(t('userManagement.nameRequired')); return; }
    setIsUpdating(true);
    const { error } = await supabase.from('profiles').update({
      name: editName.trim(), phone: editPhone.trim() || null, role: editRole,
      department_code: editRole === 'boss' || editRole === 'super_admin' ? null : editDept,
      status: editStatus,
    }).eq('id', selectedStaffId);
    setIsUpdating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('userManagement.staffUpdatedToast'));
    setIsEditOpen(false);
  };

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between md:justify-end gap-4 border-b border-border/60 pb-5">
        <div className="md:hidden">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground">{t('userManagement.pageTitle')}</h1>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={filteredStaff.length === 0} className="h-11 border-border bg-card font-medium transition-all duration-200 shrink-0 gap-2 hover:bg-muted active:scale-[0.98]">
                <Download className="w-4 h-4 text-muted-foreground" /> {t('common.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 shadow-md rounded-lg">
              <DropdownMenuItem onClick={() => exportAsExcel(exportRows)} className="gap-2 cursor-pointer py-2 text-sm"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsCSV(exportRows)} className="gap-2 cursor-pointer py-2 text-sm"><FileText className="w-4 h-4 text-blue-600" /> CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {canManageStaff && (
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 shadow-sm hover:shadow-md shrink-0 gap-2 active:scale-[0.98]">
                <UserPlus className="w-4 h-4" /> {t('userManagement.addStaff')}
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0 max-h-[85dvh] overflow-y-auto">
              <DialogHeader className="pb-4 border-b border-border/60">
                <DialogTitle className="text-base font-semibold flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> {t('userManagement.addNewStaff')}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddStaff} className="space-y-4 mt-5">
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{t('settings.name')}</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} required className="h-11" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{t('userManagement.emailLogin')}</Label><Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required className="h-11" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{t('common.phone')}</Label><Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="h-11" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{t('userManagement.passwordLogin')}</Label><Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('settings.atLeast6Chars')} required className="h-11" /></div>
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.role')}</Label>
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as RoleTier)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLE_TIERS.map((r) => (<SelectItem key={r} value={r}>{getRoleLabel(r, lang)}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  {/* Admin is department-scoped like Manager — department required */}
                  {newRole !== 'boss' && newRole !== 'super_admin' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.department')}</Label>
                      <Select value={newDept} onValueChange={(v) => setNewDept(v)}>
                        <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
                  <DialogClose asChild><Button type="button" variant="outline" className="flex-1 h-11">{t('common.cancel')}</Button></DialogClose>
                  <Button type="submit" disabled={isSaving} className="flex-1 h-11 gradient-primary text-white font-medium">{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('userManagement.create')}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0 max-h-[85dvh] overflow-y-auto">
          <DialogHeader className="pb-4 border-b border-border/60">
            <DialogTitle className="text-base font-semibold flex items-center gap-2"><Edit2 className="w-4 h-4 text-primary" /> {t('userManagement.editStaffProfile')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateStaff} className="space-y-4 mt-5">
            <div className="flex items-center gap-4">
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative w-16 h-16 rounded-full shrink-0 group"
                aria-label={t('settings.changePhoto')}
              >
                {editAvatarUrl ? (
                  <StorageImage src={editAvatarUrl} alt={editName} className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"><UserIcon className="w-8 h-8 text-primary" /></div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  {uploadingAvatar && <Loader2 className="w-5 h-5 text-white animate-spin" />}
                </div>
                {!uploadingAvatar && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center border-2 border-card">
                    <Camera className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
              <p className="text-xs text-muted-foreground flex-1">{t('userManagement.changePhotoHint')}</p>
            </div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{t('settings.name')}</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} required className="h-11" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-medium text-muted-foreground">{t('common.phone')}</Label><Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-11" /></div>
            <div className="grid grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.role')}</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as RoleTier)}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLE_TIERS.map((r) => (<SelectItem key={r} value={r}>{getRoleLabel(r, lang)}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              {editRole !== 'boss' && editRole !== 'super_admin' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.department')}</Label>
                  <Select value={editDept} onValueChange={(v) => setEditDept(v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.status')}</Label>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as 'active' | 'inactive')}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">{t('profile.active')}</SelectItem><SelectItem value="inactive">{t('profile.inactive')}</SelectItem></SelectContent>
              </Select>
            </div>

            {/* Password reset — exec only (this page already is). Any staff
                role can be targeted, including Boss/Super Admin. */}
            <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3.5 mt-1">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-warning" /> {t('userManagement.resetPassword')}
              </Label>
              <p className="text-[11px] text-muted-foreground">{t('userManagement.resetPasswordDesc')}</p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder={t('userManagement.newPasswordPlaceholder')}
                  className="h-11 flex-1"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isResetting || resetPassword.length < 6}
                  onClick={handleResetPassword}
                  className="h-11 shrink-0 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning gap-1.5"
                >
                  {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  {t('userManagement.reset')}
                </Button>
              </div>
            </div>

            {/* Danger zone — same target rule as password reset: only
                Admin/Manager/Sales accounts, enforced server-side too. */}
            {(editRole === 'admin' || editRole === 'manager' || editRole === 'sale') && (
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" /> {t('userManagement.deleteAccount')}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {t('userManagement.deleteAccountDesc')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> {t('userManagement.deleteThisStaff')}
                </Button>
              </div>
            )}

            <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
              <DialogClose asChild><Button type="button" variant="outline" className="flex-1 h-11">{t('common.cancel')}</Button></DialogClose>
              <Button type="submit" disabled={isUpdating} className="flex-1 h-11 gradient-primary text-white font-medium">{isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : t('userManagement.saveChanges')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AvatarCropDialog
        imageSrc={cropImageSrc}
        onCancel={() => { setCropImageSrc(null); if (avatarInputRef.current) avatarInputRef.current.value = ''; }}
        onCropped={handleAvatarCropped}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => !isDeleting && setDeleteConfirmOpen(open)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{lang === 'mm' ? <>{editName}{t('userManagement.deleteAccountTitleSuffix')}</> : <>{t('userManagement.deleteAccountTitlePrefix')} {editName}{t('userManagement.deleteAccountTitleSuffix')}</>}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('userManagement.deleteAccountConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => { e.preventDefault(); handleDeleteStaff(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {isDeleting ? t('leads.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/80" />
              <Input placeholder={t('userManagement.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 h-11 bg-muted/30 focus-visible:bg-background" />
            </div>
            <div className="flex gap-2 items-center">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" className="md:hidden flex h-11 px-3.5 gap-2 border-border">
                    <SlidersHorizontal className="w-4 h-4 text-muted-foreground" /> <span className="text-sm">{t('leads.filters')}</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl border-t border-border px-6 pt-5 pb-8 max-h-[85dvh] overflow-y-auto">
                  <SheetHeader className="pb-4 border-b border-border/40"><SheetTitle className="text-base font-semibold flex items-center gap-2"><Filter className="w-4 h-4 text-primary" /> {t('leads.filters')}</SheetTitle></SheetHeader>
                  <div className="space-y-4 mt-4">
                    <FilterSelect label={t('userManagement.department')} value={deptFilter} onChange={setDeptFilter} options={[['all', t('userManagement.allDepartments')], ...departments.map((d) => [d.code, d.name] as [string, string])]} />
                    <FilterSelect label={t('userManagement.role')} value={roleFilter} onChange={setRoleFilter} options={[['all', t('userManagement.allRoles')], ...ROLE_TIERS.map((r) => [r, getRoleLabel(r, lang)] as [string, string])]} />
                    <FilterSelect label={t('userManagement.status')} value={statusFilter} onChange={setStatusFilter} options={[['all', t('userManagement.allStatuses')], ['active', t('profile.active')], ['inactive', t('profile.inactive')]]} />
                    <SheetClose asChild><Button className="w-full h-11 font-medium mt-3">{t('common.done')}</Button></SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
              <div className="hidden md:flex gap-2">
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card"><Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" /><SelectValue placeholder={t('userManagement.department')} /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t('userManagement.allDepartments')}</SelectItem>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card"><UserIcon className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" /><SelectValue placeholder={t('userManagement.role')} /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t('userManagement.allRoles')}</SelectItem>{ROLE_TIERS.map((r) => (<SelectItem key={r} value={r}>{getRoleLabel(r, lang)}</SelectItem>))}</SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[145px] h-11 bg-card"><Briefcase className="w-3.5 h-3.5 mr-1.5 text-muted-foreground/70" /><SelectValue placeholder={t('userManagement.status')} /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t('userManagement.allStatuses')}</SelectItem><SelectItem value="active">{t('profile.active')}</SelectItem><SelectItem value="inactive">{t('profile.inactive')}</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
            <UserIcon className="w-4 h-4 text-muted-foreground/80" /> {t('userManagement.allStaff')}
            <span className="text-xs font-medium text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full ml-1">{filteredStaff.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full max-w-full overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-52 gap-2 text-muted-foreground"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
            ) : filteredStaff.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 text-muted-foreground bg-muted/5"><ShieldAlert className="w-9 h-9 mb-2 opacity-40" /><p className="text-sm font-medium">{t('userManagement.noStaffMatchFilters')}</p></div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('userManagement.nameCol')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('common.phone')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('common.email')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('userManagement.department')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('userManagement.teamsCol')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('userManagement.role')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground">{t('userManagement.status')}</TableHead>
                    <TableHead className="whitespace-nowrap px-6 h-11 text-xs font-semibold text-muted-foreground text-right">{t('userManagement.actionsCol')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((s) => (
                    <TableRow key={s.id} className={`table-row-zebra border-b border-border/40 transition-colors duration-150 hover:bg-primary/5 ${canManageStaff ? 'cursor-pointer' : ''}`} onClick={() => handleRowClick(s)}>
                      <TableCell className="whitespace-nowrap px-6 py-2.5 text-sm font-medium text-foreground"><NameLink id={s.id} name={s.name} avatarUrl={s.avatar_url} /></TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-2.5 text-sm text-muted-foreground tabular-nums"><Phone className="w-3.5 h-3.5 inline mr-1.5 opacity-60" />{s.phone || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-2.5 text-sm text-muted-foreground"><Mail className="w-3.5 h-3.5 inline mr-1.5 opacity-60" />{s.email}</TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-2.5 text-sm text-foreground/80">{getDepartmentLabel(s.department_code)}</TableCell>
                      <TableCell className="px-6 py-2.5 text-sm text-foreground/80">
                        {teamNamesFor(s).length === 0 ? '—' : (
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {teamNamesFor(s).map((name) => (
                              <span key={name} className="text-[11px] px-1.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground whitespace-nowrap">{name}</span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-2.5 text-sm font-medium"><span className="text-xs px-2 py-0.5 font-semibold uppercase tracking-wider rounded border border-primary/20 bg-primary/5 text-primary">{getRoleLabel(s.role, lang)}</span></TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.status === 'active' ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20' : 'bg-destructive/5 text-destructive border-destructive/20'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'active' ? 'bg-emerald-500' : 'bg-destructive'}`} /> {s.status === 'active' ? t('profile.active') : t('profile.inactive')}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-6 py-2.5 text-right">
                        {canWarnStaff({ id: user?.id || '', role, department: user?.department ?? null }, { id: s.id, departmentCode: s.department_code }, managedPersonIds) && s.id !== user?.id && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-8 gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                            onClick={(e) => handleOpenWarn(e, s)}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" /> {t('userManagement.warn')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!warnTarget} onOpenChange={(open) => !open && setWarnTarget(null)}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md rounded-xl p-6 border border-border/60 shadow-xl bg-card gap-0 max-h-[85dvh] overflow-y-auto">
          <DialogHeader className="pb-4 border-b border-border/60">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" /> {t('userManagement.warnPrefix')} {warnTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-5">
            <p className="text-xs text-muted-foreground -mt-2">
              {warnTarget ? getRoleLabel(warnTarget.role, lang) : ''} · {getDepartmentLabel(warnTarget?.department_code)} {t('userManagement.generalWarningNote')}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.reason')}</Label>
              <Select value={warningReason} onValueChange={(v) => setWarningReason(v as WarningReason)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{WARNING_REASONS.map((r) => (<SelectItem key={r.value} value={r.value}>{t(`warningReason.${r.value}`)}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{t('userManagement.messageOptional')}</Label>
              <textarea
                value={warningMessage}
                onChange={(e) => setWarningMessage(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={t('userManagement.warningDetailsPlaceholder')}
              />
            </div>
            <div className="flex gap-3 pt-5 mt-2 border-t border-border/60">
              <DialogClose asChild><Button type="button" variant="outline" className="flex-1 h-11">{t('common.cancel')}</Button></DialogClose>
              <Button type="button" variant="destructive" disabled={savingWarning} onClick={handleIssueWarning} className="flex-1 h-11 gap-2 font-medium">
                {savingWarning ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} {t('userManagement.issueWarning')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => (<SelectItem key={v} value={v}>{l}</SelectItem>))}</SelectContent>
      </Select>
    </div>
  );
}
