-- =============================================================================
-- DYNAMIC ROLES & PERMISSIONS
-- =============================================================================
-- Replaces the fixed `role_tier` enum (boss / super_admin / admin / manager /
-- sale) and every hard-coded `current_role() = 'admin'` check with data:
--
--   roles             — what roles exist (built-in and custom)
--   permissions       — the catalog of things a role can be allowed to do,
--                       each with the scopes it supports
--   role_permissions  — which permissions a role holds, and at what scope
--
-- A scope says *how much* of the data a permission covers:
--   own         — rows that are yours (you own the lead / you are the person)
--   team        — plus rows filed under teams you manage
--   department  — plus everything in your own department
--   all         — everything, across departments
--
-- The five built-in roles are seeded with exactly the access they had before
-- this migration (verified row-by-row against the old policies), so applying
-- it changes nothing for existing users. New roles are rows, not code.
--
-- Escalation guards (enforced here, not just in the UI):
--   * Nobody can grant a permission, or assign a role, wider than their own.
--   * The owner role (Boss) always has every permission, can't be edited or
--     deleted, and can only be assigned by another owner.
--   * You can only edit roles junior to your own (higher `rank`).
-- =============================================================================


-- 1. Catalog tables -----------------------------------------------------------

create table if not exists public.roles (
  key                  text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name                 text not null check (length(trim(name)) between 1 and 60),
  name_mm              text,
  description          text,
  -- Seniority: lower is more senior. Orders role lists and decides who may
  -- edit whom (you can only edit roles with a higher rank than your own).
  rank                 integer not null check (rank >= 0),
  -- Built-in roles can be re-permissioned but not deleted.
  is_system            boolean not null default false,
  -- The single all-access role. Its permissions are implicit (always every
  -- permission at its widest scope), so it can never be locked out.
  is_owner             boolean not null default false,
  -- Department-scoped roles must belong to a department; global roles
  -- (Boss / Super Admin) don't.
  requires_department  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists roles_single_owner on public.roles (is_owner) where is_owner;

create table if not exists public.permissions (
  key          text primary key,
  category     text not null,
  -- Scopes this permission supports, narrowest first. A yes/no permission
  -- has just {all}.
  scopes       text[] not null check (scopes <@ array['own', 'team', 'department', 'all']::text[] and cardinality(scopes) > 0),
  sort_order   integer not null default 0,
  description  text not null,
  -- 'access' grants data or actions. 'capability' only makes the holder
  -- eligible for something others grant (being a team's manager, being
  -- assigned enquiries) — it doesn't count when checking for escalation.
  kind         text not null default 'access' check (kind in ('access', 'capability'))
);

create table if not exists public.role_permissions (
  role_key        text not null references public.roles(key) on delete cascade,
  permission_key  text not null references public.permissions(key) on delete cascade,
  scope           text not null check (scope in ('own', 'team', 'department', 'all')),
  primary key (role_key, permission_key)
);

create index if not exists idx_role_permissions_permission on public.role_permissions(permission_key);


-- 2. Permission catalog -------------------------------------------------------
-- Owned by code: re-running refreshes descriptions and allowed scopes.

insert into public.permissions (key, category, scopes, sort_order, description, kind) values
  ('leads.view',               'leads',      '{own,team,department,all}', 10,  'See leads and their history, follow-ups, appointments and site visits', 'access'),
  ('leads.edit',               'leads',      '{own,team,department,all}', 20,  'Edit lead details and move leads through the pipeline', 'access'),
  ('leads.followup',           'leads',      '{own,team,department,all}', 30,  'Log follow-ups, appointments and site visits', 'access'),
  ('leads.reassign',           'leads',      '{team,department,all}',     40,  'Assign or reassign leads to other staff', 'access'),
  ('leads.delete',             'leads',      '{own,team,department,all}', 50,  'Delete leads', 'access'),
  ('leads.import',             'leads',      '{all}',                     60,  'Import leads from a spreadsheet', 'access'),
  ('leads.bulk_delete',        'leads',      '{all}',                     70,  'Select and delete many leads at once', 'access'),
  ('enquiries.view',           'enquiries',  '{own,team,department,all}', 110, 'See enquiries', 'access'),
  ('enquiries.create',         'enquiries',  '{department,all}',          120, 'Log new enquiries and assign them to staff', 'access'),
  ('enquiries.manage',         'enquiries',  '{department,all}',          130, 'Correct or delete other people''s pending enquiries', 'access'),
  ('enquiries.manage_accepted','enquiries',  '{all}',                     140, 'Also correct or delete enquiries after they''re accepted', 'access'),
  ('enquiries.receive',        'enquiries',  '{all}',                     150, 'Can be assigned enquiries', 'capability'),
  ('staff.view',               'staff',      '{team,department,all}',     210, 'See staff profiles (department-wide or wider opens the Staff page)', 'access'),
  ('staff.manage',             'staff',      '{all}',                     220, 'Create, edit, deactivate and delete staff accounts; reset passwords', 'access'),
  ('staff.warn',               'staff',      '{team,department,all}',     230, 'Issue warnings to staff', 'access'),
  ('staff.notify',             'staff',      '{all}',                     240, 'Send push notifications to other staff', 'access'),
  ('attendance.manage',        'staff',      '{team,department,all}',     250, 'See and adjust other people''s check-ins', 'access'),
  ('attendance.delete',        'staff',      '{all}',                     260, 'Delete check-in records', 'access'),
  ('teams.view',               'teams',      '{department,all}',          310, 'See teams', 'access'),
  ('teams.manage',             'teams',      '{department,all}',          320, 'Create teams and change their members', 'access'),
  ('teams.lead',               'teams',      '{all}',                     330, 'Can be a team''s manager', 'capability'),
  ('teams.join',               'teams',      '{all}',                     340, 'Can be a team member', 'capability'),
  ('reports.kpi',              'reports',    '{all}',                     410, 'KPI board and analytics', 'access'),
  ('reports.team_activity',    'reports',    '{all}',                     420, 'Team activity', 'access'),
  ('reports.project_insights', 'reports',    '{all}',                     430, 'Project insights', 'access'),
  ('catalog.manage',           'system',     '{all}',                     510, 'Manage the project and lead-source lists', 'access'),
  ('map.manage',               'system',     '{all}',                     520, 'Edit or delete anyone''s map pins', 'access'),
  ('system.configure',         'system',     '{all}',                     530, 'Departments, attendance windows, system settings and backups', 'access'),
  ('audit.view',               'system',     '{all}',                     540, 'Read the audit log', 'access'),
  ('roles.manage',             'system',     '{all}',                     550, 'Create and edit roles and their permissions', 'access')
on conflict (key) do update
  set category = excluded.category, scopes = excluded.scopes,
      sort_order = excluded.sort_order, description = excluded.description, kind = excluded.kind;


-- 3. Built-in roles, seeded with their pre-migration access -------------------
-- `on conflict do nothing`: re-running never overwrites an admin's edits.

insert into public.roles (key, name, name_mm, rank, is_system, is_owner, requires_department) values
  ('boss',        'Boss',         'ဘော့စ်',              0,  true, true,  false),
  ('super_admin', 'Super Admin',  'အကြီးတန်း Admin',      10, true, false, false),
  ('admin',       'Admin',        'Admin',               20, true, false, true),
  ('manager',     'Manager',      'မန်နေဂျာ',             30, true, false, true),
  ('sale',        'Sales Person', 'အရောင်းဝန်ထမ်း',        40, true, false, true)
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key, scope)
select v.role_key, v.permission_key, v.scope
from (values
  -- Super Admin: everything, globally (Boss is the owner role — implicit).
  ('super_admin', 'leads.view', 'all'), ('super_admin', 'leads.edit', 'all'),
  ('super_admin', 'leads.followup', 'all'), ('super_admin', 'leads.reassign', 'all'),
  ('super_admin', 'leads.delete', 'all'), ('super_admin', 'leads.import', 'all'),
  ('super_admin', 'leads.bulk_delete', 'all'),
  ('super_admin', 'enquiries.view', 'all'), ('super_admin', 'enquiries.create', 'all'),
  ('super_admin', 'enquiries.manage', 'all'), ('super_admin', 'enquiries.manage_accepted', 'all'),
  ('super_admin', 'staff.view', 'all'), ('super_admin', 'staff.manage', 'all'),
  ('super_admin', 'staff.warn', 'all'), ('super_admin', 'staff.notify', 'all'),
  ('super_admin', 'attendance.manage', 'all'), ('super_admin', 'attendance.delete', 'all'),
  ('super_admin', 'teams.view', 'all'), ('super_admin', 'teams.manage', 'all'),
  ('super_admin', 'reports.kpi', 'all'), ('super_admin', 'reports.team_activity', 'all'),
  ('super_admin', 'reports.project_insights', 'all'),
  ('super_admin', 'catalog.manage', 'all'), ('super_admin', 'map.manage', 'all'),
  ('super_admin', 'system.configure', 'all'), ('super_admin', 'audit.view', 'all'),
  ('super_admin', 'roles.manage', 'all'),
  -- Admin: their own department.
  ('admin', 'leads.view', 'department'), ('admin', 'leads.edit', 'department'),
  ('admin', 'leads.followup', 'department'), ('admin', 'leads.reassign', 'department'),
  ('admin', 'leads.import', 'all'),
  ('admin', 'enquiries.view', 'department'), ('admin', 'enquiries.create', 'department'),
  ('admin', 'enquiries.manage', 'department'),
  ('admin', 'staff.view', 'department'), ('admin', 'staff.warn', 'department'),
  ('admin', 'staff.notify', 'all'), ('admin', 'attendance.manage', 'department'),
  ('admin', 'teams.view', 'department'), ('admin', 'teams.manage', 'department'),
  ('admin', 'reports.team_activity', 'all'), ('admin', 'reports.project_insights', 'all'),
  ('admin', 'catalog.manage', 'all'),
  -- Manager: the teams they run, plus their own leads.
  ('manager', 'leads.view', 'team'), ('manager', 'leads.edit', 'own'),
  ('manager', 'leads.followup', 'own'), ('manager', 'leads.reassign', 'team'),
  ('manager', 'leads.delete', 'own'), ('manager', 'leads.import', 'all'),
  ('manager', 'enquiries.view', 'own'), ('manager', 'enquiries.receive', 'all'),
  ('manager', 'staff.view', 'team'), ('manager', 'staff.warn', 'team'),
  ('manager', 'attendance.manage', 'team'),
  ('manager', 'teams.view', 'department'), ('manager', 'teams.lead', 'all'),
  ('manager', 'reports.team_activity', 'all'), ('manager', 'reports.project_insights', 'all'),
  ('manager', 'catalog.manage', 'all'),
  -- Sales Person: their own work.
  ('sale', 'leads.view', 'own'), ('sale', 'leads.edit', 'own'),
  ('sale', 'leads.followup', 'own'), ('sale', 'leads.delete', 'own'),
  ('sale', 'enquiries.view', 'own'), ('sale', 'enquiries.receive', 'all'),
  ('sale', 'teams.view', 'department'), ('sale', 'teams.join', 'all')
) as v(role_key, permission_key, scope)
where not exists (select 1 from public.role_permissions rp where rp.role_key = v.role_key)
on conflict do nothing;


