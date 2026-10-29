-- =============================================================================
-- BUILT-IN ROLE DEFAULTS + TEAM INTEGRITY
-- =============================================================================
-- 1. Built-in roles get a stored "factory default" (public.role_defaults), so
--    Role Management can show when one has been changed and put it back in
--    one step — and this migration restores any that have drifted.
-- 2. Team structure now stays consistent when people or roles change. Before,
--    moving someone to another department (or changing their role) moved
--    their leads but left their team memberships behind, so people could
--    still belong to — or run — teams in a department they had left, or
--    teams their new role can't be part of.
-- =============================================================================


-- 1. Factory defaults -----------------------------------------------------------
-- Code-owned: re-running refreshes them. Clients read them; nobody writes them.

create table if not exists public.role_defaults (
  role_key             text primary key references public.roles(key) on delete cascade,
  name                 text not null,
  name_mm              text,
  rank                 integer not null,
  requires_department  boolean not null,
  -- permission key -> scope, in the shape public.save_role() takes. The owner
  -- role's permissions are implicit, so its grants are empty.
  grants               jsonb not null default '{}'::jsonb
);

alter table public.role_defaults enable row level security;
drop policy if exists role_defaults_select on public.role_defaults;
create policy role_defaults_select on public.role_defaults for select to authenticated using (true);

insert into public.role_defaults (role_key, name, name_mm, rank, requires_department, grants) values
  ('boss', 'Boss', 'ဘော့စ်', 0, false,
   '{}'),
  ('super_admin', 'Super Admin', 'အကြီးတန်း Admin', 10, false,
   '{"leads.view": "all", "leads.edit": "all", "leads.followup": "all",
     "leads.reassign": "all", "leads.delete": "all", "leads.import": "all",
     "leads.bulk_delete": "all", "enquiries.view": "all", "enquiries.create": "all",
     "enquiries.manage": "all", "enquiries.manage_accepted": "all", "staff.view": "all",
     "staff.manage": "all", "staff.warn": "all", "staff.notify": "all",
     "attendance.manage": "all", "attendance.delete": "all", "teams.view": "all",
     "teams.manage": "all", "reports.kpi": "all", "reports.team_activity": "all",
     "reports.project_insights": "all", "catalog.manage": "all", "map.manage": "all",
     "system.configure": "all", "audit.view": "all", "roles.manage": "all"}'),
  ('admin', 'Admin', 'Admin', 20, true,
   '{"leads.view": "department", "leads.edit": "department", "leads.followup": "department",
     "leads.reassign": "department", "leads.import": "all", "enquiries.view": "department",
     "enquiries.create": "department", "enquiries.manage": "department", "staff.view": "department",
     "staff.warn": "department", "staff.notify": "all", "attendance.manage": "department",
     "teams.view": "department", "teams.manage": "department", "reports.team_activity": "all",
     "reports.project_insights": "all", "catalog.manage": "all"}'),
  ('manager', 'Manager', 'မန်နေဂျာ', 30, true,
   '{"leads.view": "team", "leads.edit": "own", "leads.followup": "own",
     "leads.reassign": "team", "leads.delete": "own", "leads.import": "all",
     "enquiries.view": "own", "enquiries.receive": "all", "staff.view": "team",
     "staff.warn": "team", "attendance.manage": "team", "teams.view": "department",
     "teams.lead": "all", "reports.team_activity": "all", "reports.project_insights": "all",
     "catalog.manage": "all"}'),
  ('sale', 'Sales Person', 'အရောင်းဝန်ထမ်း', 40, true,
   '{"leads.view": "own", "leads.edit": "own", "leads.followup": "own",
     "leads.delete": "own", "enquiries.view": "own", "enquiries.receive": "all",
     "teams.view": "department", "teams.join": "all"}')
on conflict (role_key) do update
  set name = excluded.name, name_mm = excluded.name_mm, rank = excluded.rank,
      requires_department = excluded.requires_department, grants = excluded.grants;


-- 2. Team integrity -------------------------------------------------------------
-- A person may only belong to teams in their own department, and only while
-- their role can join teams; likewise for running a team (teams.lead). These
-- rules were checked when someone was added to a team, but never again.

-- Removes whoever no longer qualifies, for one person (p_person) or for
-- everyone with one role (p_role) — or, with both null, everyone.
create or replace function public.enforce_team_eligibility(p_person uuid default null, p_role text default null)
returns void
language sql security definer set search_path = public as $$
  delete from public.team_members tm
  using public.teams t, public.profiles p
  where t.id = tm.team_id and p.id = tm.sale_person_id
    and (p_person is null or p.id = p_person)
    and (p_role is null or p.role = p_role)
    and (t.department_code is distinct from p.department_code or public.user_scope(p.id, 'teams.join') = 0);

  update public.teams t set manager_id = null
  from public.profiles p
  where p.id = t.manager_id
    and (p_person is null or p.id = p_person)
    and (p_role is null or p.role = p_role)
    and (t.department_code is distinct from p.department_code or public.user_scope(p.id, 'teams.lead') = 0);
$$;

revoke execute on function public.enforce_team_eligibility(uuid, text) from public, anon, authenticated;

create or replace function public.cascade_profile_team_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or new.department_code is distinct from old.department_code then
    perform public.enforce_team_eligibility(new.id, null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_team_rules on public.profiles;
create trigger trg_profiles_team_rules after update of role, department_code on public.profiles
  for each row execute function public.cascade_profile_team_rules();

create or replace function public.cascade_role_team_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.enforce_team_eligibility(null, old.role_key);
  return old;
end;
$$;

drop trigger if exists trg_role_permissions_team_rules on public.role_permissions;
create trigger trg_role_permissions_team_rules after delete on public.role_permissions
  for each row when (old.permission_key in ('teams.join', 'teams.lead'))
  execute function public.cascade_role_team_rules();


-- 3. Restore built-in roles that drifted from their defaults --------------------
-- save_role only writes what differs, so roles already at their defaults are
-- untouched. Every change lands in the audit log.

do $$
declare
  d record;
begin
  for d in
    select rd.*, r.description from public.role_defaults rd
    join public.roles r on r.key = rd.role_key
    where not r.is_owner
  loop
    perform public.save_role(d.role_key, d.name, d.name_mm, d.description, d.rank, d.requires_department, d.grants);
  end loop;
end $$;


-- 4. Clean up memberships that already break the rules --------------------------

select public.enforce_team_eligibility();

