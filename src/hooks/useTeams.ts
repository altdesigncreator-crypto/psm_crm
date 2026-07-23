import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import type { Team, TeamMember } from '@/types';

/** Teams are the layer between Department and individual staff — a
 * department has many teams, each with one Manager and any number of Sales
 * People. RLS already scopes what each caller sees (Admin/exec: their
 * department or all; Manager: teams they run; Sales Person: teams they're
 * in), so this hook just reflects whatever rows come back. */
export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: teamRows }, { data: memberRows }] = await Promise.all([
      supabase.from('teams').select('id, name, department_code, manager_id, is_active, created_at').order('name'),
      supabase.from('team_members').select('team_id, sale_person_id, added_at'),
    ]);
    setTeams((teamRows || []) as Team[]);
    setMembers((memberRows || []) as TeamMember[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('teams-and-members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const createTeam = useCallback(async (name: string, departmentCode: string, managerId: string | null) => {
    const { error } = await supabase.from('teams').insert({ name: name.trim(), department_code: departmentCode, manager_id: managerId });
    if (!error) await load();
    return error;
  }, [load]);

  const updateTeam = useCallback(async (id: string, patch: { name?: string; manager_id?: string | null }) => {
    const { error } = await supabase.from('teams').update(patch).eq('id', id);
    if (!error) await load();
    return error;
  }, [load]);

  /** Hard delete — fails with a FK violation if leads still reference the
   * team; callers fall back to deactivate. */
  const deleteTeam = useCallback(async (id: string) => {
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (!error) await load();
    return error;
  }, [load]);

  const deactivateTeam = useCallback(async (id: string) => {
    const { error } = await supabase.from('teams').update({ is_active: false }).eq('id', id);
    if (!error) await load();
    return error;
  }, [load]);

  const addMember = useCallback(async (teamId: string, salePersonId: string) => {
    const { error } = await supabase.from('team_members').insert({ team_id: teamId, sale_person_id: salePersonId });
    if (!error) await load();
    return error;
  }, [load]);

  const removeMember = useCallback(async (teamId: string, salePersonId: string) => {
    const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('sale_person_id', salePersonId);
    if (!error) await load();
    return error;
  }, [load]);

  const membersOf = useCallback((teamId: string) => members.filter((m) => m.team_id === teamId).map((m) => m.sale_person_id), [members]);
  const teamsOf = useCallback((salePersonId: string) => members.filter((m) => m.sale_person_id === salePersonId).map((m) => m.team_id), [members]);
  const teamsManagedBy = useCallback((managerId: string) => teams.filter((t) => t.manager_id === managerId), [teams]);

  return {
    teams, members, loading,
    createTeam, updateTeam, deleteTeam, deactivateTeam,
    addMember, removeMember,
    membersOf, teamsOf, teamsManagedBy,
    refresh: load,
  };
}