-- 4. Drop every policy that names a role ---------------------------------------

drop policy if exists departments_write on public.departments;
drop policy if exists attendance_settings_write on public.attendance_settings;
drop policy if exists teams_select on public.teams;
drop policy if exists teams_write on public.teams;
drop policy if exists team_members_select on public.team_members;
drop policy if exists team_members_write on public.team_members;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
drop policy if exists leads_select on public.leads;
drop policy if exists leads_update on public.leads;
drop policy if exists leads_delete on public.leads;
drop policy if exists lead_assignments_select on public.lead_assignments;
drop policy if exists enquiries_select on public.enquiries;
drop policy if exists enquiries_insert on public.enquiries;
drop policy if exists enquiries_update on public.enquiries;
drop policy if exists enquiries_delete on public.enquiries;
drop policy if exists followups_select on public.follow_ups;
drop policy if exists followups_insert on public.follow_ups;
drop policy if exists followups_update on public.follow_ups;
drop policy if exists pipeline_history_select on public.pipeline_history;
drop policy if exists appointments_select on public.appointments;
drop policy if exists appointments_write on public.appointments;
drop policy if exists site_visits_select on public.site_visits;
drop policy if exists site_visits_write on public.site_visits;
drop policy if exists warnings_select on public.warnings;
drop policy if exists warnings_insert on public.warnings;
drop policy if exists checkins_select on public.check_ins;
drop policy if exists checkins_update on public.check_ins;
drop policy if exists checkins_delete on public.check_ins;
drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists settings_select on public.settings;
drop policy if exists settings_write on public.settings;
drop policy if exists avatar_photos_insert on storage.objects;
drop policy if exists map_pins_update on public.map_pins;
drop policy if exists map_pins_delete on public.map_pins;
drop policy if exists enquiry_sources_insert on public.enquiry_sources;
drop policy if exists enquiry_sources_update on public.enquiry_sources;
drop policy if exists enquiry_sources_delete on public.enquiry_sources;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;


