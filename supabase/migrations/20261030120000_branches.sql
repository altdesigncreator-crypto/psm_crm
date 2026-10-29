-- =============================================================================
-- BRANCHES (Yangon, Mandalay, …)
-- =============================================================================
-- A branch owns departments: Yangon → Condo, House; Mandalay → Condo, House.
-- Staff, teams, leads and enquiries already belong to a department, so they
-- belong to its branch without a new column on any of them — and every
-- existing visibility rule (own / team / department) keeps each branch's
-- data inside that branch. Only roles with an "all" scope (Boss, Super
-- Admin) see across branches.
--
-- Also in this migration:
--   * a "branch" scope between department and all, for roles that should
--     see one whole branch (e.g. a branch manager);
--   * projects and lead sources become per-branch lists, and Admin/Manager
--     manage only their own branch's lists;
--   * departments record which list category (Condo / House & Land) they
--     use, instead of the app deriving it from the department's code;
--   * scope checks compare against named levels (scope_rank('all')) rather
--     than numbers, so the ladder can grow again without breaking them.
-- =============================================================================


-- 1. Branches -------------------------------------------------------------------

create table if not exists public.branches (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        text not null check (length(trim(name)) between 1 and 60),
  name_mm     text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.branches (code, name, name_mm, sort_order) values
  ('yangon',   'Yangon',   'ရန်ကုန်',  10),
  ('mandalay', 'Mandalay', 'မန္တလေး', 20)
on conflict (code) do nothing;


-- 2. Departments belong to a branch, and name their list category ------------

alter table public.departments add column if not exists branch_code text references public.branches(code);
update public.departments set branch_code = 'yangon' where branch_code is null;
alter table public.departments alter column branch_code set not null;
create index if not exists idx_departments_branch on public.departments(branch_code);

-- Which project / lead-source list (Condo or House & Land) the department's
-- forms use. Null for departments that use neither.
alter table public.departments add column if not exists category text check (category in ('condo', 'house_land'));
update public.departments set category = 'condo' where code = 'condo' and category is null;
update public.departments set category = 'house_land' where code = 'house' and category is null;

insert into public.departments (code, name, branch_code, category) values
  ('mdy_condo', 'Condo', 'mandalay', 'condo'),
  ('mdy_house', 'House', 'mandalay', 'house_land')
on conflict (code) do nothing;


-- 3. The scope ladder gains "branch" ----------------------------------------------
-- own < team < department < branch < all. Every function that compares
-- scopes is redefined below in this same transaction.

create or replace function public.scope_rank(p_scope text) returns integer
language sql immutable as $$
  select case p_scope
    when 'own' then 1 when 'team' then 2 when 'department' then 3 when 'branch' then 4 when 'all' then 5
    else 0 end;
$$;

alter table public.permissions drop constraint if exists permissions_scopes_check;
alter table public.permissions add constraint permissions_scopes_check
  check (scopes <@ array['own', 'team', 'department', 'branch', 'all']::text[] and cardinality(scopes) > 0);

alter table public.role_permissions drop constraint if exists role_permissions_scope_check;
alter table public.role_permissions add constraint role_permissions_scope_check
  check (scope in ('own', 'team', 'department', 'branch', 'all'));

-- Anything that can be department-wide can now also be branch-wide.
update public.permissions
  set scopes = array_append(array_remove(scopes, 'all'), 'branch') || array['all']
  where 'department' = any (scopes) and not 'branch' = any (scopes);

-- Lists are per branch now: managing them can be limited to your own branch.
update public.permissions set scopes = array['branch', 'all'], description = 'Manage the project and lead-source lists'
  where key = 'catalog.manage';


-- 4. Branch-aware helpers and scope predicates -----------------------------------

create or replace function public.department_branch(p_dept text) returns text
language sql stable security definer set search_path = public as $$
  select branch_code from public.departments where code = p_dept;
$$;

create or replace function public.current_branch() returns text
language sql stable security definer set search_path = public as $$
  select d.branch_code from public.profiles p
  join public.departments d on d.code = p.department_code
  where p.id = auth.uid();
$$;

create or replace function public.lead_in_scope(p_scope integer, p_owner uuid, p_dept text, p_team uuid) returns boolean
language sql stable as $$
  select coalesce(
    p_scope >= public.scope_rank('all')
    or (p_scope >= public.scope_rank('branch') and public.department_branch(p_dept) = public.current_branch())
    or (p_scope >= public.scope_rank('department') and p_dept = public.current_department())
    or (p_scope >= public.scope_rank('team') and p_team is not null and public.manages_team(p_team))
    or (p_scope >= public.scope_rank('own') and p_owner = auth.uid()),
    false);
$$;

create or replace function public.person_in_scope(p_scope integer, p_person uuid, p_dept text) returns boolean
language sql stable as $$
  select coalesce(
    p_scope >= public.scope_rank('all')
    or (p_scope >= public.scope_rank('branch') and public.department_branch(p_dept) = public.current_branch())
    or (p_scope >= public.scope_rank('department') and p_dept = public.current_department())
    or (p_scope >= public.scope_rank('team') and public.manages_person(p_person)),
    false);
$$;

create or replace function public.dept_in_scope(p_scope integer, p_dept text) returns boolean
language sql stable as $$
  select coalesce(
    p_scope >= public.scope_rank('all')
    or (p_scope >= public.scope_rank('branch') and public.department_branch(p_dept) = public.current_branch())
    or (p_scope >= public.scope_rank('department') and p_dept = public.current_department()),
    false);
$$;

-- For rows that belong to a branch directly (projects, lead sources).
create or replace function public.branch_in_scope(p_scope integer, p_branch text) returns boolean
language sql stable as $$
  select coalesce(
    p_scope >= public.scope_rank('all')
    or (p_scope >= public.scope_rank('branch') and p_branch = public.current_branch()),
    false);
$$;

create or replace function public.user_can_assign_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roles where key = p_role)
     and public.user_scope(p_user, 'staff.manage') >= public.scope_rank('all')
     and public.role_within_user(p_role, p_user);
