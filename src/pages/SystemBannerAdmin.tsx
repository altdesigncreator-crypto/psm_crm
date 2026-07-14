import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Megaphone, Eye, EyeOff, LogOut, Plus, Trash2, Edit2, Loader2, Info, AlertTriangle, Wrench, Siren } from 'lucide-react';
import { toast } from 'sonner';
import {
  getBannerToken, bannerLogin, bannerLogout, listMessages, createMessage, updateMessage, deleteMessage,
} from '@/lib/bannerAdmin';
import { SYSTEM_MESSAGE_TYPES, type SystemMessage, type SystemMessageType } from '@/types';

const TYPE_ICON: Record<SystemMessageType, React.ComponentType<{ className?: string }>> = {
  info: Info, warning: AlertTriangle, maintenance: Wrench, critical: Siren,
};
const TYPE_STYLE: Record<SystemMessageType, string> = {
  info: 'bg-info/10 text-info border-info/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  maintenance: 'bg-primary/10 text-primary border-primary/20',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
};

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await bannerLogin(username.trim(), password);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="bg-white rounded-lg shadow-card p-6 sm:p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-4 shadow-card">
              <Megaphone className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">System Banner Admin</h1>
            <p className="text-sm text-muted-foreground mt-1 text-center">
              Separate login, unrelated to any CRM staff account — manages the site-wide announcement banner only.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required className="h-12" autoComplete="username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <div className="relative">
                <Input
                  id="password" type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)} required className="h-12 pr-12" autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>}
            <Button type="submit" disabled={loading} className="w-full h-12 gradient-primary hover:gradient-primary-hover text-white font-medium">
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function MessageForm({
  initial, onCancel, onSave, saving,
}: {
  initial?: SystemMessage;
  onCancel: () => void;
  onSave: (message: string, type: SystemMessageType, isActive: boolean) => void;
  saving: boolean;
}) {
  const [message, setMessage] = useState(initial?.message || '');
  const [type, setType] = useState<SystemMessageType>(initial?.type || 'maintenance');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  return (
    <div className="border border-border rounded-xl p-4 space-y-4 bg-muted/20">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Message</Label>
        <textarea
          value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          placeholder="e.g. System will be under maintenance tonight from 11 PM to 1 AM."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
        <div className="space-y-1.5 flex-1">
          <Label className="text-xs font-medium text-muted-foreground">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as SystemMessageType)}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>{SYSTEM_MESSAGE_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          <span className="text-sm text-foreground">Active (visible to all users)</span>
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" disabled={saving || !message.trim()} onClick={() => onSave(message, type, isActive)} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
        </Button>
      </div>
    </div>
  );
}

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setMessages(await listMessages());
    } catch (err: any) {
      toast.error(err?.message || 'Could not load messages.');
      if (err?.message?.includes('log in')) onLogout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (message: string, type: SystemMessageType, isActive: boolean) => {
    setSaving(true);
    try {
      await createMessage(message, type, isActive);
      toast.success('Banner message created.');
      setCreating(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not create message.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string, message: string, type: SystemMessageType, isActive: boolean) => {
    setSaving(true);
    try {
      await updateMessage(id, { message, type, is_active: isActive });
      toast.success('Banner message updated.');
      setEditingId(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update message.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (m: SystemMessage) => {
    try {
      await updateMessage(m.id, { is_active: !m.is_active });
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update message.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMessage(id);
      toast.success('Banner message deleted.');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete message.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center shadow-card"><Megaphone className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">System Banner</h1>
              <p className="text-xs text-muted-foreground">Shown as a bar at the top of every page, to every user</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout} className="gap-1.5"><LogOut className="w-4 h-4" /> Log Out</Button>
        </div>

        <div className="bg-white rounded-lg shadow-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Messages</h2>
            {!creating && (
              <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5"><Plus className="w-4 h-4" /> New Message</Button>
            )}
          </div>

          {creating && (
            <MessageForm onCancel={() => setCreating(false)} onSave={handleCreate} saving={saving} />
          )}

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : messages.length === 0 && !creating ? (
            <div className="text-center py-10 text-muted-foreground">
              <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No banner messages yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const Icon = TYPE_ICON[m.type];
                return editingId === m.id ? (
                  <MessageForm
                    key={m.id} initial={m} saving={saving}
                    onCancel={() => setEditingId(null)}
                    onSave={(message, type, isActive) => handleUpdate(m.id, message, type, isActive)}
                  />
                ) : (
                  <div key={m.id} className="border border-border rounded-xl p-4 flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${TYPE_STYLE[m.type]}`}><Icon className="w-4 h-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${TYPE_STYLE[m.type]}`}>{m.type}</span>
                        <button
                          type="button" onClick={() => handleToggleActive(m)}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${m.is_active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground border-border'}`}
                        >
                          {m.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                      <p className="text-sm text-foreground mt-1.5 break-words">{m.message}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(m.id)} aria-label="Edit"><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(m.id)} aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SystemBannerAdmin() {
  const [loggedIn, setLoggedIn] = useState(!!getBannerToken());

  const handleLogout = async () => {
    await bannerLogout();
    setLoggedIn(false);
  };

  return loggedIn ? <AdminPanel onLogout={handleLogout} /> : <LoginForm onSuccess={() => setLoggedIn(true)} />;
}