-- 5. role_tier enum -> text referencing roles ----------------------------------

alter table public.profiles drop constraint if exists profiles_department_required_for_scoped_roles;
do $$ begin
  if (select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'role') <> 'text' then
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type text using role::text;
    alter table public.profiles alter column role set default 'sale';
  end if;
end $$;
alter table public.profiles drop constraint if exists profiles_role_fkey;
alter table public.profiles add constraint profiles_role_fkey
  foreign key (role) references public.roles(key) on update restrict on delete restrict;

drop function if exists public.is_exec();
drop function if exists public.is_admin_or_above();
drop function if exists public.is_manager_or_above();
drop function if exists public.current_role();
drop function if exists public.owns_lead(uuid);
drop function if exists public.lead_in_my_department(uuid);
drop type if exists public.role_tier;


-- 6. Resolver -----------------------------------------------------------------

create or replace function public.scope_rank(p_scope text) returns integer
language sql immutable as $$
  select case p_scope when 'own' then 1 when 'team' then 2 when 'department' then 3 when 'all' then 4 else 0 end;
$$;

-- A role's scope for a permission, 0-4. Unknown permission keys resolve to 0
-- (fail closed), and the owner role always gets the widest scope offered.
create or replace function public.role_scope(p_role text, p_permission text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when r.is_owner then (select max(public.scope_rank(s)) from unnest(pm.scopes) s)
      else coalesce(public.scope_rank(rp.scope), 0)
    end
    from public.roles r
    join public.permissions pm on pm.key = p_permission
    left join public.role_permissions rp on rp.role_key = r.key and rp.permission_key = pm.key
    where r.key = p_role
  ), 0);
