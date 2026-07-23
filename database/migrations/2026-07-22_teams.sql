-- =============================================================================
-- Migration: Team layer under Department
-- =============================================================================
-- Adds public.teams / public.team_members, leads.team_id, and narrows the
-- Manager's RLS scope from "whole department" to "teams they manage" (Admin
-- and Boss/Super Admin are completely unaffected — still department-wide /
-- global respectively). Everything here is additive: new tables, a new
-- nullable column, and updated policies — no existing row is touched,
-- dropped, or reshaped. Run once in the Supabase SQL editor. Idempotent.
--
-- IMPORTANT — before running: the CHECK-constraint fix in step 4 requires
-- every existing 'admin' profile to already have a department_code (this
-- was supposed to happen when the 2026-07-12 admin-department-scope
-- migration ran). If you still have an Admin with a NULL department, assign
-- one first via User Management, or this migration will fail on that step.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- =============================================================================

-- =============================================================================
-- 1. TABLES
-- =============================================================================

create table if not exists public.teams (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  department_code  text not null references public.departments(code),
  manager_id       uuid references public.profiles(id),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists idx_teams_department on public.teams(department_code);
create index if not exists idx_teams_manager on public.teams(manager_id);

-- A salesperson can belong to more than one team (per product decision), so
-- this is a join table, not a column on profiles.
create table if not exists public.team_members (
  team_id          uuid not null references public.teams(id) on delete cascade,
  sale_person_id   uuid not null references public.profiles(id) on delete cascade,
  added_at         timestamptz not null default now(),
  primary key (team_id, sale_person_id)
);

create index if not exists idx_team_members_person on public.team_members(sale_person_id);

-- =============================================================================
-- 2. INTEGRITY TRIGGERS — keep team structure inside one department, so the
-- department stays the outer scope and teams/members can't cross department
-- lines by mistake.
-- =============================================================================

create or replace function public.enforce_team_manager_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.role_tier;
  v_dept text;
begin
  if new.manager_id is not null then
    select role, department_code into v_role, v_dept from public.profiles where id = new.manager_id;
    if v_role is distinct from 'manager' then
      raise exception 'A team''s manager must have the Manager role.';
    end if;
    if v_dept is distinct from new.department_code then
      raise exception 'A manager can only run teams inside their own department.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_teams_manager_rules on public.teams;
create trigger trg_teams_manager_rules before insert or update of manager_id, department_code on public.teams
  for each row execute function public.enforce_team_manager_rules();

create or replace function public.enforce_team_member_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.role_tier;
  v_dept text;
  v_team_dept text;
begin
  select role, department_code into v_role, v_dept from public.profiles where id = new.sale_person_id;
  select department_code into v_team_dept from public.teams where id = new.team_id;
  if v_role is distinct from 'sale' then
    raise exception 'Only Sales Person accounts can be added to a team.';
  end if;
  if v_dept is distinct from v_team_dept then
    raise exception 'A sales person can only join teams inside their own department.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_team_members_rules on public.team_members;
create trigger trg_team_members_rules before insert on public.team_members
  for each row execute function public.enforce_team_member_rules();

-- =============================================================================
-- 3. leads.team_id — nullable, so every existing lead keeps working
-- untouched (see manager_scoped_lead() below for the legacy fallback).
-- =============================================================================

alter table public.leads add column if not exists team_id uuid references public.teams(id);
create index if not exists idx_leads_team on public.leads(team_id);

create or replace function public.enforce_lead_team_department() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team_dept text;
begin
  if new.team_id is not null then
    select department_code into v_team_dept from public.teams where id = new.team_id;
    if v_team_dept is distinct from new.department_code then
      raise exception 'A lead''s team must belong to the same department as the lead.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_team_department on public.leads;
create trigger trg_leads_team_department before insert or update of team_id, department_code on public.leads
  for each row execute function public.enforce_lead_team_department();

-- =============================================================================
-- 4. BUGFIX — profiles_department_required_for_scoped_roles still exempted
-- 'admin' from requiring a department, contradicting the 2026-07-12
-- migration that made Admin department-scoped like Manager. See the
-- IMPORTANT note at the top of this file before running.
-- =============================================================================

alter table public.profiles drop constraint if exists profiles_department_required_for_scoped_roles;
alter table public.profiles add constraint profiles_department_required_for_scoped_roles check (
  role in ('boss', 'super_admin') or department_code is not null
);

-- =============================================================================
-- 5. HELPER FUNCTIONS (used by RLS policies below)
-- =============================================================================

create or replace function public.manages_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = p_team_id and manager_id = auth.uid());
$$;

