-- Fixes: adding a salesperson to a team (or assigning a manager to run one)
-- never filed that person's existing leads under the team, so leads.team_id
-- stayed null and the strictly team-scoped leads_select RLS (a manager only
-- ever sees leads with a team_id they run) never surfaced them — a manager
-- would see some, but not all, of a team member's leads even though the
-- membership itself was correct. This is the companion to
-- 2026-07-29_lead_department_cascade.sql's department fix, one level down:
-- that migration clears team_id when department changes (since it can't
-- guess the right team); this one is what actually re-files those leads
-- once the person lands on a team again.
--
-- Two parts, mirroring 2026-07-29's structure:
--  1. Triggers so this can't happen again, regardless of which UI path adds
--     a team member or assigns a team's manager.
--  2. A one-time backfill that repairs every lead already stuck unfiled for
--     an owner who's already on a team.
--
-- Additive/policy-only — no columns dropped, no rows deleted. Safe to re-run.

create or replace function public.cascade_team_member_join() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
begin
  select department_code into v_dept from public.teams where id = new.team_id;
  update public.leads
    set team_id = new.team_id
    where owner_id = new.sale_person_id
      and team_id is null
      and department_code = v_dept;
  return new;
end;
$$;

drop trigger if exists trg_team_members_cascade_join on public.team_members;
create trigger trg_team_members_cascade_join after insert on public.team_members
  for each row execute function public.cascade_team_member_join();

create or replace function public.cascade_team_manager_assign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager_id is not null and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id) then
    update public.leads
      set team_id = new.id
      where owner_id = new.manager_id
        and team_id is null
        and department_code = new.department_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_teams_cascade_manager on public.teams;
create trigger trg_teams_cascade_manager after insert or update of manager_id on public.teams
  for each row execute function public.cascade_team_manager_assign();

-- One-time repair of existing drift, same rule as the triggers above.
with latest_membership as (
  select distinct on (tm.sale_person_id) tm.sale_person_id, tm.team_id, t.department_code
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  order by tm.sale_person_id, tm.added_at desc
)
update public.leads l
set team_id = m.team_id
from latest_membership m
where l.owner_id = m.sale_person_id
  and l.team_id is null
  and l.department_code = m.department_code;

with latest_managed_team as (
  select distinct on (manager_id) manager_id, id as team_id, department_code
  from public.teams
  where manager_id is not null
  order by manager_id, created_at desc
)
update public.leads l
set team_id = m.team_id
from latest_managed_team m
where l.owner_id = m.manager_id
  and l.team_id is null
  and l.department_code = m.department_code;
