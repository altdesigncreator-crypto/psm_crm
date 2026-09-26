import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { getRoleLabel, getDepartmentLabel, isExec } from '@/lib/permissions';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';
import { useDepartments } from '@/hooks/useDepartments';
import {
  isPlatformAuthenticatorAvailable, isBiometricEnabledFor, registerBiometric, disableBiometric,
} from '@/lib/biometricAuth';
import { processCapturedImage } from '@/lib/cameraUtils';
import { isPushSupported, hasActivePushSubscription, subscribeToPush, unsubscribeFromPush } from '@/lib/pushNotifications';
import AvatarCropDialog from '@/components/AvatarCropDialog';
import StorageImage from '@/components/StorageImage';
import AppUpdateCard from '@/components/AppUpdateCard';
import UpdateDot from '@/components/UpdateDot';
import { appUpdateStore } from '@/lib/appUpdate';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, User, Mail, Shield, Building2, Moon, Bell, Info, Phone, MapPin,
  HeartHandshake, Globe, Save, Loader2, SettingsIcon, Plus, FingerprintPattern, KeyRound, Eye, EyeOff, Trash2, Edit2,
  Camera, Download, ChevronRight,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/contexts/TranslationContext';
import { toast } from 'sonner';

type SectionKey = 'profile' | 'preferences' | 'system' | 'about';