$$;

create or replace function public.user_scope(p_user uuid, p_permission text) returns integer
language sql stable security definer set search_path = public as $$
  select public.role_scope((select role from public.profiles where id = p_user), p_permission);
$$;

-- What RLS policies call. Wrap in `(select ...)` inside a policy so Postgres
-- evaluates it once per statement rather than once per row.
create or replace function public.my_scope(p_permission text) returns integer
language sql stable security definer set search_path = public as $$
  select public.user_scope(auth.uid(), p_permission);
$$;

create or replace function public.has_permission(p_permission text, p_min_scope text default 'own') returns boolean
language sql stable as $$
  select public.my_scope(p_permission) >= greatest(public.scope_rank(p_min_scope), 1);
$$;

-- Is every permission in p_role within what p_user holds? The owner role is
-- only "within" another owner. This is the anti-escalation check.
create or replace function public.role_within_user(p_role text, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    case when (select is_owner from public.roles where key = p_role)
      then coalesce((select r.is_owner from public.profiles p join public.roles r on r.key = p.role where p.id = p_user), false)
      else not exists (
        select 1 from public.permissions pm
        where pm.kind = 'access'
          and public.role_scope(p_role, pm.key) > public.user_scope(p_user, pm.key)
      )
    end;
$$;

-- Edge Functions (service role) ask on behalf of the caller.
create or replace function public.user_can_assign_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roles where key = p_role)
     and public.user_scope(p_user, 'staff.manage') >= 4
     and public.role_within_user(p_role, p_user);
$$;

revoke execute on function public.role_scope(text, text) from public, anon, authenticated;
revoke execute on function public.user_scope(uuid, text) from public, anon, authenticated;
revoke execute on function public.role_within_user(text, uuid) from public, anon, authenticated;
revoke execute on function public.user_can_assign_role(uuid, text) from public, anon, authenticated;
grant execute on function public.role_scope(text, text) to service_role;
grant execute on function public.user_scope(uuid, text) to service_role;
grant execute on function public.role_within_user(text, uuid) to service_role;
grant execute on function public.user_can_assign_role(uuid, text) to service_role;


-- 7. Scope predicates ---------------------------------------------------------
-- One definition of "is this row inside my scope" per data shape, so every
-- policy agrees. All return false, never null: plpgsql treats `if not null`
-- as "don't raise", which would silently authorize.
--
-- Leads: `own` means leads you own. Pass p_owner = null to ignore ownership
-- (reassigning was never granted just for owning the lead).
-- People: scope covers the people you oversee — never yourself. Policies
-- that should include "your own row" say so explicitly.

