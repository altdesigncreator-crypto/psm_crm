-- =============================================================================
-- Migration: Site-wide maintenance mode
-- =============================================================================
-- Adds a full-screen, blocking "Under Maintenance" gate — distinct from the
-- existing dismissible system_messages banner (which only shows a notice bar
-- alongside the working app). When enabled, every visitor (including on the
-- login screen, and including anyone with the app already open, via
-- Realtime) sees a takeover page with an editable title/message and an
-- optional uploaded image, until an admin turns it back off. The one
-- exception is /system-banner-admin itself — that route must always stay
-- reachable, or nobody could ever turn maintenance mode back off.
--
-- Reuses the exact same architecture as the existing banner system (see
-- section 16 below in database/crm.sql): a singleton settings row, readable
-- by anyone via RLS, but writable ONLY through the banner-messages edge
-- function (service role) using the same X-Banner-Token session — not tied
-- to Supabase Auth or any CRM staff account, so it still works even if the
-- rest of the app is fully blocked.
--
-- Additive/policy-only change — no existing schema/data touched. Run once
-- in the Supabase SQL editor. Idempotent.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- =============================================================================

create table if not exists public.maintenance_settings (
  id          int primary key default 1,
  is_enabled  boolean not null default false,
  title       text not null default 'System Under Maintenance',
  message     text not null default 'We''ll be back shortly. Thank you for your patience.',
  image_url   text,
  updated_at  timestamptz not null default now(),
  constraint maintenance_settings_singleton check (id = 1)
);

insert into public.maintenance_settings (id) values (1) on conflict (id) do nothing;

alter table public.maintenance_settings enable row level security;

-- Readable by literally anyone, signed in or not — the gate has to be able
-- to decide whether to block the page before any login has happened.
drop policy if exists maintenance_settings_select on public.maintenance_settings;
create policy maintenance_settings_select on public.maintenance_settings for select
  to anon, authenticated using (true);

-- No insert/update/delete policy at all — every write goes through the
-- banner-messages edge function (service role), same as system_messages.

-- Public bucket for the uploaded maintenance-page image — only the
-- service-role edge function ever writes to it (no storage RLS policy is
-- needed or added), but anyone can view the resulting public URL.
insert into storage.buckets (id, name, public)
values ('maintenance', 'maintenance', true)
on conflict (id) do update set public = true;

-- Realtime so an already-open tab flips to the maintenance page (or back)
-- the instant an admin toggles it, without needing a refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'maintenance_settings'
  ) then
    execute 'alter publication supabase_realtime add table public.maintenance_settings';
  end if;
end $$;

-- =============================================================================
-- End of database/migrations/2026-07-26_maintenance_mode.sql
-- =============================================================================
