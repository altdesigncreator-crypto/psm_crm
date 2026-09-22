import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useTranslation } from '@/contexts/TranslationContext';
import { useDepartments } from '@/hooks/useDepartments';
import { useTeams } from '@/hooks/useTeams';
import { useProfiles } from '@/hooks/useProfiles';
import { isExec, getDepartmentLabel } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Users, UserCog, Plus, Trash2, Edit2, Loader2, X, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

export default function TeamManagement() {
  const navigate = useNavigate();
  const { role, department } = useAuth();
  const { departments } = useDepartments();
  const { profiles } = useProfiles();
  const { teams, createTeam, updateTeam, deleteTeam, deactivateTeam, addMember, removeMember, membersOf } = useTeams();
  const { t, lang } = useTranslation();
  usePageHeader(t('teamManagement.pageTitle'), t('teamManagement.subtitle'));

  const isBoss = isExec(role);
  const [selectedDept, setSelectedDept] = useState('');

  useEffect(() => {
    if (isBoss) {
      if (!selectedDept && departments.length > 0) setSelectedDept(departments[0].code);
    } else if (department) {
      setSelectedDept(department);
    }
  }, [isBoss, department, departments, selectedDept]);

  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamManager, setNewTeamManager] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const managersInDept = useMemo(
    () => profiles.filter((p) => p.role === 'manager' && p.department_code === selectedDept),
    [profiles, selectedDept]
  );
  const salesInDept = useMemo(
    () => profiles.filter((p) => p.role === 'sale' && p.department_code === selectedDept),
    [profiles, selectedDept]
  );
  const teamsInDept = useMemo(
    () => teams.filter((t) => t.department_code === selectedDept),
    [teams, selectedDept]
  );

  if (!selectedDept && !isBoss) {
    return (
      <div className="flex flex-col items-center justify-center h-[60dvh] text-center px-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-4"><ShieldAlert className="w-8 h-8" /></div>
        <h2 className="text-lg font-semibold text-foreground">{t('teamManagement.noDeptAssigned')}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">{t('teamManagement.noDeptAssignedDesc')}</p>
      </div>
    );
  }

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !selectedDept) { toast.error(t('teamManagement.enterTeamName')); return; }
    setSavingTeam(true);
    const error = await createTeam(newTeamName, selectedDept, newTeamManager || null);
    setSavingTeam(false);
    if (error) { toast.error(error.message || t('teamManagement.createTeamError')); return; }
    toast.success(`${newTeamName.trim()} ${t('teamManagement.createdToastSuffix')}`);
    setNewTeamName('');
    setNewTeamManager('');
  };

  const handleRenameTeam = async (id: string) => {
    if (!editingTeamName.trim()) { toast.error(t('teamManagement.enterTeamName')); return; }
    setSavingEdit(true);
    const error = await updateTeam(id, { name: editingTeamName.trim() });
    setSavingEdit(false);
    if (error) { toast.error(error.message || t('teamManagement.renameTeamError')); return; }
    toast.success(t('teamManagement.teamRenamedToast'));
    setEditingTeamId(null);
  };

  const handleChangeManager = async (id: string, managerId: string) => {
    const error = await updateTeam(id, { manager_id: managerId || null });
    if (error) toast.error(error.message || t('teamManagement.changeManagerError'));
  };

  const handleToggleMember = async (teamId: string, salePersonId: string, isMember: boolean) => {
    const error = isMember ? await removeMember(teamId, salePersonId) : await addMember(teamId, salePersonId);
    if (error) toast.error(error.message || t('teamManagement.updateMembershipError'));
  };

  const handleDeleteTeam = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const error = await deleteTeam(deleteTarget.id);
      if (error) {
        if ((error as { code?: string }).code === '23503') {
          const softErr = await deactivateTeam(deleteTarget.id);
          if (softErr) { toast.error(softErr.message || t('teamManagement.removeTeamError')); return; }
          toast.success(`${deleteTarget.name} ${t('teamManagement.deactivatedToastSuffix')}`);
        } else {
          toast.error(error.message || t('teamManagement.deleteTeamError'));
          return;
        }
      } else {
        toast.success(`${deleteTarget.name} ${t('teamManagement.deletedToastSuffix')}`);
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0 active:bg-muted/50" onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1 md:hidden">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{t('teamManagement.pageTitle')}</h1>
        </div>
      </div>

      {isBoss && (
        <Card className="shadow-card rounded-xl border-0">
          <CardContent className="p-4 md:p-5">
            <Label className="text-xs font-medium text-muted-foreground">{t('leads.filter.department')}</Label>
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger className="h-11 mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{departments.map((d) => (<SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>))}</SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card rounded-xl border-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Plus className="w-4 h-4 text-primary" /></div>
            {lang === 'mm' ? <>{getDepartmentLabel(selectedDept)} {t('teamManagement.newTeamInPrefix')}</> : <>{t('teamManagement.newTeamInPrefix')} {getDepartmentLabel(selectedDept)}</>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddTeam} className="flex flex-col sm:flex-row gap-2.5">
            <Input placeholder={t('teamManagement.teamNamePlaceholder')} value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="h-11 flex-1" />
            <Select value={newTeamManager} onValueChange={setNewTeamManager}>
              <SelectTrigger className="h-11 sm:w-56"><SelectValue placeholder={t('teamManagement.managerOptional')} /></SelectTrigger>
              <SelectContent>
                {managersInDept.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={savingTeam} className="h-11 gap-1.5 shrink-0">
              {savingTeam ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('teamManagement.addTeam')}
            </Button>
          </form>
          {managersInDept.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2.5">{t('teamManagement.noManagersYet')}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {teamsInDept.length === 0 ? (
          <div className="md:col-span-2 flex flex-col items-center justify-center h-40 text-muted-foreground bg-muted/5 rounded-xl border border-dashed border-border">
            <Users className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm font-medium">
              {lang === 'mm' ? <>{getDepartmentLabel(selectedDept)} {t('teamManagement.noTeamsYetPrefix')}</> : <>{t('teamManagement.noTeamsYetPrefix')} {getDepartmentLabel(selectedDept)}</>}
            </p>
          </div>
        ) : (
          teamsInDept.map((team) => {
            const memberIds = membersOf(team.id);
            return (
              <Card key={team.id} className="shadow-sm border border-border/50 bg-card rounded-xl overflow-hidden">
                <CardHeader className="px-5 py-4 border-b border-border/40 bg-muted/10">
                  <div className="flex items-center gap-2">
                    {editingTeamId === team.id ? (
                      <>
                        <Input value={editingTeamName} onChange={(e) => setEditingTeamName(e.target.value)} className="h-9 flex-1" autoFocus />
                        <Button size="sm" disabled={savingEdit} onClick={() => handleRenameTeam(team.id)} className="h-9 shrink-0">{savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('settings.save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingTeamId(null)} className="h-9 shrink-0">{t('common.cancel')}</Button>
                      </>
                    ) : (
                      <>
                        <CardTitle className="text-sm font-semibold flex-1 truncate">{team.name}</CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0 text-muted-foreground hover:text-primary" onClick={() => { setEditingTeamId(team.id); setEditingTeamName(team.name); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget({ id: team.id, name: team.name })}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><UserCog className="w-3.5 h-3.5" /> {t('teamManagement.manager')}</Label>
                    <Select value={team.manager_id || ''} onValueChange={(v) => handleChangeManager(team.id, v)}>
                      <SelectTrigger className="h-10"><SelectValue placeholder={t('teamManagement.unassigned')} /></SelectTrigger>
                      <SelectContent>
                        {managersInDept.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" /> {t('teamManagement.members')}
                      <span className="text-[10px] font-semibold text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded-full tabular-nums">{memberIds.length}</span>
                    </Label>
                    {salesInDept.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('teamManagement.noSalesInDept')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {salesInDept.map((s) => {
                          const isMember = memberIds.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handleToggleMember(team.id, s.id, isMember)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                isMember
                                  ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15'
                                  : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                              }`}
                            >
                              {s.name}
                              {isMember && <X className="w-3 h-3" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{lang === 'mm' ? <>{deleteTarget?.name} {t('teamManagement.deleteTeamTitleSuffix')}</> : <>{t('teamManagement.deleteTeamTitlePrefix')} {deleteTarget?.name} {t('teamManagement.deleteTeamTitleSuffix')}</>}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('teamManagement.deleteTeamBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(e) => { e.preventDefault(); handleDeleteTeam(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deleting ? t('leads.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