create or replace function public.lead_in_scope(p_scope integer, p_owner uuid, p_dept text, p_team uuid) returns boolean
language sql stable as $$
  select coalesce(
    p_scope >= 4
    or (p_scope >= 3 and p_dept = public.current_department())
    or (p_scope >= 2 and p_team is not null and public.manages_team(p_team))
    or (p_scope >= 1 and p_owner = auth.uid()),
    false);
$$;

create or replace function public.person_in_scope(p_scope integer, p_person uuid, p_dept text) returns boolean
language sql stable as $$
  select coalesce(
    p_scope >= 4
    or (p_scope >= 3 and p_dept = public.current_department())
    or (p_scope >= 2 and public.manages_person(p_person)),
    false);
$$;

create or replace function public.dept_in_scope(p_scope integer, p_dept text) returns boolean
language sql stable as $$
  select coalesce(p_scope >= 4 or (p_scope >= 3 and p_dept = public.current_department()), false);
$$;

-- For child tables (follow-ups, appointments, …): looks the lead up without
-- going through leads RLS, then applies the caller's scope for p_permission.
create or replace function public.lead_permitted(p_lead_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and public.lead_in_scope(public.my_scope(p_permission), l.owner_id, l.department_code, l.team_id)
  );
$$;

create or replace function public.profile_department(p_person uuid) returns text
language sql stable security definer set search_path = public as $$
  select department_code from public.profiles where id = p_person;
$$;

create or replace function public.team_department(p_team uuid) returns text
language sql stable security definer set search_path = public as $$
  select department_code from public.teams where id = p_team;
$$;

create or replace function public.can_manage_lead_photos(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (public.lead_in_scope(public.my_scope('leads.view'), l.owner_id, l.department_code, l.team_id)
           or l.created_by = auth.uid())
  );
$$;


-- 8. Triggers that encoded role names ------------------------------------------

-- Replaces the profiles_department_required_for_scoped_roles CHECK, which
-- can't read another table.
create or replace function public.enforce_profile_role_department() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.department_code is null
     and coalesce((select requires_department from public.roles where key = new.role), true) then
    raise exception 'The % role requires a department.', new.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_role_department on public.profiles;
create trigger trg_profiles_role_department before insert or update of role, department_code on public.profiles
  for each row execute function public.enforce_profile_role_department();

create or replace function public.enforce_profile_update_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.department_code is distinct from old.department_code
      or new.status is distinct from old.status) then
    if public.my_scope('staff.manage') < 4 then
      raise exception 'You don''t have permission to change role, department, or status';
    end if;
    -- You can't manage someone whose access exceeds yours…
    if not public.role_within_user(old.role, auth.uid()) then
      raise exception 'You can''t change an account whose role has more access than yours';
    end if;
    -- …or hand out more access than you have.
    if new.role is distinct from old.role and not public.role_within_user(new.role, auth.uid()) then
      raise exception 'You can''t assign a role with more access than your own';
    end if;
  end if;

  insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
  values ('user_updated', 'profiles', new.id, auth.uid(),
          jsonb_build_object('role', old.role, 'department_code', old.department_code, 'status', old.status),
          jsonb_build_object('role', new.role, 'department_code', new.department_code, 'status', new.status));

  return new;
end;
$$;

create or replace function public.enforce_team_manager_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
begin
  if new.manager_id is not null then
    if public.user_scope(new.manager_id, 'teams.lead') = 0 then
      raise exception 'A team''s manager must have a role that can lead teams.';
    end if;
    select department_code into v_dept from public.profiles where id = new.manager_id;
    if v_dept is distinct from new.department_code then
      raise exception 'A manager can only run teams inside their own department.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_team_member_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
  v_team_dept text;
begin
  select department_code into v_dept from public.profiles where id = new.sale_person_id;
  select department_code into v_team_dept from public.teams where id = new.team_id;
  if public.user_scope(new.sale_person_id, 'teams.join') = 0 then
    raise exception 'Only staff whose role can join teams can be added to a team.';
  end if;
  if v_dept is distinct from v_team_dept then
    raise exception 'A sales person can only join teams inside their own department.';
  end if;
  return new;
end;
$$;