create or replace function public.manages_person(p_person_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.sale_person_id = p_person_id and t.manager_id = auth.uid()
  );
$$;

-- Legacy fallback baked in: a lead with no team_id yet (i.e. every lead that
-- existed before this migration) is still visible to whichever manager
-- covers its whole department, exactly like before teams existed — nothing
-- already in Supabase loses visibility on day one. Reassign a lead to a
-- team (from the app) to move it onto the narrower, team-scoped rule.
create or replace function public.manager_scoped_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        (l.team_id is not null and public.manages_team(l.team_id))
        or (l.team_id is null and l.department_code = public.current_department())
      )
  );
$$;

-- =============================================================================
-- 6. RLS — teams / team_members
-- =============================================================================

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select
  to authenticated using (public.is_exec() or department_code = public.current_department());

drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all
  to authenticated
  using (public.is_exec() or (public.is_admin_or_above() and department_code = public.current_department()))
  with check (public.is_exec() or (public.is_admin_or_above() and department_code = public.current_department()));

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select
  to authenticated using (
    public.is_exec()
    or sale_person_id = auth.uid()
    or public.manages_team(team_id)
    or exists (
      select 1 from public.teams t where t.id = team_members.team_id
        and public.current_role() = 'admin' and t.department_code = public.current_department()
    )
  );

drop policy if exists team_members_write on public.team_members;
create policy team_members_write on public.team_members for all
  to authenticated
  using (
    public.is_exec()
    or exists (
      select 1 from public.teams t where t.id = team_members.team_id
        and public.current_role() = 'admin' and t.department_code = public.current_department()
    )
  )
  with check (
    public.is_exec()
    or exists (
      select 1 from public.teams t where t.id = team_members.team_id
        and public.current_role() = 'admin' and t.department_code = public.current_department()
    )
  );

-- =============================================================================
-- 7. RLS UPDATES — Manager branch narrows to team scope; Admin and
-- Boss/Super Admin branches are unchanged from database/crm.sql.
-- =============================================================================

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  to authenticated using (
    id = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and public.manages_person(id))
  );

-- ---- leads ----
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select
  to authenticated using (
    public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and (
          (team_id is not null and public.manages_team(team_id))
          or (team_id is null and department_code = public.current_department())
        ))
    or owner_id = auth.uid()
  );

-- leads_update is intentionally left as-is: a Manager's edit rights are
-- already gated on owner_id = auth.uid() regardless of team, so nothing
-- there needs to change.

-- ---- lead_assignments ----
drop policy if exists lead_assignments_select on public.lead_assignments;
create policy lead_assignments_select on public.lead_assignments for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l
      where l.id = lead_assignments.lead_id
        and (l.owner_id = auth.uid()
             or (public.current_role() = 'admin' and l.department_code = public.current_department())
             or (public.current_role() = 'manager' and public.manager_scoped_lead(l.id)))
    )
  );

-- ---- reassign_lead RPC ----
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
    or (public.current_role() = 'manager' and (
          (v_team is not null and public.manages_team(v_team))
          or (v_team is null and v_dept = public.current_department())
        ))
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

-- ---- follow_ups (insert/update unaffected — Manager never had write access
-- here per FRD "Follow-up = View Only for Manager"; only the select needs
-- the same team-scope narrowing as leads_select) ----
drop policy if exists followups_select on public.follow_ups;
create policy followups_select on public.follow_ups for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l where l.id = follow_ups.lead_id
        and ((public.current_role() = 'admin' and l.department_code = public.current_department())
             or (public.current_role() = 'manager' and public.manager_scoped_lead(l.id))
             or l.owner_id = auth.uid())
    )
  );