$$;

-- Edge Functions (service role) ask "does this user hold X at scope Y?"
-- instead of comparing numbers themselves.
create or replace function public.user_has_permission(p_user uuid, p_permission text, p_min_scope text default 'own')
returns boolean
language sql stable security definer set search_path = public as $$
  select public.user_scope(p_user, p_permission) >= greatest(public.scope_rank(p_min_scope), 1);
$$;

revoke execute on function public.user_has_permission(uuid, text, text) from public, anon, authenticated;
grant execute on function public.user_has_permission(uuid, text, text) to service_role;

create or replace function public.enforce_profile_update_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.department_code is distinct from old.department_code
      or new.status is distinct from old.status) then
    if public.my_scope('staff.manage') < public.scope_rank('all') then
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


-- 5. Who may manage branches ------------------------------------------------------

alter table public.branches enable row level security;

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated using (true);

drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches for all
  to authenticated using (public.has_permission('system.configure')) with check (public.has_permission('system.configure'));


-- 6. Projects and lead sources are per branch ---------------------------------------
-- New rows default to the creator's branch; people who work across branches
-- (no branch of their own) must say which branch a row is for.

alter table public.enquiry_sources add column if not exists branch_code text references public.branches(code);
update public.enquiry_sources set branch_code = 'yangon' where branch_code is null;
alter table public.enquiry_sources alter column branch_code set default public.current_branch();
alter table public.enquiry_sources alter column branch_code set not null;
drop index if exists public.enquiry_sources_category_name_key;
create unique index if not exists enquiry_sources_branch_category_name_key
  on public.enquiry_sources (branch_code, category, lower(name));
drop index if exists public.enquiry_sources_category_order_idx;
create index if not exists enquiry_sources_branch_category_order_idx
  on public.enquiry_sources (branch_code, category, sort_order);

alter table public.projects add column if not exists branch_code text references public.branches(code);
update public.projects set branch_code = 'yangon' where branch_code is null;
alter table public.projects alter column branch_code set default public.current_branch();
alter table public.projects alter column branch_code set not null;
drop index if exists public.projects_category_name_key;
create unique index if not exists projects_branch_category_name_key
  on public.projects (branch_code, category, lower(name));
drop index if exists public.projects_category_order_idx;
create index if not exists projects_branch_category_order_idx
  on public.projects (branch_code, category, sort_order);

drop policy if exists enquiry_sources_insert on public.enquiry_sources;
create policy enquiry_sources_insert on public.enquiry_sources for insert
  to authenticated with check (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code));
drop policy if exists enquiry_sources_update on public.enquiry_sources;
create policy enquiry_sources_update on public.enquiry_sources for update
  to authenticated
  using (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code))
  with check (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code));
drop policy if exists enquiry_sources_delete on public.enquiry_sources;
create policy enquiry_sources_delete on public.enquiry_sources for delete
  to authenticated using (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert
  to authenticated with check (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  to authenticated
  using (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code))
  with check (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete
  to authenticated using (public.branch_in_scope((select public.my_scope('catalog.manage')), branch_code));

-- Mandalay starts with the same lead sources as Yangon (company channels
-- such as the Facebook pages are shared) and an empty project list — its
-- projects are its own. Only on the first run: later edits are kept.
insert into public.enquiry_sources (branch_code, category, name, sort_order, is_active, created_by)
select 'mandalay', s.category, s.name, s.sort_order, s.is_active, null
from public.enquiry_sources s
where s.branch_code = 'yangon'
  and not exists (select 1 from public.enquiry_sources m where m.branch_code = 'mandalay')
on conflict do nothing;


-- 7. Admin and Manager manage their own branch's lists ------------------------------
-- Same reach as before — there was only one branch — expressed for many.

update public.role_permissions set scope = 'branch'
  where permission_key = 'catalog.manage' and scope = 'all' and role_key in ('admin', 'manager');

update public.role_defaults set grants = jsonb_set(grants, '{catalog.manage}', '"branch"')
  where role_key in ('admin', 'manager') and grants ? 'catalog.manage';


-- 8. Realtime -------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'branches'
  ) then
    alter publication supabase_realtime add table public.branches;
  end if;
end $$;