create or replace function public.reassign_lead(p_lead_id uuid, p_new_owner uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
  v_team uuid;
begin
  select department_code, team_id into v_dept, v_team from public.leads where id = p_lead_id;

  -- Ownership alone never grants reassignment, hence p_owner = null.
  if not public.lead_in_scope(public.my_scope('leads.reassign'), null, v_dept, v_team) then
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


-- 9. Policies -------------------------------------------------------------------

create policy departments_write on public.departments for all
  to authenticated using (public.has_permission('system.configure')) with check (public.has_permission('system.configure'));

create policy attendance_settings_write on public.attendance_settings for all
  to authenticated using (public.has_permission('system.configure')) with check (public.has_permission('system.configure'));

create policy teams_select on public.teams for select
  to authenticated using (public.dept_in_scope((select public.my_scope('teams.view')), department_code));

create policy teams_write on public.teams for all
  to authenticated
  using (public.dept_in_scope((select public.my_scope('teams.manage')), department_code))
  with check (public.dept_in_scope((select public.my_scope('teams.manage')), department_code));

create policy team_members_select on public.team_members for select
  to authenticated using (
    sale_person_id = auth.uid()
    or public.manages_team(team_id)
    or public.dept_in_scope((select public.my_scope('teams.manage')), public.team_department(team_id))
  );

create policy team_members_write on public.team_members for all
  to authenticated
  using (public.dept_in_scope((select public.my_scope('teams.manage')), public.team_department(team_id)))
  with check (public.dept_in_scope((select public.my_scope('teams.manage')), public.team_department(team_id)));

-- Team members (roles with teams.join) can see the managers of their teams,
-- so a sales person's profile can show "Manager: <name>".
create policy profiles_select on public.profiles for select
  to authenticated using (
    id = auth.uid()
    or public.person_in_scope((select public.my_scope('staff.view')), id, department_code)
    or (public.is_my_team_manager(id) and public.has_permission('teams.join'))
  );

create policy profiles_update on public.profiles for update
  to authenticated using (id = auth.uid() or public.has_permission('staff.manage'))
  with check (id = auth.uid() or public.has_permission('staff.manage'));

create policy profiles_delete on public.profiles for delete
  to authenticated using (public.has_permission('staff.manage'));

create policy leads_select on public.leads for select
  to authenticated using (public.lead_in_scope((select public.my_scope('leads.view')), owner_id, department_code, team_id));

create policy leads_update on public.leads for update
  to authenticated
  using (public.lead_in_scope((select public.my_scope('leads.edit')), owner_id, department_code, team_id))
  with check (public.lead_in_scope((select public.my_scope('leads.edit')), owner_id, department_code, team_id));

create policy leads_delete on public.leads for delete
  to authenticated using (public.lead_in_scope((select public.my_scope('leads.delete')), owner_id, department_code, team_id));

create policy lead_assignments_select on public.lead_assignments for select
  to authenticated using (public.lead_permitted(lead_id, 'leads.view'));

-- Enquiries have no department column: scope follows the assignee.
create policy enquiries_select on public.enquiries for select
  to authenticated using (
    (assigned_to = auth.uid() and public.has_permission('enquiries.view'))
    or public.person_in_scope((select public.my_scope('enquiries.view')), assigned_to, public.profile_department(assigned_to))
  );

create policy enquiries_insert on public.enquiries for insert
  to authenticated with check (
    assigned_by = auth.uid()
    and public.person_in_scope((select public.my_scope('enquiries.create')), assigned_to, public.profile_department(assigned_to))
  );

-- The assignee works their own enquiry; managers of it may correct it while
-- pending (or at any status with enquiries.manage_accepted).
create policy enquiries_update on public.enquiries for update
  to authenticated using (
    (assigned_to = auth.uid() and public.has_permission('enquiries.view'))
    or (public.person_in_scope((select public.my_scope('enquiries.manage')), assigned_to, public.profile_department(assigned_to))
        and (status = 'pending' or public.has_permission('enquiries.manage_accepted')))
  )
  with check (
    (assigned_to = auth.uid() and public.has_permission('enquiries.view'))
    or public.person_in_scope((select public.my_scope('enquiries.manage')), assigned_to, public.profile_department(assigned_to))
  );

create policy enquiries_delete on public.enquiries for delete
  to authenticated using (
    public.person_in_scope((select public.my_scope('enquiries.manage')), assigned_to, public.profile_department(assigned_to))
    and (status = 'pending' or public.has_permission('enquiries.manage_accepted'))
  );

create policy followups_select on public.follow_ups for select
  to authenticated using (public.lead_permitted(lead_id, 'leads.view'));

create policy followups_insert on public.follow_ups for insert
  to authenticated with check (public.lead_permitted(lead_id, 'leads.followup'));

create policy followups_update on public.follow_ups for update
  to authenticated using (public.lead_permitted(lead_id, 'leads.followup'));

create policy pipeline_history_select on public.pipeline_history for select
  to authenticated using (public.lead_permitted(lead_id, 'leads.view'));

create policy appointments_select on public.appointments for select
  to authenticated using (public.lead_permitted(lead_id, 'leads.view'));

create policy appointments_write on public.appointments for all
  to authenticated
  using (public.lead_permitted(lead_id, 'leads.followup'))
  with check (public.lead_permitted(lead_id, 'leads.followup'));

create policy site_visits_select on public.site_visits for select
  to authenticated using (public.lead_permitted(lead_id, 'leads.view'));

create policy site_visits_write on public.site_visits for all
  to authenticated
  using (public.lead_permitted(lead_id, 'leads.followup'))
  with check (public.lead_permitted(lead_id, 'leads.followup'));

-- Everyone sees warnings issued to them.
create policy warnings_select on public.warnings for select
  to authenticated using (
    issued_to = auth.uid()
    or public.person_in_scope((select public.my_scope('staff.view')), issued_to, public.profile_department(issued_to))
  );

create policy warnings_insert on public.warnings for insert
  to authenticated with check (
    public.person_in_scope((select public.my_scope('staff.warn')), issued_to, public.profile_department(issued_to))
  );

create policy checkins_select on public.check_ins for select
  to authenticated using (
    employee_id = auth.uid()
    or public.person_in_scope((select public.my_scope('attendance.manage')), employee_id, department_code)
  );

create policy checkins_update on public.check_ins for update
  to authenticated using (
    (employee_id = auth.uid() and check_in_date = current_date)
    or public.person_in_scope((select public.my_scope('attendance.manage')), employee_id, department_code)
  );

create policy checkins_delete on public.check_ins for delete
  to authenticated using (public.has_permission('attendance.delete'));

create policy audit_logs_select on public.audit_logs for select
  to authenticated using (public.has_permission('audit.view'));

create policy settings_select on public.settings for select
  to authenticated using (public.has_permission('system.configure'));

create policy settings_write on public.settings for all
  to authenticated using (public.has_permission('system.configure')) with check (public.has_permission('system.configure'));

create policy avatar_photos_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.has_permission('staff.manage'))
  );

