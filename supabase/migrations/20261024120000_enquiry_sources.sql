-- Enquiry sources become managed data instead of a list hard-coded in the
-- frontend (CONDO_SOURCES / HOUSE_LAND_SOURCES in src/types/index.ts, which
-- now only serve as the offline fallback).
--
-- One row per (category, source): a source offered under both Condo and
-- House & Land — e.g. "Boss Viber", "From Min Pyae" — is two rows, so each
-- category keeps its own order and can hide it independently.
--
-- enquiries.source stays free text, deliberately not a foreign key: renaming
-- or hiding a source here must never rewrite or orphan historical enquiries.
--
-- Managed by Manager and above (Settings → Enquiry sources); readable by
-- every signed-in user, since everyone who logs an enquiry picks from it.
--
-- Mirrors database/crm.sql §3c — keep both in sync. Idempotent.

-- 1. Table -------------------------------------------------------------------

create table if not exists public.enquiry_sources (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('condo', 'house_land')),
  name        text not null check (name = btrim(name) and length(name) between 1 and 80),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- "ACTY Facebook" and "acty facebook" are the same source.
create unique index if not exists enquiry_sources_category_name_key
  on public.enquiry_sources (category, lower(name));
create index if not exists enquiry_sources_category_order_idx
  on public.enquiry_sources (category, sort_order);

drop trigger if exists trg_enquiry_sources_updated_at on public.enquiry_sources;
create trigger trg_enquiry_sources_updated_at before update on public.enquiry_sources
  for each row execute function public.set_updated_at();

-- 2. RLS ---------------------------------------------------------------------

alter table public.enquiry_sources enable row level security;

drop policy if exists enquiry_sources_select on public.enquiry_sources;
create policy enquiry_sources_select on public.enquiry_sources for select
  to authenticated using (true);

drop policy if exists enquiry_sources_insert on public.enquiry_sources;
create policy enquiry_sources_insert on public.enquiry_sources for insert
  to authenticated with check (public.is_manager_or_above());

drop policy if exists enquiry_sources_update on public.enquiry_sources;
create policy enquiry_sources_update on public.enquiry_sources for update
  to authenticated using (public.is_manager_or_above()) with check (public.is_manager_or_above());

drop policy if exists enquiry_sources_delete on public.enquiry_sources;
create policy enquiry_sources_delete on public.enquiry_sources for delete
  to authenticated using (public.is_manager_or_above());

-- 3. Reorder in one atomic statement -----------------------------------------
-- Takes a category's ids in their new order. Security invoker, so the update
-- policy above still decides who may call it to any effect.

create or replace function public.reorder_enquiry_sources(p_category text, p_ids uuid[])
returns void
language sql security invoker set search_path = public as $$
  update public.enquiry_sources s
  set sort_order = x.ord * 10
  from unnest(p_ids) with ordinality as x(id, ord)
  where s.id = x.id and s.category = p_category;
$$;

grant execute on function public.reorder_enquiry_sources(text, uuid[]) to authenticated;

-- 4. Audit trail -------------------------------------------------------------
-- Logged in the database so every write path is covered, not just the UI.
-- Reorders only touch sort_order and aren't worth a row each.

create or replace function public.audit_enquiry_sources() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.name = old.name and new.category = old.category and new.is_active = old.is_active then
    return new;
  end if;

  insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
  values (
    'enquiry_source_' || lower(tg_op),
    'enquiry_sources',
    coalesce(new.id, old.id),
    auth.uid(),
    case when tg_op <> 'INSERT' then jsonb_build_object('name', old.name, 'category', old.category, 'is_active', old.is_active) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('name', new.name, 'category', new.category, 'is_active', new.is_active) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enquiry_sources_audit on public.enquiry_sources;
create trigger trg_enquiry_sources_audit after insert or update or delete on public.enquiry_sources
  for each row execute function public.audit_enquiry_sources();

-- 5. Realtime: open pickers update as soon as a source is added or hidden ----

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'enquiry_sources'
  ) then
    execute 'alter publication supabase_realtime add table public.enquiry_sources';
  end if;
end $$;

-- 6. Seed: today's lists, in their current order, plus the new sources -------
-- created_by is null for seeded rows (no auth.uid() in a migration), and the
-- audit trigger is paused so seeding doesn't log dozens of anonymous rows.

alter table public.enquiry_sources disable trigger trg_enquiry_sources_audit;

insert into public.enquiry_sources (category, name, sort_order, created_by)
select 'condo', name, ord * 10, null
from unnest(array[
  'Condo Channel Facebook',
  'Condo Listing Facebook',
  'PSM Properties Original Facebook',
  'PSM Properties New Facebook',
  'DLM Facebook',
  'BHG Facebook',
  'Property Seeker Facebook',
  'ACTY Facebook',
  'Condo Channel Tiktok',
  'PSM Properties Original Tiktok',
  'Property Seeker Tiktok',
  'ACTY TikTok',
  'Boss Phone',
  'Boss Viber',
  'DLM WalkIn',
  'BHG WalkIn',
  'DLM Hotline',
  'BHG Hotline',
  'House Hotline',
  'Condo Hotline',
  'PTZ Hotline',
  'ACTY Hotline',
  'Production Department',
  'Marketing Department',
  'AI Department',
  'Open Verse',
  'Own Enquiry',
  'From Latt Latt Aung',
  'From Min Pyae'
]) with ordinality as s(name, ord)
on conflict do nothing;

insert into public.enquiry_sources (category, name, sort_order, created_by)
select 'house_land', name, ord * 10, null
from unnest(array[
  'House&Land Listing',
  'House Channel',
  'PSM Property (BL)',
  'PSM Property',
  'Property Seeker',
  'House Channel Tiktok',
  'PSM Property Tiktok',
  'IMyanmarHouse',
  'Office Ph Call',
  'Boss Ph Call',
  'Boss Viber',
  'Production Department',
  'Marketing Department',
  'AI Department',
  'Open Verse',
  'Own Enquiry',
  'From Latt Latt Aung',
  'From Min Pyae'
]) with ordinality as s(name, ord)
on conflict do nothing;

alter table public.enquiry_sources enable trigger trg_enquiry_sources_audit;
