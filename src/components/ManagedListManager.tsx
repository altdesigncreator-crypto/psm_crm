import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Edit2, Eye, EyeOff, Loader2, MoreVertical, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/contexts/TranslationContext';
import {
  CATEGORY_LABEL_KEYS, ENQUIRY_CATEGORIES, normalizeListName as normalizeSourceName, type ListItem as EnquirySource, type ManagedList,
} from '@/hooks/useManagedList';
import { useEnquirySources } from '@/hooks/useEnquirySources';
import { useProjectOptions } from '@/hooks/useProjectOptions';
import type { EnquiryCategory } from '@/types';

/** Translation keys for the parts of the screen that name the list. */
export interface ManagedListCopy { title: string; desc: string; addPlaceholder: string }

/** A Settings screen for one managed list (Settings → Lead sources,
 * Settings → Projects). Manager and above — RLS enforces the same rule
 * server-side; this screen is only the convenient way in.
 *
 * Hide is the everyday "stop using this" action — the entry leaves the
 * pickers but stays filterable, because saved records still carry it.
 * Delete is for mistakes; it never touches saved records either, since
 * they store the name as text. */
export default function ManagedListManager({ list: managed, copy }: { list: ManagedList; copy: ManagedListCopy }) {
  const { t } = useTranslation();
  const { byCategory, loading, unavailable, create, rename, setActive, remove, reorder } = managed;

  const [category, setCategory] = useState<EnquiryCategory>('condo');
  const [newName, setNewName] = useState('');
  const [addTo, setAddTo] = useState<EnquiryCategory[]>(['condo']);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnquirySource | null>(null);

  // The add form follows the tab you're looking at; tick the other
  // category too to add a source to both at once.
  useEffect(() => { setAddTo([category]); setQuery(''); setEditingId(null); }, [category]);

  const catLabel = (c: EnquiryCategory) => t(CATEGORY_LABEL_KEYS[c]);
  const list = byCategory[category].rows;
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list), [list, q]);
  const hiddenCount = list.filter((r) => !r.is_active).length;
  const existsIn = (c: EnquiryCategory, name: string, exceptId?: string) =>
    byCategory[c].rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
  const fail = (message?: string) => toast.error(message || t('managedList.saveError'));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = normalizeSourceName(newName);
    if (!name) return;
    if (addTo.length === 0) { toast.error(t('managedList.pickCategory')); return; }
    const targets = addTo.filter((c) => !existsIn(c, name));
    const skipped = addTo.filter((c) => existsIn(c, name));
    if (targets.length === 0) {
      toast.error(t('managedList.duplicate').replace('{name}', name).replace('{category}', skipped.map(catLabel).join(', ')));
      return;
    }
    setAdding(true);
    const error = await create(name, targets);
    setAdding(false);
    if (error) { fail(error.code === '23505' ? t('managedList.duplicate').replace('{name}', name).replace('{category}', targets.map(catLabel).join(', ')) : error.message); return; }
    toast.success(t('managedList.added').replace('{name}', name).replace('{category}', targets.map(catLabel).join(' + ')), {
      description: skipped.length > 0 ? t('managedList.alreadyIn').replace('{category}', skipped.map(catLabel).join(', ')) : undefined,
    });
    setNewName('');
  };

  const handleRename = async (row: EnquirySource) => {
    const name = normalizeSourceName(editingName);
    if (!name || name === row.name) { setEditingId(null); return; }
    if (existsIn(row.category, name, row.id)) {
      toast.error(t('managedList.duplicate').replace('{name}', name).replace('{category}', catLabel(row.category)));
      return;
    }
    setBusyId(row.id);
    const error = await rename(row.id, name);
    setBusyId(null);
    if (error) { fail(error.message); return; }
    toast.success(t('managedList.renamed'));
    setEditingId(null);
  };

  const handleToggle = async (row: EnquirySource) => {
    setBusyId(row.id);
    const error = await setActive(row.id, !row.is_active);
    setBusyId(null);
    if (error) { fail(error.message); return; }
    toast.success(t(row.is_active ? 'managedList.hiddenToast' : 'managedList.shownToast').replace('{name}', row.name));
  };

  const handleMove = async (index: number, delta: -1 | 1) => {
    const ids = list.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const error = await reorder(category, ids);
    if (error) fail(error.message);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    const error = await remove(deleteTarget.id);
    setBusyId(null);
    if (error) { fail(error.message); return; }
    toast.success(t('managedList.deleted').replace('{name}', deleteTarget.name));
    setDeleteTarget(null);
  };

  return (
    <Card className="shadow-card rounded-xl border-0">
      <CardContent className="p-5 md:p-6 space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{t(copy.title)}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{t(copy.desc)}</p>
        </div>

        {unavailable && (
          <div className="flex items-start gap-2 rounded-lg bg-warning/10 text-warning p-3 text-xs">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>{t('managedList.unavailable')}</span>
          </div>
        )}

        <Tabs value={category} onValueChange={(v) => setCategory(v as EnquiryCategory)}>
          <TabsList className="h-10 w-full sm:w-auto">
            {ENQUIRY_CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c} className="flex-1 sm:flex-none gap-1.5 text-xs">
                {catLabel(c)}
                <span className="tabular-nums text-muted-foreground">{byCategory[c].active.length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Add */}
        <form onSubmit={handleAdd} className="space-y-2.5 rounded-xl border border-border p-3">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t(copy.addPlaceholder)}
              maxLength={80}
              className="h-10 flex-1"
              disabled={unavailable}
              aria-label={t(copy.addPlaceholder)}
            />
            <Button type="submit" size="sm" className="h-10 gap-1.5 shrink-0" disabled={unavailable || adding || !normalizeSourceName(newName)}>
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('settings.add')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className="text-muted-foreground">{t('managedList.addTo')}</span>
            {ENQUIRY_CATEGORIES.map((c) => (
              <label key={c} className="inline-flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={addTo.includes(c)}
                  disabled={unavailable}
                  onCheckedChange={(checked) => setAddTo((prev) => (checked ? [...new Set([...prev, c])] : prev.filter((x) => x !== c)))}
                />
                {catLabel(c)}
              </label>
            ))}
          </div>
        </form>

        {/* List */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('managedList.search')} className="h-10 pl-8" />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {t('managedList.counts').replace('{shown}', String(list.length - hiddenCount)).replace('{hidden}', String(hiddenCount))}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">{q ? t('managedList.noMatch') : t('managedList.empty')}</p>
        ) : (
          <ul className="rounded-xl border border-border divide-y divide-border">
            {visible.map((row) => {
              const index = list.indexOf(row);
              const busy = busyId === row.id;
              // Reordering a filtered list would be ambiguous — only offered on the full list.
              const canMove = !q && !unavailable;
              return (
                <li key={row.id} className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 min-h-[52px] ${row.is_active ? '' : 'bg-muted/30'}`}>
                  {editingId === row.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); handleRename(row); }} className="flex flex-1 items-center gap-2 py-1">
                      <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} maxLength={80} className="h-10 flex-1" autoFocus
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); }} />
                      <Button type="submit" size="sm" className="h-10 shrink-0" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.save')}</Button>
                      <Button type="button" size="sm" variant="ghost" className="h-10 shrink-0" disabled={busy} onClick={() => setEditingId(null)}>{t('common.cancel')}</Button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${row.is_active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{row.name}</p>
                        {!row.is_active && <p className="text-[11px] text-muted-foreground">{t('managedList.hiddenBadge')}</p>}
                      </div>
                      {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
                      {canMove && (
                        <>
                          <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0 text-muted-foreground" disabled={index === 0}
                            aria-label={`${t('managedList.moveUp')}: ${row.name}`} onClick={() => handleMove(index, -1)}>
                            <ChevronUp className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0 text-muted-foreground" disabled={index === list.length - 1}
                            aria-label={`${t('managedList.moveDown')}: ${row.name}`} onClick={() => handleMove(index, 1)}>
                            <ChevronDown className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0 text-muted-foreground" disabled={unavailable} aria-label={`${t('managedList.actions')}: ${row.name}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => { setEditingId(row.id); setEditingName(row.name); }}>
                            <Edit2 className="w-4 h-4 mr-2" />{t('managedList.rename')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleToggle(row)}>
                            {row.is_active ? <><EyeOff className="w-4 h-4 mr-2" />{t('managedList.hide')}</> : <><Eye className="w-4 h-4 mr-2" />{t('managedList.show')}</>}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteTarget(row)}>
                            <Trash2 className="w-4 h-4 mr-2" />{t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !busyId) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('managedList.deleteTitle').replace('{name}', deleteTarget?.name ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('managedList.deleteBody').replace('{category}', deleteTarget ? catLabel(deleteTarget.category) : '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>{t('common.cancel')}</AlertDialogCancel>
            {deleteTarget?.is_active && (
              <Button variant="outline" className="h-10" disabled={!!busyId} onClick={() => { const row = deleteTarget; setDeleteTarget(null); handleToggle(row); }}>
                <EyeOff className="w-4 h-4 mr-2" />{t('managedList.hideInstead')}
              </Button>
            )}
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10" disabled={!!busyId} onClick={handleDelete}>
              {busyId ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}{t('common.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Settings → Lead sources: the list behind both the Enquiry and the Lead
 * source fields, for one branch. */
export function SourcesManager({ branch }: { branch: string | null }) {
  return <ManagedListManager list={useEnquirySources(branch)} copy={{ title: 'enquirySources.title', desc: 'enquirySources.desc', addPlaceholder: 'enquirySources.addPlaceholder' }} />;
}

/** Settings → Projects: the Preferred project options, for one branch. */
export function ProjectsManager({ branch }: { branch: string | null }) {
  return <ManagedListManager list={useProjectOptions(branch)} copy={{ title: 'projectOptions.title', desc: 'projectOptions.desc', addPlaceholder: 'projectOptions.addPlaceholder' }} />;
}
