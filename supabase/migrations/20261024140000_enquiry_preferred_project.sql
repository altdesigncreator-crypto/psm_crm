-- Preferred project on enquiries, picked from a managed list.
--
--   enquiries.preferred_project  the project the enquiry is about. Free text,
--                                like leads.preferred_project and
--                                enquiries.source — renaming or hiding a list
--                                entry never rewrites saved enquiries.
--   public.projects              the list offered in the New/Edit Enquiry
--                                form, per category (Condo / House & Land),
--                                managed in Settings → Projects by Manager
--                                and above. Same shape and rules as
--                                public.enquiry_sources.
--
-- Converting an enquiry pre-fills the lead's preferred project from it, and
-- Project Insights attributes an enquiry to the project picked here before
-- falling back to guessing from the message text.
--
-- Mirrors database/crm.sql §21 — keep both in sync. Idempotent.

-- 1. The enquiry field ----------------------------------------------------------

alter table public.enquiries
  add column if not exists preferred_project text;

alter table public.enquiries drop constraint if exists enquiries_preferred_project_check;
alter table public.enquiries
  add constraint enquiries_preferred_project_check
  check (preferred_project is null or (preferred_project = btrim(preferred_project) and length(preferred_project) between 1 and 120));

-- 2. The list -----------------------------------------------------------------

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('condo', 'house_land')),
  name        text not null check (name = btrim(name) and length(name) between 1 and 120),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists projects_category_name_key on public.projects (category, lower(name));
create index if not exists projects_category_order_idx on public.projects (category, sort_order);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- 3. RLS: everyone reads, Manager and above write -----------------------------

alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  to authenticated using (true);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert
  to authenticated with check (public.is_manager_or_above());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  to authenticated using (public.is_manager_or_above()) with check (public.is_manager_or_above());

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete
  to authenticated using (public.is_manager_or_above());

-- 4. Reorder in one atomic statement (security invoker: RLS decides) ----------

create or replace function public.reorder_projects(p_category text, p_ids uuid[])
returns void
language sql security invoker set search_path = public as $$
  update public.projects p
  set sort_order = x.ord * 10
  from unnest(p_ids) with ordinality as x(id, ord)
  where p.id = x.id and p.category = p_category;
$$;

grant execute on function public.reorder_projects(text, uuid[]) to authenticated;

-- 5. Audit trail — same rules as enquiry_sources: every add, rename, hide/show
-- and delete, with who did it; reorders aren't logged.

create or replace function public.audit_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.name = old.name and new.category = old.category and new.is_active = old.is_active then
    return new;
  end if;

  insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
  values (
    'project_' || lower(tg_op),
    'projects',
    coalesce(new.id, old.id),
    auth.uid(),
    case when tg_op <> 'INSERT' then jsonb_build_object('name', old.name, 'category', old.category, 'is_active', old.is_active) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('name', new.name, 'category', new.category, 'is_active', new.is_active) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_projects_audit on public.projects;
create trigger trg_projects_audit after insert or update or delete on public.projects
  for each row execute function public.audit_projects();

-- 6. Realtime ------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    execute 'alter publication supabase_realtime add table public.projects';
  end if;
end $$;

-- 7. Seed: the projects leads actually ask for (5+ leads each), filed under
-- the department most of their leads belong to, busiest first. Plot sizes,
-- open-house events and street addresses are left out — they aren't projects.

alter table public.projects disable trigger trg_projects_audit;

insert into public.projects (category, name, sort_order, created_by)
select 'condo', name, ord * 10, null
from unnest(array[
  'Dagon Landmark Residence',
  'Perfect Signature Residence',
  'Ba Htoo Gyi Condo',
  'The Century Condo',
  'Aung Zay Ya City',
  'Aye Chan Thar Yar Condo',
  'Lilie''s Apartment',
  'Einzali Residence',
  'Emerald Bay',
  'Aung Chanthar Condo',
  'MTP Condo',
  '65K Residence',
  'GRC Condo',
  'Royal Theikdi Condo',
  'Pinlon Village Residence',
  'My Condo Residence',
  'ERC Condo',
  'KER Condo',
  'Topaz Condo (Bahan)',
  'Residence 18',
  'Mahar Swe Condo',
  'Yankin Condo'
]) with ordinality as s(name, ord)
on conflict do nothing;

insert into public.projects (category, name, sort_order, created_by)
select 'house_land', name, ord * 10, null
from unnest(array[
  'North Dagon',
  'Orchard',
  'Shwe Padauk Avenue',
  'South Dagon',
  'Mayangone',
  'Hlaing Tharyar'
]) with ordinality as s(name, ord)
on conflict do nothing;

alter table public.projects enable trigger trg_projects_audit;