create policy map_pins_update on public.map_pins for update
  to authenticated using (created_by = auth.uid() or public.has_permission('map.manage'));

create policy map_pins_delete on public.map_pins for delete
  to authenticated using (created_by = auth.uid() or public.has_permission('map.manage'));

create policy enquiry_sources_insert on public.enquiry_sources for insert
  to authenticated with check (public.has_permission('catalog.manage'));

create policy enquiry_sources_update on public.enquiry_sources for update
  to authenticated using (public.has_permission('catalog.manage')) with check (public.has_permission('catalog.manage'));

create policy enquiry_sources_delete on public.enquiry_sources for delete
  to authenticated using (public.has_permission('catalog.manage'));

create policy projects_insert on public.projects for insert
  to authenticated with check (public.has_permission('catalog.manage'));

create policy projects_update on public.projects for update
  to authenticated using (public.has_permission('catalog.manage')) with check (public.has_permission('catalog.manage'));

create policy projects_delete on public.projects for delete
  to authenticated using (public.has_permission('catalog.manage'));


-- 10. Who may edit roles --------------------------------------------------------

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- Role definitions aren't secret: every signed-in user needs them to label
-- people and to know what their own role allows.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated using (true);
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated using (true);
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all
  to authenticated using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all
  to authenticated using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
-- permissions is code-owned: no write policy.

create or replace function public.my_role_rank() returns integer
language sql stable security definer set search_path = public as $$
  select r.rank from public.profiles p join public.roles r on r.key = p.role where p.id = auth.uid();
$$;

