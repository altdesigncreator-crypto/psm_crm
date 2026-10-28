-- One source list for enquiries and leads.
--
-- Until now leads had their own fixed list (Facebook, Admin Content, …) while
-- enquiries used public.enquiry_sources, so a lead converted from a
-- "PSM Properties New Facebook" enquiry was usually re-labelled "Facebook" by
-- hand — 471 of 496 converted leads disagreed with their own enquiry.
--
-- From here on:
--   • Both pickers read public.enquiry_sources (Settings → Lead sources).
--   • A lead converted from an enquiry takes its source FROM that enquiry and
--     stays in sync with it: the enquiry is the single source of truth, and
--     editing the enquiry's source updates the lead. leads.source_enquiry_id
--     records the link (server-owned) so the UI can show the field as locked.
--   • Leads added directly pick from the same list; older values on leads
--     added before this change are kept as they are and stay filterable.
--
-- Enforced in the database so every write path — Add Lead, Lead Detail,
-- Pipeline Board, imports, future code — is held to the same rule.
--
-- Mirrors database/crm.sql §20 — keep both in sync. Idempotent.

-- 1. The link ------------------------------------------------------------------

alter table public.leads
  add column if not exists source_enquiry_id uuid references public.enquiries(id) on delete set null;

create index if not exists idx_leads_source_enquiry on public.leads(source_enquiry_id) where source_enquiry_id is not null;

-- 2. Lead guard: a linked lead's source is its enquiry's ---------------------
-- source_enquiry_id is server-owned: only sync_lead_source_from_enquiry()
-- (which raises the app.syncing_lead_source flag) may set or change it, so a
-- client can neither forge a link nor break one.

create or replace function public.guard_lead_source() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_source text;
begin
  if coalesce(current_setting('app.syncing_lead_source', true), '') <> 'on' then
    new.source_enquiry_id := case when tg_op = 'UPDATE' then old.source_enquiry_id end;
  end if;

  if new.source_enquiry_id is not null then
    select source into v_source from public.enquiries where id = new.source_enquiry_id;
    -- An enquiry saved without a source doesn't erase what the lead has.
    if v_source is not null then
      new.lead_source := v_source;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_guard_source on public.leads;
create trigger trg_leads_guard_source before insert or update of lead_source, source_enquiry_id on public.leads
  for each row execute function public.guard_lead_source();

-- 3. Enquiry → lead sync -------------------------------------------------------
-- Fires when an enquiry is converted (converted_lead_id set) and whenever its
-- source is edited afterwards. If a second enquiry is ever converted into
-- the same lead, the most recent conversion wins.

create or replace function public.sync_lead_source_from_enquiry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.syncing_lead_source', 'on', true);

  if tg_op = 'UPDATE' and old.converted_lead_id is not null
     and old.converted_lead_id is distinct from new.converted_lead_id then
    update public.leads set source_enquiry_id = null
    where id = old.converted_lead_id and source_enquiry_id = new.id;
  end if;

  if new.converted_lead_id is not null then
    update public.leads
    set source_enquiry_id = new.id, lead_source = coalesce(new.source, lead_source)
    where id = new.converted_lead_id
      and (source_enquiry_id is distinct from new.id or lead_source is distinct from coalesce(new.source, lead_source));
  end if;

  perform set_config('app.syncing_lead_source', 'off', true);
  return new;
end;
$$;

drop trigger if exists trg_enquiries_sync_lead_source on public.enquiries;
create trigger trg_enquiries_sync_lead_source after insert or update of source, converted_lead_id on public.enquiries
  for each row execute function public.sync_lead_source_from_enquiry();

-- 4. Source counts for the Leads filter ---------------------------------------
-- Security invoker: counts only the leads the caller can see.

create or replace function public.lead_source_counts()
returns table (source text, leads bigint)
language sql stable security invoker set search_path = public as $$
  select lead_source, count(*) from public.leads group by lead_source;
$$;

grant execute on function public.lead_source_counts() to authenticated;

-- 5. One-time backfill ---------------------------------------------------------
-- Link every converted lead to its (earliest) enquiry and take that
-- enquiry's source. Each overwritten value is kept in audit_logs first, so
-- the change is fully reviewable and reversible. updated_at is left alone:
-- this is a data correction, not an edit, and Sold attribution falls back
-- to updated_at for older sales. One block, so the sync flag and the paused
-- trigger can't leak past it however the file is executed.

do $backfill$
begin
  alter table public.leads disable trigger trg_leads_updated_at;

  create temp table _first_enquiry on commit drop as
  select distinct on (converted_lead_id) id, converted_lead_id, source, enquiry_no
  from public.enquiries
  where converted_lead_id is not null
  order by converted_lead_id, created_at, id;

  insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value, notes)
  select 'lead_source_synced', 'leads', l.id, null,
         jsonb_build_object('lead_source', l.lead_source),
         jsonb_build_object('lead_source', e.source, 'enquiry_no', e.enquiry_no),
         'One-time alignment of lead source with its enquiry (20261024130000_unified_lead_sources)'
  from public.leads l
  join _first_enquiry e on e.converted_lead_id = l.id
  where e.source is not null and l.lead_source is distinct from e.source
    and l.source_enquiry_id is null;

  -- Setting the link fires guard_lead_source(), which copies the source.
  perform set_config('app.syncing_lead_source', 'on', true);
  update public.leads l
  set source_enquiry_id = e.id
  from _first_enquiry e
  where e.converted_lead_id = l.id and l.source_enquiry_id is null;
  perform set_config('app.syncing_lead_source', 'off', true);

  drop table _first_enquiry;
  alter table public.leads enable trigger trg_leads_updated_at;
end
$backfill$;
