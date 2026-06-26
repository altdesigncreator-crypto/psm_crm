import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getRoleDisplayName, getDepartmentDisplayName } from '@/lib/roleUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  User,
  Mail,
  Shield,
  Building2,
  Smartphone,
  Moon,
  Bell,
  Cloud,
  RefreshCw,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Phone,
  MapPin,
  Info,
  HeartHandshake,
  Globe,
} from 'lucide-react';
import { flushStorageQueue } from '@/lib/offlineStorageQueue';
import { getPendingCounts } from '@/lib/backgroundSync';
import { useTranslation } from '@/contexts/TranslationContext';
import { toast } from 'sonner';

export default function Settings() {
  const { user, role } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();

  const [darkMode, setDarkMode] = useState(
    document.documentElement.classList.contains('dark')
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Mobile accordion state
  const [openSection, setOpenSection] = useState<'profile' | 'preferences' | 'tools' | null>('profile');
  const toggleSection = (section: 'profile' | 'preferences' | 'tools') => {
    setOpenSection((prev) => (prev === section ? null : section));
  };

  const handleToggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { flushStorageQueue } = await import('@/lib/offlineStorageQueue');
      await flushStorageQueue();
      const counts = await getPendingCounts();
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total === 0) {
        toast.success('Sync ပြီးပါပြီ — ကြိုတင်သိမ်းဆည်းထားသော ဒေတာမရှိပါ');
      } else {
        toast.info(`Sync လုပ်နေပါသည် — ${total} ခု ကျန်ရှိပါသည်`);
      }
    } catch {
      toast.error('Sync လုပ်ရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setSyncing(false);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm('Cache နှင့် local data အားလုံးကို ရှင်းလင်းမှာသေချာပါသလား?')) return;
    setClearing(true);
    try {
      localStorage.clear();
      const dbs = await window.indexedDB.databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name) window.indexedDB.deleteDatabase(db.name);
        }
      }
      toast.success('Cache ရှင်းလင်းပြီးပါပြီ — Page ပြန်လည်တည်ဆောက်ပါမည်');
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      toast.error('Cache ရှင်းလင်းရာတွင် အမှားဖြစ်သွားပါသည်');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">အကောင့်ဆက်တင်များ</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Profile နှင့် System Preferences</p>
        </div>
      </div>

      {/* Profile Info — Mobile Accordion Header */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => toggleSection('profile')}
          className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Profile အချက်အလက်များ</p>
              <p className="text-xs text-muted-foreground">{user?.email || '—'}</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openSection === 'profile' ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Profile Info */}
      <Card className="shadow-card rounded-xl border-0 md:block" style={{ display: openSection === 'profile' ? 'block' : 'none' }}>
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            Profile အချက်အလက်များ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-foreground truncate">{user?.email || '—'}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {getRoleDisplayName(role)}
                </span>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">
                  {getDepartmentDisplayName(role)}
                </span>
              </div>
            </div>
          </div>
          <Separator />
          <div className="space-y-1">
            {[
              { icon: Mail, label: 'အီးမေးလ်', value: user?.email || '—' },
              { icon: Shield, label: 'အခွင့်အဆင့်', value: getRoleDisplayName(role) },
              { icon: Building2, label: 'ဌာန', value: getDepartmentDisplayName(role) },
              { icon: Smartphone, label: 'User ID', value: user?.uid || '—' },
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-2.5 rounded-lg min-h-[48px] active:bg-muted/30 transition-colors"
              >
                <item.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium text-foreground break-words">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preferences — Mobile Accordion Header */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => toggleSection('preferences')}
          className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Moon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">System Preferences</p>
              <p className="text-xs text-muted-foreground">Theme, Language, Notifications</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openSection === 'preferences' ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Preferences */}
      <Card className="shadow-card rounded-xl border-0 md:block" style={{ display: openSection === 'preferences' ? 'block' : 'none' }}>
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Moon className="w-4 h-4 text-primary" />
            </div>
            System Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Language Switcher */}
          <button
            type="button"
            onClick={() => setLang(lang === 'mm' ? 'en' : 'mm')}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-info/10 flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t('settings.language')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.myanmar')} / {t('settings.english')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-medium px-2 py-1 rounded-full border ${lang === 'mm' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'}`}>
                MM
              </span>
              <span className={`text-xs font-medium px-2 py-1 rounded-full border ${lang === 'en' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'}`}>
                EN
              </span>
            </div>
          </button>

          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={handleToggleDarkMode}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Moon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Dark Mode</p>
                <p className="text-xs text-muted-foreground">{t('settings.language') === 'Language' ? 'Dark theme display' : 'အနက်ရောင် theme ဖြင့် ပြသရန်'}</p>
              </div>
            </div>
            <div className={`w-12 h-7 rounded-full transition-colors relative ${darkMode ? 'bg-primary' : 'bg-muted'}`}>
              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${darkMode ? 'left-6' : 'left-1'}`} />
            </div>
          </button>

          {/* Notifications Toggle */}
          <button
            type="button"
            onClick={() => setNotificationsEnabled((v) => !v)}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t('nav.notifications')}</p>
                <p className="text-xs text-muted-foreground">Real-time {t('nav.notifications')} {lang === 'mm' ? 'လက်ခံခြင်း' : 'receiving'}</p>
              </div>
            </div>
            <div className={`w-12 h-7 rounded-full transition-colors relative ${notificationsEnabled ? 'bg-success' : 'bg-muted'}`}>
              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${notificationsEnabled ? 'left-6' : 'left-1'}`} />
            </div>
          </button>
        </CardContent>
      </Card>

      {/* Tools & Data — Mobile Accordion Header */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => toggleSection('tools')}
          className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Cloud className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Tools & Data</p>
              <p className="text-xs text-muted-foreground">File Cloud, Sync, Cache</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openSection === 'tools' ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Tools & Data */}
      <Card className="shadow-card rounded-xl border-0 md:block" style={{ display: openSection === 'tools' ? 'block' : 'none' }}>
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Cloud className="w-4 h-4 text-primary" />
            </div>
            Tools & Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* File Cloud Link */}
          <Link
            to="/file-cloud"
            className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Cloud className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">File Cloud</p>
                <p className="text-xs text-muted-foreground">ကိုယ်ပိုင် ဖိုင်များ သိမ်းဆည်းရန်</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </Link>

          {/* Sync Now */}
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-info/10 flex items-center justify-center shrink-0">
                <RefreshCw className={`w-5 h-5 text-info ${syncing ? 'animate-spin' : ''}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Sync Now</p>
                <p className="text-xs text-muted-foreground">Offline data ကို အခု sync လုပ်ရန်</p>
              </div>
            </div>
          </button>

          {/* Clear Cache */}
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearing}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors text-left min-h-[64px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Clear Cache</p>
                <p className="text-xs text-muted-foreground">Local cache နှင့် data ရှင်းလင်းရန်</p>
              </div>
            </div>
          </button>
        </CardContent>
      </Card>

      {/* Company & Support */}
      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3 hidden md:flex">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Info className="w-4 h-4 text-primary" />
            </div>
            ကုမ္ပဏီ အချက်အလက်များ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card min-h-[52px]">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">ကုမ္ပဏီ လိပ်စာ</p>
              <p className="text-sm font-medium text-foreground">PSM Properties Co., Ltd.</p>
              <p className="text-xs text-muted-foreground truncate">Yangon, Myanmar</p>
            </div>
          </div>
          <a
            href="tel:+95123456789"
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors min-h-[52px]"
          >
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
              <Phone className="w-4 h-4 text-success" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">ဆက်သွယ်ရန်</p>
              <p className="text-sm font-medium text-foreground">+95 1 234 567 89</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href="mailto:support@psmproperties.com"
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card active:bg-muted/50 transition-colors min-h-[52px]"
          >
            <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0">
              <HeartHandshake className="w-4 h-4 text-info" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">ဆupport အကူညီ</p>
              <p className="text-sm font-medium text-foreground">support@psmproperties.com</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        </CardContent>
      </Card>

      {/* App Info */}
      <Card className="shadow-card rounded-xl border-0">
        <CardContent className="p-4 min-h-[56px]">
          <div>
            <p className="text-sm font-semibold text-foreground">PSM Properties CRM</p>
            <p className="text-xs text-muted-foreground">Firebase + React + PWA · v96</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