export default function Settings() {
  const navigate = useNavigate();
  const { lang, setLang, t } = useTranslation();
  const { user, role, department, refreshProfile } = useAuth();
  const { departments, createDepartment, updateDepartment, deleteDepartment, deactivateDepartment } = useDepartments();
  usePageHeader(t('settings.pageTitle'), t('settings.subtitle'));

  const [name, setName] = useState(user?.name || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(document.documentElement.classList.contains('dark'));
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  // The update dot on the nav is what usually brings people here — land them
  // straight on the section that has the Update button.
  const [activeSection, setActiveSection] = useState<SectionKey>(() => (appUpdateStore.getSnapshot().status === 'available' ? 'about' : 'profile'));

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

  const [downloadingBackup, setDownloadingBackup] = useState(false);

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBiometricSupported);
  }, []);

  useEffect(() => {
    if (!isPushSupported()) return;
    hasActivePushSubscription().then(setNotificationsEnabled);
  }, []);

  const handleToggleNotifications = async () => {
    if (!user?.id || notificationsBusy) return;
    if (!isPushSupported()) {
      toast.error(t('settings.notificationsUnsupported'));
      return;
    }
    setNotificationsBusy(true);
    try {
      if (notificationsEnabled) {
        await unsubscribeFromPush();
        setNotificationsEnabled(false);
      } else {
        await subscribeToPush(user.id);
        setNotificationsEnabled(true);
      }
    } catch (err: any) {
      toast.error(err?.message || t('settings.notificationsUpdateError'));
    } finally {
      setNotificationsBusy(false);
    }
  };

  const [sendingTestPush, setSendingTestPush] = useState(false);
  const handleSendTestPush = async () => {
    if (!user?.id || sendingTestPush) return;
    setSendingTestPush(true);
    try {
      const { error } = await supabase.functions.invoke('send-user-push', {
        body: { user_id: user.id, title: t('settings.testPushTitle'), body: t('settings.testPushBody'), url: '/settings' },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, t('settings.testPushError')));
      toast.success(t('settings.testPushSent'));
    } catch (err: any) {
      toast.error(err?.message || t('settings.testPushError'));
    } finally {
      setSendingTestPush(false);
    }
  };

  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [editingDeptCode, setEditingDeptCode] = useState<string | null>(null);
  const [editingDeptName, setEditingDeptName] = useState('');
  const [savingDeptEdit, setSavingDeptEdit] = useState(false);
  const [deptDeleteTarget, setDeptDeleteTarget] = useState<{ code: string; name: string } | null>(null);
  const [deletingDept, setDeletingDept] = useState(false);

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
    if (error) { toast.error(t('settings.profileUpdateError')); return; }
    await refreshProfile();
    toast.success(t('settings.profileUpdatedToast'));
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!file.type.startsWith('image/')) { toast.error(t('settings.imageFileRequired')); if (avatarInputRef.current) avatarInputRef.current.value = ''; return; }
    try {
      const { previewUrl } = await processCapturedImage(file);
      setCropImageSrc(previewUrl);
    } catch {
      setCropImageSrc(URL.createObjectURL(file));
    }
  };

  const handleAvatarCropped = async (blob: Blob) => {
    if (!user?.id) return;
    setUploadingAvatar(true);
    try {
      const path = `${user.id}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, blob);
      if (uploadErr) throw uploadErr;
      const avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;

      const { error } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      if (error) throw error;

      await refreshProfile();
      toast.success(t('settings.photoUpdatedToast'));
      setCropImageSrc(null);
    } catch {
      toast.error(t('settings.photoUpdateError'));
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    if (pwNew.length < 6) { toast.error(t('settings.pwTooShort')); return; }
    if (pwNew !== pwConfirm) { toast.error(t('settings.pwMismatch')); return; }
    if (pwNew === pwCurrent) { toast.error(t('settings.pwSameAsOld')); return; }

    setChangingPw(true);
    try {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwCurrent });
      if (verifyErr) { toast.error(t('settings.currentPwIncorrect')); return; }

      const { error } = await supabase.auth.updateUser({ password: pwNew });
      if (error) { toast.error(error.message || t('settings.pwChangeError')); return; }

      await supabase.from('audit_logs').insert({ action: 'password_changed', target_table: 'profiles', target_id: user.id, performed_by: user.id });
      toast.success(t('settings.pwChangedToast'));
      setPwCurrent(''); setPwNew(''); setPwConfirm(''); setShowPw(false);
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.email) return;
    if (!deletePassword) { toast.error(t('settings.enterPwToConfirm')); return; }
    setIsDeletingAccount(true);
    try {
      // Confirm it's really the account owner at the keyboard.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: deletePassword });
      if (verifyErr) { toast.error(t('settings.passwordIncorrect')); return; }

      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('delete-my-account', {
        body: {},
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, t('settings.deleteAccountError')));
      if (data?.error) throw new Error(data.error);

      disableBiometric(user.id);
      toast.success(t('settings.accountDeletedToast'));
      await supabase.auth.signOut();
    } catch (err: any) {
      toast.error(err.message || t('settings.deleteAccountError'));
    } finally {
      setIsDeletingAccount(false);
      setDeleteAccountOpen(false);
      setDeletePassword('');
    }
  };

  const handleDownloadBackup = async () => {
    setDownloadingBackup(true);
    toast.info(t('settings.generatingBackupToast'));
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      // Same-origin proxy (see netlify.toml + src/db/supabase.ts) — some
      // networks block the supabase.co hostname outright, and this call
      // doesn't go through the Supabase client's fetch, so it needs the
      // same fallback applied explicitly.
      const res = await fetch(`${window.location.origin}/supabase-proxy/functions/v1/trigger-db-backup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `${t('settings.backupFailed')} (${res.status}).`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `psm_crm_backup_${new Date().toISOString().split('T')[0]}.zip`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(t('settings.backupDownloadedToast'));
    } catch (err: any) {
      toast.error(err.message || t('settings.backupGenerateError'));
    } finally {
      setDownloadingBackup(false);
    }
  };

  const handleToggleBiometric = async () => {
    if (!user) return;
    if (biometricEnabled) {
      disableBiometric(user.id);
      setBiometricEnabled(false);
      toast.success(t('settings.biometricDisabledToast'));
      return;
    }
    setBiometricBusy(true);
    try {
      await registerBiometric(user.id, user.email, user.name);
      setBiometricEnabled(true);
      toast.success(t('settings.biometricEnabledToast'));
    } catch (err: any) {
      toast.error(err?.message || t('settings.biometricSetupError'));
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleRenameDepartment = async (code: string) => {
    if (!editingDeptName.trim()) { toast.error(t('settings.enterDeptName')); return; }
    setSavingDeptEdit(true);
    const error = await updateDepartment(code, editingDeptName);
    setSavingDeptEdit(false);
    if (error) { toast.error(error.message || t('settings.deptRenameError')); return; }
    toast.success(t('settings.deptRenamedToast'));
    setEditingDeptCode(null);
  };

  const handleDeleteDepartment = async () => {
    if (!deptDeleteTarget) return;
    const { code, name } = deptDeleteTarget;
    setDeletingDept(true);
    try {
      const [{ count: staffCount }, { count: leadCount }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('department_code', code),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('department_code', code),
      ]);
      if ((staffCount ?? 0) > 0 || (leadCount ?? 0) > 0) {
        toast.error(`${t('settings.cannotDeleteDeptPrefix')} ${name} — ${staffCount ?? 0}/${leadCount ?? 0} ${t('settings.cannotDeleteDeptSuffix')}`);
        return;
      }

      const error = await deleteDepartment(code);
      if (error) {
        if ((error as { code?: string }).code === '23503') {
          const softErr = await deactivateDepartment(code);
          if (softErr) { toast.error(softErr.message || t('settings.deptRemoveError')); return; }
          toast.success(`${name} ${t('settings.deptDeactivatedToastSuffix')}`);
        } else {
          toast.error(error.message || t('settings.deptDeleteError'));
          return;
        }
      } else {
        toast.success(`${name} ${t('settings.deptDeletedToastSuffix')}`);
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
    if (!newDeptCode.trim() || !newDeptName.trim()) { toast.error(t('settings.enterCodeAndName')); return; }
    setSavingDept(true);
    const error = await createDepartment(newDeptCode, newDeptName);
    setSavingDept(false);
    if (error) { toast.error(error.message || t('settings.deptAddError')); return; }
    toast.success(`${newDeptName.trim()} ${t('settings.deptAddedToastSuffix')}`);
    setNewDeptCode('');
    setNewDeptName('');
  };

  const SECTIONS: { key: SectionKey; label: string; description: string; icon: typeof User }[] = [
    { key: 'profile', label: t('settings.section.profile'), description: user?.email || '—', icon: User },
    { key: 'preferences', label: t('settings.section.preferences'), description: t('settings.section.preferencesDesc'), icon: Moon },
    ...(isExec(role) ? [{ key: 'system' as const, label: t('settings.section.system'), description: t('settings.section.systemDesc'), icon: SettingsIcon }] : []),
    { key: 'about', label: t('settings.section.about'), description: t('settings.section.aboutDesc'), icon: Info },
  ];

  return (
    <div className="animate-fade-in-up space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1 md:hidden">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{t('settings.pageTitle')}</h1>
        </div>
      </div>

      {/* Mobile: horizontal scrolling tab strip. Desktop: vertical sidebar
          nav, below. Both drive the same activeSection state — only one
          section's content ever renders, instead of the old
          all-visible-on-desktop accordion stack. */}
      <div className="flex lg:hidden items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActiveSection(s.key)}
            className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              activeSection === s.key ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
            }`}
          >
            <s.icon className="w-4 h-4" /> {s.label}
            {s.key === 'about' && <UpdateDot className="relative -ml-0.5" />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr] gap-6 items-start">
        <div className="hidden lg:block sticky top-4">
          <Card className="shadow-card rounded-xl border-0">
            <CardContent className="p-2">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveSection(s.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    activeSection === s.key ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted'
                  }`}
                >
                  <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeSection === s.key ? 'bg-primary/15' : 'bg-muted'}`}>
                    <s.icon className="w-4 h-4" />
                    {s.key === 'about' && <UpdateDot className="absolute -top-0.5 -right-0.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{s.description}</p>
                  </div>
                  {activeSection === s.key && <ChevronRight className="w-4 h-4 shrink-0 mt-0.5" />}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          {activeSection === 'profile' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <div className="space-y-5">
                <Card className="shadow-card rounded-xl border-0 overflow-hidden relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent pointer-events-none" />
                  <CardContent className="p-5 md:p-6 space-y-5 relative">
                    <div className="flex items-center gap-4">
                      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={uploadingAvatar}
                        className="relative w-16 h-16 rounded-full shrink-0 group"
                        aria-label={t('settings.changePhoto')}
                      >
                        {user?.avatar_url ? (
                          <StorageImage src={user.avatar_url} alt={user.name} className="w-16 h-16 rounded-full object-cover" />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"><User className="w-8 h-8 text-primary" /></div>
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
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-foreground truncate">{user?.name || '—'}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">{getRoleLabel(role, lang)}</span>
                          {department && <span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">{getDepartmentLabel(department)}</span>}
                        </div>
                      </div>
                    </div>
                    <Separator />
                    <form onSubmit={handleUpdateProfile} className="space-y-4">
                      <div className="space-y-2"><Label className="text-sm font-medium">{t('settings.name')}</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
                      <div className="space-y-2"><Label className="text-sm font-medium">{t('common.phone')}</Label><Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="09xxxxxxxxx" /></div>
                      <Button type="submit" disabled={isUpdating} className="w-full sm:w-auto h-10 gradient-primary text-white gap-2 mt-2">
                        {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('settings.saveChanges')}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="shadow-card rounded-xl border-0">
                  <CardContent className="p-5 md:p-6 space-y-1">
                    <p className="text-sm font-semibold text-foreground mb-2">{t('settings.account')}</p>
                    {[
                      { icon: Mail, label: t('settings.emailCannotChange'), value: user?.email || '—' },
                      { icon: Shield, label: t('settings.role'), value: getRoleLabel(role, lang) },
                      { icon: Building2, label: t('settings.department'), value: department ? getDepartmentLabel(department) : t('settings.allDepartments') },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-2.5 rounded-lg min-h-[48px] bg-muted/30">
                        <item.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0"><p className="text-xs text-muted-foreground">{item.label}</p><p className="text-sm font-medium text-foreground/70 break-words">{item.value}</p></div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Danger zone — the Boss account can't self-delete; a Super
                    Admin can, unless they're the last executive (server
                    enforces both). */}
                {role !== 'boss' && (
                  <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Trash2 className="w-4 h-4 text-destructive" /> {t('settings.deleteAccount')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.deleteAccountDesc')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeleteAccountOpen(true)}
                      className="w-full sm:w-auto h-10 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" /> {t('settings.deleteMyAccount')}
                    </Button>
                  </div>
                )}
              </div>

              <Card className="shadow-card rounded-xl border-0">
                <CardContent className="p-5 md:p-6">
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-warning/15 to-warning/5 flex items-center justify-center"><KeyRound className="w-4 h-4 text-warning" /></div>
                      <p className="text-sm font-semibold text-foreground">{t('settings.changePassword')}</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{t('settings.currentPassword')}</Label>
                      <Input type={showPw ? 'text' : 'password'} value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} required autoComplete="current-password" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{t('settings.newPassword')}</Label>
                      <div className="relative">
                        <Input type={showPw ? 'text' : 'password'} value={pwNew} onChange={(e) => setPwNew(e.target.value)} required minLength={6} autoComplete="new-password" className="pr-12" placeholder={t('settings.atLeast6Chars')} />
                        <button
                          type="button"
                          onClick={() => setShowPw((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 min-h-0 flex items-center justify-center rounded-full text-muted-foreground"
                          aria-label={showPw ? t('settings.hidePasswords') : t('settings.showPasswords')}
                        >
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{t('settings.confirmNewPassword')}</Label>
                      <Input type={showPw ? 'text' : 'password'} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} required minLength={6} autoComplete="new-password" />
                    </div>
                    <Button type="submit" disabled={changingPw || !pwCurrent || !pwNew || !pwConfirm} className="w-full sm:w-auto h-10 gap-2 mt-2" variant="outline">
                      {changingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                      {changingPw ? t('settings.changing') : t('settings.changePassword')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === 'preferences' && (
            <Card className="shadow-card rounded-xl border-0">
              <CardContent className="p-5 md:p-6 space-y-4">
                <button type="button" onClick={() => setLang(lang === 'mm' ? 'en' : 'mm')} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-muted/40 active:bg-muted/50 transition-colors text-left min-h-[64px]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-info/15 to-info/5 flex items-center justify-center shrink-0"><Globe className="w-5 h-5 text-info" /></div>
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

                <button type="button" onClick={handleToggleDarkMode} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-muted/40 active:bg-muted/50 transition-colors text-left min-h-[64px]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shrink-0"><Moon className="w-5 h-5 text-primary" /></div>
                    <div><p className="text-sm font-semibold text-foreground">{t('settings.darkMode')}</p></div>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors relative ${darkMode ? 'bg-primary' : 'bg-muted'}`}><div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${darkMode ? 'left-6' : 'left-1'}`} /></div>
                </button>

                <button type="button" onClick={handleToggleNotifications} disabled={notificationsBusy} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-muted/40 active:bg-muted/50 transition-colors text-left min-h-[64px] disabled:opacity-60">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-success/15 to-success/5 flex items-center justify-center shrink-0">
                      {notificationsBusy ? <Loader2 className="w-5 h-5 text-success animate-spin" /> : <Bell className="w-5 h-5 text-success" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t('settings.notifications')}</p>
                      <p className="text-xs text-muted-foreground">{t('settings.notificationsDesc')}</p>
                    </div>
                  </div>
                  <div className={`w-12 h-7 rounded-full transition-colors relative ${notificationsEnabled ? 'bg-success' : 'bg-muted'}`}><div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${notificationsEnabled ? 'left-6' : 'left-1'}`} /></div>
                </button>

                {notificationsEnabled && (
                  <div className="pl-1 pr-1 -mt-1 space-y-2">
                    <button
                      type="button"
                      onClick={handleSendTestPush}
                      disabled={sendingTestPush}
                      className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {sendingTestPush ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
                      {sendingTestPush ? t('settings.testPushSending') : t('settings.testPushButton')}
                    </button>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{t('settings.testPushHint')}</p>
                  </div>
                )}

                {biometricSupported && (
                  <button
                    type="button"
                    onClick={handleToggleBiometric}
                    disabled={biometricBusy}
                    className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-muted/40 active:bg-muted/50 transition-colors text-left min-h-[64px] disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shrink-0">
                        {biometricBusy ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : <FingerprintPattern className="w-5 h-5 text-primary" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{t('settings.biometricTitle')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings.biometricDesc')}</p>
                      </div>
                    </div>
                    <div className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${biometricEnabled ? 'bg-primary' : 'bg-muted'}`}><div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${biometricEnabled ? 'left-6' : 'left-1'}`} /></div>
                  </button>
                )}
              </CardContent>
            </Card>
          )}

          {activeSection === 'system' && isExec(role) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <Card className="shadow-card rounded-xl border-0">
                <CardContent className="p-5 md:p-6 space-y-3">
                  <p className="text-sm font-semibold text-foreground">{t('settings.departments')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.departmentsDesc')}</p>
                  <form onSubmit={handleAddDepartment} className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder={t('settings.codePlaceholder')} value={newDeptCode} onChange={(e) => setNewDeptCode(e.target.value)} className="h-10 sm:w-40" />
                    <Input placeholder={t('settings.displayNamePlaceholder')} value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} className="h-10 flex-1" />
                    <Button type="submit" disabled={savingDept} size="sm" className="h-10 gap-1.5 shrink-0">
                      {savingDept ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('settings.add')}
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
                              {savingDeptEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.save')}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={savingDeptEdit} onClick={() => setEditingDeptCode(null)} className="h-10 shrink-0">
                              {t('common.cancel')}
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                              <p className="text-[11px] text-muted-foreground">{t('settings.code')}: {d.code}</p>
                            </div>
                            <Button variant="ghost" size="icon" aria-label={`${t('settings.renameSuffix')} ${d.name}`} className="h-10 w-10 min-h-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => { setEditingDeptCode(d.code); setEditingDeptName(d.name); }}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`${t('settings.deleteSuffix')} ${d.name}`} className="h-10 w-10 min-h-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeptDeleteTarget({ code: d.code, name: d.name })}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-card rounded-xl border-0">
                <CardContent className="p-5 md:p-6 space-y-3">
                  <p className="text-sm font-semibold text-foreground">{t('settings.databaseBackup')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.databaseBackupDesc')}
                  </p>
                  <Button
                    variant="outline"
                    disabled={downloadingBackup}
                    onClick={handleDownloadBackup}
                    className="h-11 gap-2"
                  >
                    {downloadingBackup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {downloadingBackup ? t('settings.generatingBackup') : t('settings.downloadBackup')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === 'about' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <AppUpdateCard />

              <Card className="shadow-card rounded-xl border-0">
                <CardContent className="space-y-3 p-4 md:p-6">
                  <p className="text-sm font-semibold text-foreground mb-1">{t('settings.companyInfo')}</p>
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card min-h-[52px]">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-primary" /></div>
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">{t('settings.address')}</p><p className="text-sm font-medium text-foreground">PSM Properties Co., Ltd.</p><p className="text-xs text-muted-foreground truncate">Yangon, Myanmar</p></div>
                  </div>
                  <a href="tel:+95123456789" className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors min-h-[52px]">
                    <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0"><Phone className="w-4 h-4 text-success" /></div>
                    <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{t('settings.contact')}</p><p className="text-sm font-medium text-foreground">+95 1 234 567 89</p></div>
                  </a>
                  <a href="mailto:support@psmproperties.com" className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors min-h-[52px]">
                    <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0"><HeartHandshake className="w-4 h-4 text-info" /></div>
                    <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{t('settings.support')}</p><p className="text-sm font-medium text-foreground">support@psmproperties.com</p></div>
                  </a>
                </CardContent>
              </Card>

            </div>
          )}
        </div>
      </div>

      {/* Delete-account confirmation — requires the password */}
      <AlertDialog open={deleteAccountOpen} onOpenChange={(open) => { if (!isDeletingAccount) { setDeleteAccountOpen(open); if (!open) setDeletePassword(''); } }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.deleteAccountTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.deleteAccountConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder={t('leads.yourPassword')}
            autoComplete="current-password"
            className="h-11"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingAccount}>{t('common.cancel')}</AlertDialogCancel>
            <Button
              disabled={isDeletingAccount || !deletePassword}
              onClick={handleDeleteAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10"
            >
              {isDeletingAccount ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {isDeletingAccount ? t('leads.deleting') : t('settings.deleteForever')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Department delete confirmation (exec only — the section itself is gated) */}
      <AlertDialog open={!!deptDeleteTarget} onOpenChange={(open) => !open && !deletingDept && setDeptDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.deleteDeptTitlePrefix')} {deptDeleteTarget?.name} {t('settings.deleteDeptTitleSuffix')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.deleteDeptBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDept}>{t('common.cancel')}</AlertDialogCancel>
            <Button
              disabled={deletingDept}
              onClick={handleDeleteDepartment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10"
            >
              {deletingDept ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deletingDept ? t('leads.deleting') : t('common.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AvatarCropDialog
        imageSrc={cropImageSrc}
        onCancel={() => { setCropImageSrc(null); if (avatarInputRef.current) avatarInputRef.current.value = ''; }}
        onCropped={handleAvatarCropped}
      />
    </div>
  );
}