-- ---- pipeline_history ----
drop policy if exists pipeline_history_select on public.pipeline_history;
create policy pipeline_history_select on public.pipeline_history for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l where l.id = pipeline_history.lead_id
        and ((public.current_role() = 'admin' and l.department_code = public.current_department())
             or (public.current_role() = 'manager' and public.manager_scoped_lead(l.id))
             or l.owner_id = auth.uid())
    )
  );

-- ---- appointments (write unaffected — Manager only ever wrote as the
-- owning salesperson, via owns_lead) ----
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l where l.id = appointments.lead_id
        and ((public.current_role() = 'admin' and l.department_code = public.current_department())
             or (public.current_role() = 'manager' and public.manager_scoped_lead(l.id))
             or l.owner_id = auth.uid())
    )
  );

-- ---- site_visits (write unaffected, same reasoning as appointments) ----
drop policy if exists site_visits_select on public.site_visits;
create policy site_visits_select on public.site_visits for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l where l.id = site_visits.lead_id
        and ((public.current_role() = 'admin' and l.department_code = public.current_department())
             or (public.current_role() = 'manager' and public.manager_scoped_lead(l.id))
             or l.owner_id = auth.uid())
    )
  );

-- ---- warnings ----
drop policy if exists warnings_select on public.warnings;
create policy warnings_select on public.warnings for select
  to authenticated using (
    issued_to = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and exists (
      select 1 from public.profiles p where p.id = warnings.issued_to and p.department_code = public.current_department()
    ))
    or (public.current_role() = 'manager' and public.manages_person(warnings.issued_to))
  );

drop policy if exists warnings_insert on public.warnings;
create policy warnings_insert on public.warnings for insert
  to authenticated with check (
    public.is_exec()
    or (public.current_role() = 'admin' and exists (
      select 1 from public.profiles p where p.id = warnings.issued_to and p.department_code = public.current_department()
    ))
    or (public.current_role() = 'manager' and public.manages_person(warnings.issued_to))
  );

-- ---- check_ins ----
drop policy if exists checkins_select on public.check_ins;
create policy checkins_select on public.check_ins for select
  to authenticated using (
    employee_id = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and public.manages_person(employee_id))
  );

drop policy if exists checkins_update on public.check_ins;
create policy checkins_update on public.check_ins for update
  to authenticated using (
    (employee_id = auth.uid() and check_in_date = current_date)
    or public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and public.manages_person(employee_id))
  );

-- =============================================================================
-- 8. REALTIME — so the new Team Management page updates live like every
-- other CRUD screen in the app (departments, staff, leads, ...).
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams'
  ) then
    execute 'alter publication supabase_realtime add table public.teams';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_members'
  ) then
    execute 'alter publication supabase_realtime add table public.team_members';
  end if;
end $$;

-- =============================================================================
-- 9. BACKFILL — one default team per existing manager, so nobody's
-- visibility shrinks the moment this migration runs. Every salesperson in a
-- department is added to EVERY default team in that department — using the
-- new multi-team-membership feature itself to exactly reproduce today's
-- "manager sees the whole department" behavior until an Admin/exec
-- deliberately reorganizes teams via the new Team Management page. Existing
-- leads keep team_id = NULL, covered by the legacy fallback in
-- manager_scoped_lead()/leads_select above. Safe to re-run: skips managers
-- who already have a team.
-- =============================================================================

do $$
declare
  r_manager record;
  v_team_id uuid;
begin
  for r_manager in
    select id, name, department_code from public.profiles
    where role = 'manager' and department_code is not null
      and not exists (select 1 from public.teams t where t.manager_id = profiles.id)
  loop
    insert into public.teams (name, department_code, manager_id)
    values (r_manager.name || '''s Team', r_manager.department_code, r_manager.id)
    returning id into v_team_id;

    insert into public.team_members (team_id, sale_person_id)
    select v_team_id, p.id from public.profiles p
    where p.role = 'sale' and p.department_code = r_manager.department_code
    on conflict do nothing;
  end loop;
end $$;

-- =============================================================================
-- End of database/migrations/2026-07-22_teams.sql
-- =============================================================================
