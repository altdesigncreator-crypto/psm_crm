import { useState } from 'react';
import { Edit2, Loader2, MapPin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/contexts/TranslationContext';
import { useBranches } from '@/hooks/useBranches';
import { useDepartments } from '@/hooks/useDepartments';

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/** Settings → System configuration: the branches (Yangon, Mandalay, …) that
 * departments belong to. A branch is never deleted — deactivating hides it
 * from pickers while every record filed under it keeps its label. */
export default function BranchesCard() {
  const { t, lang } = useTranslation();
  const { allBranches, createBranch, updateBranch } = useBranches();
  const { departments } = useDepartments();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [nameMm, setNameMm] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ code: string; name: string; nameMm: string } | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const departmentCount = (branch: string) => departments.filter((d) => d.branch_code === branch).length;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toLowerCase();
    if (!name.trim() || !CODE_PATTERN.test(cleanCode)) { toast.error(t('branches.invalid')); return; }
    setAdding(true);
    const error = await createBranch(cleanCode, name, nameMm);
    setAdding(false);
    if (error) { toast.error(error.message || t('branches.addError')); return; }
    toast.success(`${name.trim()} ${t('branches.addedSuffix')}`);
    setCode(''); setName(''); setNameMm('');
  };

  const saveRename = async () => {
    if (!editing || !editing.name.trim()) return;
    setBusyCode(editing.code);
    const error = await updateBranch(editing.code, { name: editing.name.trim(), name_mm: editing.nameMm.trim() || null });
    setBusyCode(null);
    if (error) { toast.error(error.message || t('branches.saveError')); return; }
    setEditing(null);
  };

  const toggleActive = async (branchCode: string, isActive: boolean) => {
    setBusyCode(branchCode);
    const error = await updateBranch(branchCode, { is_active: isActive });
    setBusyCode(null);
    if (error) toast.error(error.message || t('branches.saveError'));
  };

  return (
    <Card className="shadow-card rounded-xl border-0">
      <CardContent className="p-5 md:p-6 space-y-3">
        <p className="text-sm font-semibold text-foreground">{t('branches.title')}</p>
        <p className="text-xs text-muted-foreground">{t('branches.desc')}</p>

        <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
          <Input placeholder={t('settings.codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value)} className="h-10 font-mono" aria-label={t('settings.code')} />
          <Input placeholder={t('branches.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} className="h-10" aria-label={t('branches.name')} />
          <Input placeholder={t('branches.nameMmPlaceholder')} value={nameMm} onChange={(e) => setNameMm(e.target.value)} className="h-10" aria-label={t('branches.nameMm')} />
          <Button type="submit" disabled={adding} size="sm" className="h-10 gap-1.5">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('settings.add')}
          </Button>
        </form>

        <ul className="space-y-2">
          {allBranches.map((b) => (
            <li key={b.code} className={`flex items-center gap-2 rounded-xl border border-border p-2.5 ${b.is_active ? '' : 'opacity-60'}`}>
              {editing?.code === b.code ? (
                <>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-10 flex-1" autoFocus aria-label={t('branches.name')} />
                  <Input value={editing.nameMm} onChange={(e) => setEditing({ ...editing, nameMm: e.target.value })} placeholder={t('branches.nameMmPlaceholder')} className="h-10 flex-1" aria-label={t('branches.nameMm')} />
                  <Button size="sm" disabled={busyCode === b.code} onClick={saveRename} className="h-10 shrink-0">
                    {busyCode === b.code ? <Loader2 className="h-4 w-4 animate-spin" /> : t('settings.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-10 shrink-0">{t('common.cancel')}</Button>
                </>
              ) : (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><MapPin className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{(lang === 'mm' && b.name_mm) || b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t('settings.code')}: {b.code} · {departmentCount(b.code)} {t('branches.departmentsSuffix')}
                    </p>
                  </div>
                  <Button
                    variant="ghost" size="icon" aria-label={`${t('settings.renameSuffix')} ${b.name}`}
                    className="h-10 w-10 min-h-0 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    onClick={() => setEditing({ code: b.code, name: b.name, nameMm: b.name_mm ?? '' })}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={b.is_active}
                    disabled={busyCode === b.code}
                    onCheckedChange={(v) => toggleActive(b.code, v)}
                    aria-label={`${t('branches.active')}: ${b.name}`}
                    title={t('branches.activeHint')}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
