-- Manager visibility becomes strictly team-scoped — no more whole-department
-- fallback. Previously a lead with no team_id yet was visible to any manager
-- covering that department (a launch-day safety net from before teams
-- existed); a manager can now only see/monitor a lead filed under a team
-- they actually run. This affects the shared manager_scoped_lead() helper
-- (and therefore leads/lead_assignments/follow_ups/pipeline_history/
-- appointments/site_visits select policies that call it) plus the
-- reassign_lead() RPC's own manager check. Purely a policy/function
-- redefinition — no data is touched, nothing is deleted, safe to re-run.

create or replace function public.manager_scoped_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and l.team_id is not null
      and public.manages_team(l.team_id)
  );
$$;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select
  to authenticated using (
    public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and team_id is not null and public.manages_team(team_id))
    or owner_id = auth.uid()
  );

create or replace function public.reassign_lead(p_lead_id uuid, p_new_owner uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
  v_team uuid;
begin
  select department_code, team_id into v_dept, v_team from public.leads where id = p_lead_id;

  if not (
    public.is_exec()
    or (public.current_role() = 'admin' and v_dept = public.current_department())
    or (public.current_role() = 'manager' and v_team is not null and public.manages_team(v_team))
  ) then
    raise exception 'Not authorized to reassign this lead';
  end if;

  update public.leads set owner_id = p_new_owner where id = p_lead_id;

  if p_note is not null then
    update public.lead_assignments
      set note = p_note
      where id = (
        select id from public.lead_assignments
        where lead_id = p_lead_id
        order by assigned_at desc
        limit 1
      );
  end if;
end;
$$;
