-- =============================================================================
-- Migration: Enquiries — pre-Lead triage stage
-- =============================================================================
-- Admin (or above) logs an incoming enquiry and assigns it directly to a
-- Manager or Sales Person, who works it end to end (accept, contact,
-- convert into a real Lead they own). No decline/reassign step — whoever
-- it's assigned to is who works it. Enquiry ids look like ENQ-2609230001
-- (YYMMDD + a 4-digit sequence that resets daily), generated atomically by
-- a counter table so concurrent inserts can never collide on a number.
--
-- New objects only — nothing existing is touched. Run once via
-- `supabase db query --linked --file database/migrations/2026-09-23_enquiries.sql`.
-- Idempotent (create-if-not-exists / drop-then-create-policy throughout).
--
-- Mirrors database/crm.sql (§1 enum types, §3b, §8 updated_at triggers,
-- §12 RLS, §13b realtime) — keep both in sync.
-- =============================================================================

do $$ begin
  create type enquiry_status as enum ('pending', 'accepted', 'completed');
exception when duplicate_object then null; end $$;

create table if not exists public.enquiry_counters (
  day_key   text primary key,
  last_seq  integer not null default 0
);

create table if not exists public.enquiries (
  id                 uuid primary key default gen_random_uuid(),
  enquiry_no         text not null unique,
  name               text not null,
  phone              text not null,
  budget             text,
  source             text,
  message            text,
  assigned_to        uuid not null references public.profiles(id),
  assigned_by        uuid references public.profiles(id),
  status             enquiry_status not null default 'pending',
  accepted_at        timestamptz,
  completed_at       timestamptz,
  converted_lead_id  uuid references public.leads(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_enquiries_assigned_to on public.enquiries(assigned_to);
create index if not exists idx_enquiries_status on public.enquiries(status);
create index if not exists idx_enquiries_created_at on public.enquiries(created_at desc);

-- No timezone conversion, matching the rest of this schema — the sequence
-- just resets whenever the server's own date rolls over.
create or replace function public.generate_enquiry_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_day_key text := to_char(now(), 'YYMMDD');
  v_seq int;
begin
  insert into public.enquiry_counters (day_key, last_seq)
  values (v_day_key, 1)
  on conflict (day_key) do update set last_seq = public.enquiry_counters.last_seq + 1
  returning last_seq into v_seq;

  new.enquiry_no := 'ENQ-' || v_day_key || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_enquiries_generate_no on public.enquiries;
create trigger trg_enquiries_generate_no before insert on public.enquiries
  for each row execute function public.generate_enquiry_no();

drop trigger if exists trg_enquiries_updated_at on public.enquiries;
create trigger trg_enquiries_updated_at before update on public.enquiries
  for each row execute function public.set_updated_at();

alter table public.enquiries enable row level security;
alter table public.enquiry_counters enable row level security;

-- No department_code column on this table — department scope is derived by
-- joining the assignee back to profiles, same pattern warnings_select /
-- warnings_insert use for issued_to.
drop policy if exists enquiries_select on public.enquiries;
create policy enquiries_select on public.enquiries for select
  to authenticated using (
    assigned_to = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and exists (
      select 1 from public.profiles p where p.id = enquiries.assigned_to and p.department_code = public.current_department()
    ))
  );

drop policy if exists enquiries_insert on public.enquiries;
create policy enquiries_insert on public.enquiries for insert
  to authenticated with check (
    public.is_admin_or_above()
    and assigned_by = auth.uid()
    and (
      public.is_exec()
      or exists (
        select 1 from public.profiles p where p.id = enquiries.assigned_to and p.department_code = public.current_department()
      )
    )
  );

-- Update covers both directions: the assignee moving their own row through
-- pending -> accepted -> completed, and Admin/exec correcting a still-
-- pending row (wrong assignee, typo). Once accepted it's part of the
-- assignee's own workflow, so a plain admin loses write access to it (exec
-- stays unrestricted, matching every other table's admin/exec split).
drop policy if exists enquiries_update on public.enquiries;
create policy enquiries_update on public.enquiries for update
  to authenticated using (
    assigned_to = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and status = 'pending' and exists (
      select 1 from public.profiles p where p.id = enquiries.assigned_to and p.department_code = public.current_department()
    ))
  )
  with check (
    assigned_to = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and exists (
      select 1 from public.profiles p where p.id = enquiries.assigned_to and p.department_code = public.current_department()
    ))
  );

drop policy if exists enquiries_delete on public.enquiries;
create policy enquiries_delete on public.enquiries for delete
  to authenticated using (
    public.is_exec()
    or (public.current_role() = 'admin' and status = 'pending' and exists (
      select 1 from public.profiles p where p.id = enquiries.assigned_to and p.department_code = public.current_department()
    ))
  );

-- enquiry_counters is internal bookkeeping for generate_enquiry_no()
-- (security definer, so it bypasses RLS here) — no client, at any role,
-- ever needs direct access to it. No policies means default-deny.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'enquiries'
  ) then
    execute 'alter publication supabase_realtime add table public.enquiries';
  end if;
end $$;

-- =============================================================================
-- End of database/migrations/2026-09-23_enquiries.sql
-- =============================================================================