-- Guards that RLS alone can't express. Skipped when there's no signed-in
-- user (migrations, service role), which RLS already blocks for clients.
create or replace function public.enforce_role_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_my_rank integer := public.my_role_rank();
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.is_owner then
      raise exception 'The % role can''t be changed or deleted.', old.name;
    end if;
    if old.rank <= v_my_rank then
      raise exception 'You can only change roles junior to your own.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Built-in roles can''t be deleted.';
    end if;
    if exists (select 1 from public.profiles where role = old.key) then
      raise exception 'Move everyone off the % role before deleting it.', old.name;
    end if;
    return old;
  end if;

  if new.is_owner then
    raise exception 'There can only be one owner role.';
  end if;
  if new.rank <= v_my_rank then
    raise exception 'A role must be junior to your own (rank above %).', v_my_rank;
  end if;
  if tg_op = 'INSERT' then
    new.is_system := false;
  else
    if new.key is distinct from old.key then
      raise exception 'A role''s key can''t be changed.';
    end if;
    new.is_system := old.is_system;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_roles_rules on public.roles;
create trigger trg_roles_rules before insert or update or delete on public.roles
  for each row execute function public.enforce_role_rules();

create or replace function public.enforce_role_permission_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.roles%rowtype;
  v_allowed text[];
  v_kind text;
begin
  select * into v_role from public.roles where key = coalesce(new.role_key, old.role_key);

  if tg_op <> 'DELETE' then
    select scopes, kind into v_allowed, v_kind from public.permissions where key = new.permission_key;
    if not (new.scope = any (v_allowed)) then
      raise exception 'Permission % doesn''t support the "%" scope.', new.permission_key, new.scope;
    end if;
  end if;

  -- Cascading deletes from roles, and setup with no signed-in user, skip the
  -- per-user checks.
  if auth.uid() is null or v_role.key is null then
    return coalesce(new, old);
  end if;

  if v_role.is_owner then
    raise exception 'The % role always has every permission.', v_role.name;
  end if;
  if v_role.rank <= public.my_role_rank() then
    raise exception 'You can only change roles junior to your own.';
  end if;
  if tg_op <> 'DELETE' and v_kind = 'access'
     and public.scope_rank(new.scope) > public.my_scope(new.permission_key) then
    raise exception 'You can''t grant % wider than you hold it.', new.permission_key;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_role_permissions_rules on public.role_permissions;
create trigger trg_role_permissions_rules before insert or update or delete on public.role_permissions
  for each row execute function public.enforce_role_permission_rules();


-- Saves a role and its complete permission set in one transaction, so a
-- failed save never leaves a role half-updated. Security invoker: RLS and
-- the guard triggers above decide what's allowed. p_grants maps permission
-- key -> scope; permissions not in it are removed. Only rows that actually
-- change are written, so unchanged grants never trip the guards (or the
-- audit log).
create or replace function public.save_role(
  p_key text,
  p_name text,
  p_name_mm text,
  p_description text,
  p_rank integer,
  p_requires_department boolean,
  p_grants jsonb
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  insert into public.roles as r (key, name, name_mm, description, rank, requires_department)
  values (p_key, trim(p_name), nullif(trim(p_name_mm), ''), nullif(trim(p_description), ''), p_rank, p_requires_department)
  on conflict (key) do update
    set name = excluded.name, name_mm = excluded.name_mm, description = excluded.description,
        rank = excluded.rank, requires_department = excluded.requires_department
    where (r.name, r.name_mm, r.description, r.rank, r.requires_department)
          is distinct from (excluded.name, excluded.name_mm, excluded.description, excluded.rank, excluded.requires_department);

  delete from public.role_permissions rp
  where rp.role_key = p_key and not (p_grants ? rp.permission_key);

  insert into public.role_permissions (role_key, permission_key, scope)
  select p_key, g.key, g.value
  from jsonb_each_text(p_grants) g
  where not exists (
    select 1 from public.role_permissions rp
    where rp.role_key = p_key and rp.permission_key = g.key and rp.scope = g.value
  )
  on conflict (role_key, permission_key) do update set scope = excluded.scope;
end;
$$;

-- 11. Audit trail ------------------------------------------------------------------

create or replace function public.audit_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (action, target_table, performed_by, old_value, new_value)
  values ('role_' || lower(tg_op), 'roles', auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_roles_audit on public.roles;
create trigger trg_roles_audit after insert or update or delete on public.roles
  for each row execute function public.audit_roles();

create or replace function public.audit_role_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (action, target_table, performed_by, old_value, new_value)
  values ('role_permission_' || lower(tg_op), 'role_permissions', auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_role_permissions_audit on public.role_permissions;
create trigger trg_role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_role_permissions();


-- 12. Realtime: signed-in clients pick up permission edits immediately -------

do $$
declare
  t text;
begin
  foreach t in array array['roles', 'role_permissions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
