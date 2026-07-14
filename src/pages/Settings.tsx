import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getRoleLabel, getDepartmentLabel, isExec } from '@/lib/permissions';
import { useDepartments } from '@/hooks/useDepartments';
import {
  isPlatformAuthenticatorAvailable, isBiometricEnabledFor, registerBiometric, disableBiometric,
} from '@/lib/biometricAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, User, Mail, Shield, Building2, Moon, Bell, Info, ChevronDown, Phone, MapPin,
  HeartHandshake, Globe, Save, Loader2, SettingsIcon, Plus, FingerprintPattern, KeyRound, Eye, EyeOff, Trash2, Edit2,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/contexts/TranslationContext';
import { toast } from 'sonner';

export default function Settings() {
  const navigate = useNavigate();
  const { lang, setLang, t } = useTranslation();
  const { user, role, department, refreshProfile } = useAuth();
  const { departments, createDepartment, updateDepartment, deleteDepartment, deactivateDepartment } = useDepartments();

  const [name, setName] = useState(user?.name || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [darkMode, setDarkMode] = useState(document.documentElement.classList.contains('dark'));
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [openSection, setOpenSection] = useState<'profile' | 'preferences' | 'system' | null>('profile');

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(user ? isBiometricEnabledFor(user.id) : false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBiometricSupported);
  }, []);

  const [attendanceSettings, setAttendanceSettings] = useState<Record<string, { window_start: string; window_end: string }>>({});
  const [savingAttendance, setSavingAttendance] = useState(false);

  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [editingDeptCode, setEditingDeptCode] = useState<string | null>(null);
  const [editingDeptName, setEditingDeptName] = useState('');
  const [savingDeptEdit, setSavingDeptEdit] = useState(false);
  const [deptDeleteTarget, setDeptDeleteTarget] = useState<{ code: string; name: string } | null>(null);
  const [deletingDept, setDeletingDept] = useState(false);

  useEffect(() => {
    if (!isExec(role)) return;
    (async () => {
      const { data } = await supabase.from('attendance_settings').select('*');
      const map: Record<string, { window_start: string; window_end: string }> = {};
      (data || []).forEach((row: any) => { map[row.department_code] = { window_start: row.window_start, window_end: row.window_end }; });
      setAttendanceSettings(map);
    })();
  }, [role]);

  const toggleSection = (section: 'profile' | 'preferences' | 'system') => setOpenSection((prev) => (prev === section ? null : section));

  const handleToggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setIsUpdating(true);
    const { error } = await supabase.from('profiles').update({ name: name.trim(), phone: phoneNumber.trim() || null }).eq('id', user.id);
    setIsUpdating(false);
    if (error) { toast.error('Could not update profile.'); return; }
    await refreshProfile();
    toast.success('Profile updated.');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    if (pwNew.length < 6) { toast.error('New password must be at least 6 characters.'); return; }
    if (pwNew !== pwConfirm) { toast.error('New passwords do not match.'); return; }
    if (pwNew === pwCurrent) { toast.error('New password must be different from the current one.'); return; }

    setChangingPw(true);
    try {
      // Supabase's updateUser doesn't ask for the old password, so verify it
      // ourselves by re-authenticating before allowing the change.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwCurrent });
      if (verifyErr) { toast.error('Current password is incorrect.'); return; }

      const { error } = await supabase.auth.updateUser({ password: pwNew });
      if (error) { toast.error(error.message || 'Could not change the password.'); return; }

      await supabase.from('audit_logs').insert({ action: 'password_changed', target_table: 'profiles', target_id: user.id, performed_by: user.id });
      toast.success('Password changed.');
      setPwCurrent(''); setPwNew(''); setPwConfirm(''); setShowPw(false);
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.email) return;
    if (!deletePassword) { toast.error('Enter your password to confirm.'); return; }
    setIsDeletingAccount(true);
    try {
      // Confirm it's really the account owner at the keyboard.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: deletePassword });
      if (verifyErr) { toast.error('Password is incorrect.'); return; }

      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('delete-my-account', {
        body: {},
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not delete your account.');

      disableBiometric(user.id);
      toast.success('Your account has been deleted.');
      // Plain signOut (not context logout) — the profile row is gone, so the
      // audit-logged logout would fail its foreign key.
      await supabase.auth.signOut();
    } catch (err: any) {
      toast.error(err.message || 'Could not delete your account.');
    } finally {
      setIsDeletingAccount(false);
      setDeleteAccountOpen(false);
      setDeletePassword('');
    }
  };

  const handleSaveAttendance = async (deptCode: string) => {
    const settings = attendanceSettings[deptCode];
    if (!settings) return;
    setSavingAttendance(true);
    const { error } = await supabase.from('attendance_settings').update({
      window_start: settings.window_start, window_end: settings.window_end, updated_by: user?.id,
    }).eq('department_code', deptCode);
    setSavingAttendance(false);
    if (error) { toast.error('Could not save attendance window.'); return; }
    toast.success(`${getDepartmentLabel(deptCode)} check-in window updated.`);
  };

  const handleToggleBiometric = async () => {
    if (!user) return;
    if (biometricEnabled) {
      disableBiometric(user.id);
      setBiometricEnabled(false);
      toast.success('Face ID / Fingerprint unlock disabled on this device.');
      return;
    }
    setBiometricBusy(true);
    try {
      await registerBiometric(user.id, user.email, user.name);
      setBiometricEnabled(true);
      toast.success('Face ID / Fingerprint unlock enabled on this device.');
    } catch (err: any) {
      toast.error(err?.message || 'Could not set up biometric unlock.');
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleRenameDepartment = async (code: string) => {
    if (!editingDeptName.trim()) { toast.error('Enter a department name.'); return; }
    setSavingDeptEdit(true);
    const error = await updateDepartment(code, editingDeptName);
    setSavingDeptEdit(false);
    if (error) { toast.error(error.message || 'Could not rename the department.'); return; }
    toast.success('Department renamed.');
    setEditingDeptCode(null);
  };

  const handleDeleteDepartment = async () => {
    if (!deptDeleteTarget) return;
    const { code, name } = deptDeleteTarget;
    setDeletingDept(true);
    try {
      // Current staff or leads in the department block deletion — those must
      // be moved deliberately, not orphaned.
      const [{ count: staffCount }, { count: leadCount }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('department_code', code),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('department_code', code),
      ]);
      if ((staffCount ?? 0) > 0 || (leadCount ?? 0) > 0) {
        toast.error(`Cannot delete ${name} — ${staffCount ?? 0} staff and ${leadCount ?? 0} leads still belong to it. Move them to another department first.`);
        return;
      }

      const error = await deleteDepartment(code);
      if (error) {
        // FK violation: historical rows (old check-ins etc.) still reference
        // the code — deactivate instead so history keeps its labels.
        if ((error as { code?: string }).code === '23503') {
          const softErr = await deactivateDepartment(code);
          if (softErr) { toast.error(softErr.message || 'Could not remove the department.'); return; }
          toast.success(`${name} had historical records, so it was deactivated instead — it no longer appears anywhere in the app.`);
        } else {
          toast.error(error.message || 'Could not delete the department.');
          return;
        }
      } else {
        toast.success(`${name} department deleted.`);
      }
      await supabase.from('audit_logs').insert({
        action: 'department_deleted',
        target_table: 'departments',
        performed_by: user?.id,
        old_value: { code, name },
      });
    } finally {
      setDeletingDept(false);
      setDeptDeleteTarget(null);
    }
  };

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptCode.trim() || !newDeptName.trim()) { toast.error('Enter both a code and a name.'); return; }
    setSavingDept(true);
    const error = await createDepartment(newDeptCode, newDeptName);
    setSavingDept(false);
    if (error) { toast.error(error.message || 'Could not add department — code may already exist.'); return; }
    toast.success(`${newDeptName.trim()} department added.`);
    setNewDeptCode('');
    setNewDeptName('');
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Profile and system preferences</p>
        </div>
      </div>

      <div className="md:hidden">
        <button type="button" onClick={() => toggleSection('profile')} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-all text-left">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><User className="w-4 h-4 text-primary" /></div>
            <div><p className="text-sm font-semibold text-foreground">Profile</p><p className="text-xs text-muted-foreground">{user?.email || '—'}</p></div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openSection === 'profile' ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <Card className="shadow-card rounded-xl border-0 md:block" style={{ display: openSection === 'profile' ? 'block' : undefined }}>
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><User className="w-4 h-4 text-primary" /></div>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="w-7 h-7 text-primary" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-foreground truncate">{user?.name || '—'}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">{getRoleLabel(role)}</span>
                {department && <span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">{getDepartmentLabel(department)}</span>}
              </div>
            </div>
          </div>
          <Separator />
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="space-y-2"><Label className="text-sm font-medium">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="space-y-2"><Label className="text-sm font-medium">Phone</Label><Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="09xxxxxxxxx" /></div>
            <Button type="submit" disabled={isUpdating} className="w-full sm:w-auto h-10 gradient-primary text-white gap-2 mt-2">
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
            </Button>
          </form>
          <Separator />
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center"><KeyRound className="w-4 h-4 text-warning" /></div>
              <p className="text-sm font-semibold text-foreground">Change Password</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Current password</Label>
              <Input type={showPw ? 'text' : 'password'} value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">New password</Label>
              <div className="relative">
                <Input type={showPw ? 'text' : 'password'} value={pwNew} onChange={(e) => setPwNew(e.target.value)} required minLength={6} autoComplete="new-password" className="pr-12" placeholder="At least 6 characters" />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 min-h-0 flex items-center justify-center rounded-full text-muted-foreground"
                  aria-label={showPw ? 'Hide passwords' : 'Show passwords'}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Confirm new password</Label>
              <Input type={showPw ? 'text' : 'password'} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} required minLength={6} autoComplete="new-password" />
            </div>
            <Button type="submit" disabled={changingPw || !pwCurrent || !pwNew || !pwConfirm} className="w-full sm:w-auto h-10 gap-2 mt-2" variant="outline">
              {changingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              {changingPw ? 'Changing…' : 'Change Password'}
            </Button>
          </form>
          <Separator />
          <div className="space-y-1 bg-muted/30 rounded-xl p-2">
            {[
              { icon: Mail, label: 'Email (cannot be changed)', value: user?.email || '—' },
              { icon: Shield, label: 'Role', value: getRoleLabel(role) },
              { icon: Building2, label: 'Department', value: department ? getDepartmentLabel(department) : 'All departments' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 p-2.5 rounded-lg min-h-[48px]">
                <item.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0"><p className="text-xs text-muted-foreground">{item.label}</p><p className="text-sm font-medium text-foreground/70 break-words">{item.value}</p></div>
              </div>
            ))}
          </div>

          {/* Danger zone — the Boss account can't self-delete; a Super Admin
              can, unless they're the last executive (server enforces both). */}
          {role !== 'boss' && (
            <>
              <Separator />
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4 text-destructive" /> Delete Account
                </p>
                <p className="text-xs text-muted-foreground">
                  Permanently deletes your login, check-ins and notifications. Leads you own must be
                  reassigned by your manager first. This cannot be undone.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteAccountOpen(true)}
                  className="w-full sm:w-auto h-10 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> Delete my account
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete-account confirmation — requires the password */}
      <AlertDialog open={deleteAccountOpen} onOpenChange={(open) => { if (!isDeletingAccount) { setDeleteAccountOpen(open); if (!open) setDeletePassword(''); } }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your login is removed permanently, along with your check-ins and notifications.
              This cannot be undone. Enter your password to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            className="h-11"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingAccount}>Cancel</AlertDialogCancel>
            <Button
              disabled={isDeletingAccount || !deletePassword}
              onClick={handleDeleteAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10"
            >
              {isDeletingAccount ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {isDeletingAccount ? 'Deleting…' : 'Delete forever'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="md:hidden">
        <button type="button" onClick={() => toggleSection('preferences')} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-all text-left">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Moon className="w-4 h-4 text-primary" /></div>
            <div><p className="text-sm font-semibold text-foreground">Preferences</p><p className="text-xs text-muted-foreground">Theme, language, notifications</p></div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openSection === 'preferences' ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <Card className="shadow-card rounded-xl border-0 md:block" style={{ display: openSection === 'preferences' ? 'block' : undefined }}>
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Moon className="w-4 h-4 text-primary" /></div>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <button type="button" onClick={() => setLang(lang === 'mm' ? 'en' : 'mm')} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-info/10 flex items-center justify-center shrink-0"><Globe className="w-5 h-5 text-info" /></div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t('settings.language')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.languageDesc')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-medium px-2 py-1 rounded-full border ${lang === 'mm' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'}`}>MM</span>
              <span className={`text-xs font-medium px-2 py-1 rounded-full border ${lang === 'en' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'}`}>EN</span>
            </div>
          </button>

          <button type="button" onClick={handleToggleDarkMode} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Moon className="w-5 h-5 text-primary" /></div>
              <div><p className="text-sm font-semibold text-foreground">Dark Mode</p></div>
            </div>
            <div className={`w-12 h-7 rounded-full transition-colors relative ${darkMode ? 'bg-primary' : 'bg-muted'}`}><div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${darkMode ? 'left-6' : 'left-1'}`} /></div>
          </button>

          <button type="button" onClick={() => setNotificationsEnabled((v) => !v)} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><Bell className="w-5 h-5 text-success" /></div>
              <div><p className="text-sm font-semibold text-foreground">Notifications</p></div>
            </div>
            <div className={`w-12 h-7 rounded-full transition-colors relative ${notificationsEnabled ? 'bg-success' : 'bg-muted'}`}><div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${notificationsEnabled ? 'left-6' : 'left-1'}`} /></div>
          </button>

          {biometricSupported && (
            <button
              type="button"
              onClick={handleToggleBiometric}
              disabled={biometricBusy}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px] disabled:opacity-60"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  {biometricBusy ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : <FingerprintPattern className="w-5 h-5 text-primary" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Face ID / Fingerprint Sign-in</p>
                  <p className="text-xs text-muted-foreground">Sign back in with biometrics instead of your password on this device</p>
                </div>
              </div>
              <div className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${biometricEnabled ? 'bg-primary' : 'bg-muted'}`}><div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${biometricEnabled ? 'left-6' : 'left-1'}`} /></div>
            </button>
          )}
        </CardContent>
      </Card>

      {isExec(role) && (
        <>
          <div className="md:hidden">
            <button type="button" onClick={() => toggleSection('system')} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-all text-left">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><SettingsIcon className="w-4 h-4 text-primary" /></div>
                <div><p className="text-sm font-semibold text-foreground">System Configuration</p><p className="text-xs text-muted-foreground">Check-in windows per department</p></div>
              </div>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openSection === 'system' ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <Card className="shadow-card rounded-xl border-0 md:block" style={{ display: openSection === 'system' ? 'block' : undefined }}>
            <CardHeader className="pb-3 hidden md:flex">
              <CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><SettingsIcon className="w-4 h-4 text-primary" /></div>System Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Departments</p>
                <p className="text-xs text-muted-foreground">Add, rename or delete departments — changes apply immediately to every department picker across the app (leads, staff, check-ins, filters).</p>
                <form onSubmit={handleAddDepartment} className="flex flex-col sm:flex-row gap-2">
                  <Input placeholder="Code (e.g. commercial)" value={newDeptCode} onChange={(e) => setNewDeptCode(e.target.value)} className="h-10 sm:w-40" />
                  <Input placeholder="Display name (e.g. Commercial)" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} className="h-10 flex-1" />
                  <Button type="submit" disabled={savingDept} size="sm" className="h-10 gap-1.5 shrink-0">
                    {savingDept ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
                  </Button>
                </form>
                <div className="space-y-2">
                  {departments.map((d) => (
                    <div key={d.code} className="flex items-center gap-2 p-2.5 rounded-xl border border-border">
                      {editingDeptCode === d.code ? (
                        <>
                          <Input
                            value={editingDeptName}
                            onChange={(e) => setEditingDeptName(e.target.value)}
                            className="h-10 flex-1"
                            autoFocus
                          />
                          <Button size="sm" disabled={savingDeptEdit} onClick={() => handleRenameDepartment(d.code)} className="h-10 shrink-0">
                            {savingDeptEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={savingDeptEdit} onClick={() => setEditingDeptCode(null)} className="h-10 shrink-0">
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                            <p className="text-[11px] text-muted-foreground">code: {d.code}</p>
                          </div>
                          <Button variant="ghost" size="icon" aria-label={`Rename ${d.name}`} className="h-10 w-10 min-h-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => { setEditingDeptCode(d.code); setEditingDeptName(d.name); }}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} className="h-10 w-10 min-h-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeptDeleteTarget({ code: d.code, name: d.name })}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Check-in Windows</p>
                <p className="text-xs text-muted-foreground">Configure the allowed daily check-in time window per department. Check-ins after the window end are automatically flagged as late.</p>
                {departments.map((d) => (
                  <div key={d.code} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border">
                    <span className="text-sm font-medium text-foreground w-28 shrink-0 truncate">{d.name}</span>
                    <Input type="time" value={attendanceSettings[d.code]?.window_start || '07:00'} onChange={(e) => setAttendanceSettings((prev) => ({ ...prev, [d.code]: { window_start: e.target.value, window_end: prev[d.code]?.window_end || '10:00' } }))} className="h-10" />
                    <span className="text-xs text-muted-foreground shrink-0">to</span>
                    <Input type="time" value={attendanceSettings[d.code]?.window_end || '10:00'} onChange={(e) => setAttendanceSettings((prev) => ({ ...prev, [d.code]: { window_start: prev[d.code]?.window_start || '07:00', window_end: e.target.value } }))} className="h-10" />
                    <Button size="sm" disabled={savingAttendance} onClick={() => handleSaveAttendance(d.code)} className="shrink-0">Save</Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Info className="w-4 h-4 text-primary" /></div>Company Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card min-h-[52px]">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-primary" /></div>
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Address</p><p className="text-sm font-medium text-foreground">PSM Properties Co., Ltd.</p><p className="text-xs text-muted-foreground truncate">Yangon, Myanmar</p></div>
          </div>
          <a href="tel:+95123456789" className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors min-h-[52px]">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0"><Phone className="w-4 h-4 text-success" /></div>
            <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Contact</p><p className="text-sm font-medium text-foreground">+95 1 234 567 89</p></div>
          </a>
          <a href="mailto:support@psmproperties.com" className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors min-h-[52px]">
            <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0"><HeartHandshake className="w-4 h-4 text-info" /></div>
            <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Support</p><p className="text-sm font-medium text-foreground">support@psmproperties.com</p></div>
          </a>
        </CardContent>
      </Card>

      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 min-h-[56px]">
          <p className="text-sm font-semibold text-foreground">PSM Properties CRM</p>
          <p className="text-xs text-muted-foreground">Supabase + React · v1.0</p>
        </CardContent>
      </Card>

      {/* Department delete confirmation (exec only — the section itself is gated) */}
      <AlertDialog open={!!deptDeleteTarget} onOpenChange={(open) => !open && !deletingDept && setDeptDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the {deptDeleteTarget?.name} department?</AlertDialogTitle>
            <AlertDialogDescription>
              Departments with staff or leads cannot be deleted — move them first. If old records
              (like past check-ins) reference it, the department is deactivated instead of deleted,
              which removes it from every picker while history keeps its labels.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDept}>Cancel</AlertDialogCancel>
            <Button
              disabled={deletingDept}
              onClick={handleDeleteDepartment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10"
            >
              {deletingDept ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deletingDept ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
