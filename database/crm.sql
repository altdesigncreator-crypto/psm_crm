-- =============================================================================
-- PSM Real Estate Sales CRM — Postgres schema for Supabase
-- =============================================================================
-- Org model: department-scoped (house / condo / project), five role tiers
-- (boss, super_admin, admin, manager, sale). See src/lib/permissions.ts for the
-- client-side mirror of this model.
--
-- Run this whole file once against a fresh Supabase project's SQL editor
-- (or `supabase db push` if you wire it into supabase/migrations). It is
-- idempotent-ish (uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS)
-- so it can be re-run during development.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================

do $$ begin
  create type role_tier as enum ('boss', 'super_admin', 'admin', 'manager', 'sale');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

-- Consolidated lead stage. The FRD describes two near-identical vocabularies
-- (section 6 "Lead Lifecycle" vs section 9 "Pipeline Module"); they are
-- merged here into one field so the Kanban board, dashboard counts, and
-- funnel analytics all read from a single source of truth.
do $$ begin
  create type lead_stage as enum (
    'new', 'contacted', 'qualified', 'appointment',
    'site_visit', 'negotiation', 'booking', 'sold', 'lost'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_grade as enum ('A', 'B', 'C');
exception when duplicate_object then null; end $$;

do $$ begin
  create type followup_type as enum (
    'phone', 'messenger', 'whatsapp', 'viber', 'email', 'meeting', 'site_visit'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type followup_status as enum (
    'interested', 'not_interested', 'busy', 'no_answer',
    'call_later', 'site_visit', 'booking', 'lost'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type checkin_status as enum ('on_time', 'late', 'absent', 'leave', 'field_work');
exception when duplicate_object then null; end $$;

do $$ begin
  create type warning_reason as enum (
    'followup_overdue', 'customer_complaint', 'no_activity',
    'late_checkin', 'pipeline_stalled', 'missed_appointment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'new_lead_assigned', 'followup_reminder', 'appointment_reminder',
    'site_visit_reminder', 'booking_confirmation', 'warning_notification',
    'checkin_reminder'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type appt_status as enum ('scheduled', 'completed', 'missed', 'cancelled');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- 2. CORE TABLES
-- =============================================================================

create table if not exists public.departments (
  code        text primary key,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.attendance_settings (
  department_code  text primary key references public.departments(code) on delete cascade,
  window_start     time not null default '07:00',
  window_end       time not null default '10:00',
  require_gps      boolean not null default true,
  require_photo    boolean not null default false,
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);

create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null unique,
  name             text not null,
  phone            text,
  role             role_tier not null default 'sale',
  department_code  text references public.departments(code),
  status           user_status not null default 'active',
  avatar_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_department_required_for_scoped_roles check (
    role in ('boss', 'super_admin') or department_code is not null
  )
);

-- Departments are managed dynamically from the app (Settings → System
-- Configuration, Boss/Super Admin only — see departments_write RLS policy
-- below), not a fixed code list. Auto-provision a default attendance window
-- whenever a new one is created so check-in still works immediately.
create or replace function public.provision_department_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.attendance_settings (department_code)
  values (new.code)
  on conflict (department_code) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_departments_provision on public.departments;
create trigger trg_departments_provision after insert on public.departments
  for each row execute function public.provision_department_defaults();

-- Backfill FKs that reference profiles (declared above the table in a couple
-- of spots for readability further down) once profiles exists.
alter table public.attendance_settings
  drop constraint if exists attendance_settings_updated_by_fkey,
  add constraint attendance_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles(id);

-- =============================================================================
-- 2b. TEAMS — the layer between Department and individual staff. A
-- department has many teams; each team has one Manager and any number of
-- Sales People. A Manager can run more than one team, and a Sales Person
-- can belong to more than one team (both deliberately many-to-many), which
-- is why membership is a join table rather than a column on profiles.
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

create table if not exists public.team_members (
  team_id          uuid not null references public.teams(id) on delete cascade,
  sale_person_id   uuid not null references public.profiles(id) on delete cascade,
  added_at         timestamptz not null default now(),
  primary key (team_id, sale_person_id)
);

create index if not exists idx_team_members_person on public.team_members(sale_person_id);

-- Keep team structure inside one department: a team's manager, and every
-- member of that team, must belong to the same department as the team.
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
-- 3. LEADS + ASSIGNMENT HISTORY
-- =============================================================================

create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  phone              text not null,
  email              text,
  current_location   text,
  interest_type      text,
  property_type      text,
  preferred_project  text,
  budget_range       text,
  purpose            text,
  lead_source        text,
  department_code    text not null references public.departments(code),
  team_id            uuid references public.teams(id),
  status             lead_stage not null default 'new',
  lead_grade         lead_grade,
  lead_grade_reason  text,
  owner_id           uuid references public.profiles(id),
  created_by         uuid references public.profiles(id),
  sale_amount        numeric(14, 2),
  latitude           double precision,
  longitude          double precision,
  next_follow_up_at  timestamptz,
  remarks            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_leads_department on public.leads(department_code);
create index if not exists idx_leads_owner on public.leads(owner_id);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_next_followup on public.leads(next_follow_up_at);
-- preferred_project is entered as free text in the Add Lead form (no fixed
-- project list) — index it so the Leads page's project filter/search stays
-- fast as values become more varied.
create index if not exists idx_leads_preferred_project on public.leads(preferred_project);
create index if not exists idx_leads_team on public.leads(team_id);

-- A lead's team (if any — team_id is nullable, chosen at creation time when
-- the owner belongs to more than one team) must belong to the same
-- department as the lead itself.
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

-- Timeline & Payment step was removed from the Add Lead form — drop the
-- now-unused columns. Safe to re-run: IF EXISTS makes it a no-op on fresh
-- installs where the CREATE TABLE above never created them.
alter table public.leads drop column if exists urgency;
alter table public.leads drop column if exists urgency_remarks;
alter table public.leads drop column if exists payment_method;

-- History of who has owned a lead. A lead always has exactly one *current*
-- owner (leads.owner_id); this table is the audit trail behind it and is
-- what lets RLS answer "did this manager assign this lead away already?".
create table if not exists public.lead_assignments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  assigned_to  uuid not null references public.profiles(id),
  assigned_by  uuid references public.profiles(id),
  note         text,
  assigned_at  timestamptz not null default now()
);

create index if not exists idx_lead_assignments_lead on public.lead_assignments(lead_id);

-- =============================================================================
-- 4. FOLLOW-UPS, PIPELINE HISTORY, APPOINTMENTS, SITE VISITS, WARNINGS
-- =============================================================================

create table if not exists public.follow_ups (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads(id) on delete cascade,
  created_by         uuid references public.profiles(id),
  type               followup_type not null,
  status             followup_status not null,
  notes              text,
  next_follow_up_at  timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists idx_followups_lead on public.follow_ups(lead_id);

create table if not exists public.pipeline_history (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  from_stage   lead_stage,
  to_stage     lead_stage not null,
  changed_by   uuid references public.profiles(id),
  changed_at   timestamptz not null default now()
);

create index if not exists idx_pipeline_history_lead on public.pipeline_history(lead_id);

create table if not exists public.appointments (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  scheduled_by   uuid references public.profiles(id),
  scheduled_at   timestamptz not null,
  location       text,
  notes          text,
  status         appt_status not null default 'scheduled',
  created_at     timestamptz not null default now()
);

create index if not exists idx_appointments_lead on public.appointments(lead_id);

create table if not exists public.site_visits (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  scheduled_by   uuid references public.profiles(id),
  scheduled_at   timestamptz not null,
  location       text,
  notes          text,
  status         appt_status not null default 'scheduled',
  created_at     timestamptz not null default now()
);

create index if not exists idx_site_visits_lead on public.site_visits(lead_id);

create table if not exists public.warnings (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references public.leads(id) on delete set null,
  issued_to    uuid not null references public.profiles(id),
  issued_by    uuid not null references public.profiles(id),
  reason       warning_reason not null,
  message      text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_warnings_issued_to on public.warnings(issued_to);

-- =============================================================================
-- 5. ATTENDANCE
-- =============================================================================

create table if not exists public.check_ins (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.profiles(id),
  department_code  text not null references public.departments(code),
  check_in_date    date not null default current_date,
  check_in_time    timestamptz not null default now(),
  latitude         double precision,
  longitude        double precision,
  photo_url        text,
  status           checkin_status not null default 'on_time',
  is_late          boolean not null default false,
  notes            text,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (employee_id, check_in_date)
);

create index if not exists idx_checkins_department on public.check_ins(department_code);
create index if not exists idx_checkins_date on public.check_ins(check_in_date);

-- =============================================================================
-- 6. NOTIFICATIONS, AUDIT LOGS, SETTINGS
-- =============================================================================

create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  recipient_id     uuid not null references public.profiles(id),
  type             notification_type not null,
  title            text not null,
  body             text,
  related_lead_id  uuid references public.leads(id) on delete cascade,
  is_read          boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on public.notifications(recipient_id, is_read);

-- Kept per FRD business rule 6 ("all critical actions must be recorded")
-- even though the dedicated Audit Log page is out of scope for this pass —
-- a Boss/Super-Admin-only viewer can be added later without schema changes.
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  action        text not null,
  target_table  text,
  target_id     uuid,
  performed_by  uuid references public.profiles(id),
  old_value     jsonb,
  new_value     jsonb,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);

create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

-- =============================================================================
-- 7. HELPER FUNCTIONS (used by RLS policies)
-- =============================================================================

create or replace function public.current_role() returns role_tier
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_department() returns text
language sql stable security definer set search_path = public as $$
  select department_code from public.profiles where id = auth.uid();
$$;

create or replace function public.is_exec() returns boolean
language sql stable as $$
  select public.current_role() in ('boss', 'super_admin');
$$;

create or replace function public.is_admin_or_above() returns boolean
language sql stable as $$
  select public.current_role() in ('boss', 'super_admin', 'admin');
$$;

create or replace function public.is_manager_or_above() returns boolean
language sql stable as $$
  select public.current_role() in ('boss', 'super_admin', 'admin', 'manager');
$$;

create or replace function public.owns_lead(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads where id = p_lead_id and owner_id = auth.uid()
  );
$$;

-- Admin is department-scoped (like Manager, with more power inside the
-- department); only Boss/Super Admin see across departments. This helper
-- checks a lead against the caller's own department.
create or replace function public.lead_in_my_department(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads
    where id = p_lead_id and department_code = public.current_department()
  );
$$;

-- Team-scoped equivalents of the helpers above — Manager's RLS uses these
-- instead of department-wide checks; Admin/exec are unaffected by teams.
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

-- Inverse of manages_person() — lets a Sales Person read the profile of a
-- manager who runs one of their teams, so their own Profile page can show
-- "Manager: <name>". Narrow and one-directional: does not grant Sale
-- visibility into any other profile.
create or replace function public.is_my_team_manager(p_manager_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.sale_person_id = auth.uid() and t.manager_id = p_manager_id
  );
$$;

-- Legacy fallback baked in: a lead with no team_id yet is still visible to
-- whichever manager covers its whole department, exactly like before teams
-- existed.
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
-- 8. TRIGGERS — updated_at bookkeeping
-- =============================================================================

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 9. TRIGGERS — lead assignment history + pipeline history (auto-logged,
--    so the history is correct regardless of which UI path changed the row)
-- =============================================================================

create or replace function public.log_lead_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.owner_id is not null)
     or (tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and new.owner_id is not null) then
    insert into public.lead_assignments (lead_id, assigned_to, assigned_by, note)
    values (new.id, new.owner_id, auth.uid(), case when tg_op = 'INSERT' then 'Initial assignment' else 'Reassigned' end);

    insert into public.notifications (recipient_id, type, title, body, related_lead_id)
    values (new.owner_id, 'new_lead_assigned', 'New lead assigned', new.name || ' has been assigned to you.', new.id);

    insert into public.audit_logs (action, target_table, target_id, performed_by, new_value)
    values (case when tg_op = 'INSERT' then 'lead_created' else 'lead_reassigned' end,
            'leads', new.id, auth.uid(), jsonb_build_object('owner_id', new.owner_id));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_assignment on public.leads;
create trigger trg_leads_assignment after insert or update of owner_id on public.leads
  for each row execute function public.log_lead_assignment();

-- Sold is a terminal pipeline stage — once a lead is marked Sold, its stage
-- can never change again (by anyone, including Boss/Super Admin). This is a
-- hard DB-level lock, not just a UI restriction, so it can't be bypassed by
-- calling the API directly.
create or replace function public.prevent_sold_status_change() returns trigger
language plpgsql as $$
begin
  if old.status = 'sold' and new.status is distinct from old.status then
    raise exception 'This lead is marked Sold and its stage can no longer be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_lock_sold on public.leads;
create trigger trg_leads_lock_sold before update of status on public.leads
  for each row execute function public.prevent_sold_status_change();

create or replace function public.log_pipeline_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.pipeline_history (lead_id, from_stage, to_stage, changed_by)
    values (new.id, old.status, new.status, auth.uid());

    insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
    values ('pipeline_stage_changed', 'leads', new.id, auth.uid(),
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_pipeline on public.leads;
create trigger trg_leads_pipeline after update of status on public.leads
  for each row execute function public.log_pipeline_change();

-- Pipeline stage and lead grade are linked exactly like follow-up status and
-- lead grade (see 9b below) — moving a card on the Pipeline Board also
-- recomputes the grade. Mirrors PIPELINE_STAGE_TO_GRADE in src/types/index.ts.
create or replace function public.pipeline_stage_to_grade(p_stage lead_stage) returns lead_grade
language sql immutable as $$
  select case p_stage
    when 'new' then 'C'
    when 'contacted' then 'C'
    when 'qualified' then 'B'
    when 'appointment' then 'B'
    when 'site_visit' then 'A'
    when 'negotiation' then 'A'
    when 'booking' then 'A'
    when 'sold' then 'A'
    when 'lost' then 'C'
  end::lead_grade;
$$;

create or replace function public.sync_grade_from_pipeline() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new_grade lead_grade;
begin
  v_new_grade := public.pipeline_stage_to_grade(new.status);
  if new.lead_grade is distinct from v_new_grade then
    update public.leads
      set lead_grade = v_new_grade,
          lead_grade_reason = 'Auto-set from pipeline stage: ' || replace(initcap(new.status::text), '_', ' ')
      where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_pipeline_grade on public.leads;
create trigger trg_leads_pipeline_grade after update of status on public.leads
  for each row execute function public.sync_grade_from_pipeline();

create or replace function public.log_followup_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (action, target_table, target_id, performed_by, new_value)
  values ('followup_added', 'follow_ups', new.id, auth.uid(),
          jsonb_build_object('lead_id', new.lead_id, 'type', new.type, 'status', new.status));
  return new;
end;
$$;

drop trigger if exists trg_followups_audit on public.follow_ups;
create trigger trg_followups_audit after insert on public.follow_ups
  for each row execute function public.log_followup_added();

-- =============================================================================
-- 9b. FOLLOW-UP STATUS <-> LEAD GRADE — the two are one signal, not two.
-- Every time a follow-up is recorded (or an existing one's outcome is
-- corrected), the lead's grade is recomputed from that outcome — mirrors
-- FOLLOWUP_STATUS_TO_GRADE in src/types/index.ts. Any resulting grade change
-- is itself audit-logged by trg_leads_grade_audit below, so there is always
-- a record of what changed and when, regardless of which page triggered it.
-- =============================================================================

create or replace function public.followup_status_to_grade(p_status followup_status) returns lead_grade
language sql immutable as $$
  select case p_status
    when 'booking' then 'A'
    when 'site_visit' then 'A'
    when 'interested' then 'B'
    when 'call_later' then 'B'
    when 'busy' then 'C'
    when 'no_answer' then 'C'
    when 'not_interested' then 'C'
    when 'lost' then 'C'
  end::lead_grade;
$$;

create or replace function public.followup_status_label(p_status followup_status) returns text
language sql immutable as $$
  select case p_status
    when 'booking' then 'Booking'
    when 'site_visit' then 'Site Visit'
    when 'interested' then 'Interested'
    when 'call_later' then 'Call Later'
    when 'busy' then 'Busy'
    when 'no_answer' then 'No Answer'
    when 'not_interested' then 'Not Interested'
    when 'lost' then 'Lost'
  end;
$$;

create or replace function public.sync_grade_from_followup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new_grade lead_grade;
begin
  v_new_grade := public.followup_status_to_grade(new.status);
  update public.leads
    set lead_grade = v_new_grade,
        lead_grade_reason = 'Auto-set from follow-up outcome: ' || public.followup_status_label(new.status)
    where id = new.lead_id
      and lead_grade is distinct from v_new_grade;
  return new;
end;
$$;

drop trigger if exists trg_followups_sync_grade on public.follow_ups;
create trigger trg_followups_sync_grade after insert or update of status on public.follow_ups
  for each row execute function public.sync_grade_from_followup();

create or replace function public.log_grade_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_grade is distinct from old.lead_grade then
    insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
    values ('lead_grade_changed', 'leads', new.id, auth.uid(),
            jsonb_build_object('lead_grade', old.lead_grade, 'reason', old.lead_grade_reason),
            jsonb_build_object('lead_grade', new.lead_grade, 'reason', new.lead_grade_reason));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_grade_audit on public.leads;
create trigger trg_leads_grade_audit after update of lead_grade on public.leads
  for each row execute function public.log_grade_change();

create or replace function public.log_warning_issued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, type, title, body, related_lead_id)
  values (new.issued_to, 'warning_notification', 'Warning issued', coalesce(new.message, new.reason::text), new.lead_id);

  insert into public.audit_logs (action, target_table, target_id, performed_by, new_value)
  values ('warning_issued', 'warnings', new.id, auth.uid(),
          jsonb_build_object('issued_to', new.issued_to, 'reason', new.reason));
  return new;
end;
$$;

drop trigger if exists trg_warnings_audit on public.warnings;
create trigger trg_warnings_audit after insert on public.warnings
  for each row execute function public.log_warning_issued();

-- =============================================================================
-- 10. TRIGGERS — check-in status computation (time window + late flag)
-- =============================================================================

create or replace function public.compute_checkin_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_window_end time;
  v_local_time time;
begin
  select window_end into v_window_end
  from public.attendance_settings where department_code = new.department_code;

  v_local_time := new.check_in_time::time;

  if new.status in ('absent', 'leave', 'field_work') then
    new.is_late := false;
  elsif v_window_end is not null and v_local_time > v_window_end then
    new.status := 'late';
    new.is_late := true;
  else
    new.status := coalesce(new.status, 'on_time');
    new.is_late := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_checkins_status on public.check_ins;
create trigger trg_checkins_status before insert on public.check_ins
  for each row execute function public.compute_checkin_status();

create or replace function public.log_checkin_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (action, target_table, target_id, performed_by, new_value)
  values ('checkin_completed', 'check_ins', new.id, auth.uid(),
          jsonb_build_object('employee_id', new.employee_id, 'status', new.status));
  return new;
end;
$$;

drop trigger if exists trg_checkins_audit on public.check_ins;
create trigger trg_checkins_audit after insert on public.check_ins
  for each row execute function public.log_checkin_audit();

-- =============================================================================
-- 11. TRIGGER — prevent role/department/status escalation on profiles
-- =============================================================================

create or replace function public.enforce_profile_update_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.department_code is distinct from old.department_code
      or new.status is distinct from old.status) then
    -- Only Boss/Super Admin may change role, department, or active status
    -- (FRD rule: Admin cannot manage managers/salespeople/roles).
    if not public.is_exec() then
      raise exception 'Only Boss/Super Admin can change role, department, or status';
    end if;
  end if;

  insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
  values ('user_updated', 'profiles', new.id, auth.uid(),
          jsonb_build_object('role', old.role, 'department_code', old.department_code, 'status', old.status),
          jsonb_build_object('role', new.role, 'department_code', new.department_code, 'status', new.status));

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.enforce_profile_update_rules();

-- =============================================================================
-- 12. ROW LEVEL SECURITY
-- =============================================================================

alter table public.departments enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.follow_ups enable row level security;
alter table public.pipeline_history enable row level security;
alter table public.appointments enable row level security;
alter table public.site_visits enable row level security;
alter table public.warnings enable row level security;
alter table public.check_ins enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.settings enable row level security;

-- ---- departments ----
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select
  to authenticated using (true);

drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all
  to authenticated using (public.is_exec()) with check (public.is_exec());

-- ---- attendance_settings ----
drop policy if exists attendance_settings_select on public.attendance_settings;
create policy attendance_settings_select on public.attendance_settings for select
  to authenticated using (true);

drop policy if exists attendance_settings_write on public.attendance_settings;
create policy attendance_settings_write on public.attendance_settings for all
  to authenticated using (public.is_exec()) with check (public.is_exec());

-- ---- teams ----
-- Readable by any authenticated user in the same department (mirrors how
-- departments_select is readable by everyone) — writable by that
-- department's Admin/exec, since managing team structure is literally
-- "admin role assigned to that department".
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select
  to authenticated using (public.is_exec() or department_code = public.current_department());

drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all
  to authenticated
  using (public.is_exec() or (public.is_admin_or_above() and department_code = public.current_department()))
  with check (public.is_exec() or (public.is_admin_or_above() and department_code = public.current_department()));

-- ---- team_members ----
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

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  to authenticated using (
    id = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and public.manages_person(id))
    or (public.current_role() = 'sale' and public.is_my_team_manager(id))
  );

-- Inserts happen only via the staff-provisioning Edge Function using the
-- service-role key (which bypasses RLS entirely) — no authenticated-role
-- insert policy is defined, so client-side self-serve profile creation is
-- impossible by default.

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  to authenticated using (id = auth.uid() or public.is_exec())
  with check (id = auth.uid() or public.is_exec());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete
  to authenticated using (public.is_exec());

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

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert
  to authenticated with check (created_by = auth.uid());

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update
  to authenticated using (
    public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and department_code = public.current_department() and owner_id = auth.uid())
    or owner_id = auth.uid()
  )
  with check (
    public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and department_code = public.current_department() and owner_id = auth.uid())
    or owner_id = auth.uid()
  );

-- Boss/Super Admin can delete any lead; a Manager or Sales Person may only
-- delete a lead they currently own (not the rest of their department/team).
-- Admin has no delete rights, per the original FRD rule.
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete
  to authenticated using (
    public.is_exec()
    or (public.current_role() in ('manager', 'sale') and owner_id = auth.uid())
  );

-- ---- lead_assignments (read-only history; writes happen via trigger only) ----
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

-- Reassignment is performed by updating leads.owner_id (see leads_update
-- policy above + the trg_leads_assignment trigger), plus a dedicated
-- "reassign" action in the app for managers, so managers additionally need
-- update rights on leads.owner_id specifically even when they no longer own
-- the lead. That is handled in the app via an Edge Function / RPC
-- (public.reassign_lead) rather than a broader RLS hole — see function below.

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

-- ---- follow_ups ----
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

drop policy if exists followups_insert on public.follow_ups;
create policy followups_insert on public.follow_ups for insert
  to authenticated with check (
    public.is_exec()
    or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id))
    or public.owns_lead(lead_id)
  );

-- Managers are deliberately excluded from insert/update (FRD: Follow-up =
-- "View Only" for Manager) — only exec, the department's Admin, or the
-- owning salesperson may add/edit follow-up records.
drop policy if exists followups_update on public.follow_ups;
create policy followups_update on public.follow_ups for update
  to authenticated using (
    public.is_exec()
    or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id))
    or public.owns_lead(lead_id)
  );

-- ---- pipeline_history (read-only; writes happen via trigger only) ----
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

-- ---- appointments / site_visits ----
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

drop policy if exists appointments_write on public.appointments;
create policy appointments_write on public.appointments for all
  to authenticated
  using (public.is_exec() or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id)) or public.owns_lead(lead_id))
  with check (public.is_exec() or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id)) or public.owns_lead(lead_id));

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

drop policy if exists site_visits_write on public.site_visits;
create policy site_visits_write on public.site_visits for all
  to authenticated
  using (public.is_exec() or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id)) or public.owns_lead(lead_id))
  with check (public.is_exec() or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id)) or public.owns_lead(lead_id));

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

drop policy if exists checkins_insert on public.check_ins;
create policy checkins_insert on public.check_ins for insert
  to authenticated with check (employee_id = auth.uid());

drop policy if exists checkins_update on public.check_ins;
create policy checkins_update on public.check_ins for update
  to authenticated using (
    (employee_id = auth.uid() and check_in_date = current_date)
    or public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and public.manages_person(employee_id))
  );

drop policy if exists checkins_delete on public.check_ins;
create policy checkins_delete on public.check_ins for delete
  to authenticated using (public.is_exec());

-- ---- notifications ----
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  to authenticated using (recipient_id = auth.uid());

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert
  to authenticated with check (true);

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  to authenticated using (recipient_id = auth.uid());

-- ---- audit_logs ----
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  to authenticated using (public.is_exec());

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert
  to authenticated with check (true);

-- ---- settings ----
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select
  to authenticated using (public.is_exec());

drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all
  to authenticated using (public.is_exec()) with check (public.is_exec());

-- =============================================================================
-- 13. STORAGE (check-in selfies)
-- =============================================================================

-- Public bucket: check-in selfies are only viewable via their (unguessable,
-- UUID-keyed) URL, matching the previous Firebase Storage behavior. Anyone
-- with the URL can view the image, but only the owning employee can upload
-- into their own folder.
insert into storage.buckets (id, name, public)
values ('checkin-photos', 'checkin-photos', true)
on conflict (id) do update set public = true;

drop policy if exists checkin_photos_insert on storage.objects;
create policy checkin_photos_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Profile photos — same shape as checkin-photos above: public bucket
-- (viewable via its unguessable URL), but only the owning user can upload
-- into their own folder. profiles.avatar_url points at whatever the latest
-- upload's public URL is.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists avatar_photos_insert on storage.objects;
create policy avatar_photos_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- 13b. REALTIME — without this, every supabase.channel(...).on('postgres_changes', ...)
-- subscription in the frontend (Leads, Pipeline Board, Dashboard, Follow-ups,
-- Check-in Gallery/Feed, Notifications, User Management, Departments) silently
-- receives nothing: Supabase only broadcasts changes for tables explicitly
-- added to the `supabase_realtime` publication. RLS still applies per
-- subscriber — this only controls which tables can be watched at all.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['departments', 'teams', 'team_members', 'profiles', 'leads', 'follow_ups', 'check_ins', 'notifications']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =============================================================================
-- 14. VIEWS (analytics/KPI convenience — security_invoker so caller RLS applies)
-- =============================================================================

create or replace view public.v_pipeline_counts
  with (security_invoker = true) as
  select department_code, status, count(*) as lead_count
  from public.leads
  group by department_code, status;

create or replace view public.v_agent_performance
  with (security_invoker = true) as
  select
    owner_id as agent_id,
    department_code,
    count(*) as total_leads,
    count(*) filter (where status = 'sold') as sold_count,
    coalesce(sum(sale_amount) filter (where status = 'sold'), 0) as total_revenue
  from public.leads
  where owner_id is not null
  group by owner_id, department_code;

-- =============================================================================
-- 15. SEED DATA — departments, attendance windows, demo accounts, sample leads
-- =============================================================================
-- NOTE: the auth.users insert below uses the well-known local/dev seeding
-- trick of writing directly into Supabase's auth schema with pgcrypto's
-- crypt() to produce a compatible password hash. It is convenient for
-- spinning up a fresh project with working logins, but double-check it
-- against your Supabase project's Postgres/GoTrue version before running
-- in a shared environment — if the direct auth.users insert errors out,
-- create the same accounts via Supabase Studio → Authentication → Add User
-- (or the admin.createUser API) instead, then just run the profiles insert.

insert into public.departments (code, name) values
  ('house', 'House'),
  ('condo', 'Condo'),
  ('project', 'Project')
on conflict (code) do nothing;

insert into public.attendance_settings (department_code) values
  ('house'), ('condo'), ('project')
on conflict (department_code) do nothing;

do $$
declare
  v_pass text := 'Passw0rd!';
  v_ids uuid[] := array[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
  ];
  v_emails text[] := array[
    'boss@psmcrm.test', 'superadmin@psmcrm.test', 'admin@psmcrm.test',
    'house.manager@psmcrm.test', 'condo.manager@psmcrm.test', 'project.manager@psmcrm.test',
    'house.sale@psmcrm.test', 'condo.sale@psmcrm.test', 'project.sale@psmcrm.test'
  ];
  v_names text[] := array[
    'Boss', 'Super Admin', 'Admin',
    'House Manager', 'Condo Manager', 'Project Manager',
    'House Sales', 'Condo Sales', 'Project Sales'
  ];
  v_roles role_tier[] := array[
    'boss', 'super_admin', 'admin',
    'manager', 'manager', 'manager',
    'sale', 'sale', 'sale'
  ]::role_tier[];
  v_depts text[] := array[
    null, null, null,
    'house', 'condo', 'project',
    'house', 'condo', 'project'
  ];
  i int;
begin
  for i in 1 .. array_length(v_ids, 1) loop
    if not exists (select 1 from auth.users where email = v_emails[i]) then
      -- GoTrue (Supabase's auth server) expects these token/change columns to
      -- be empty strings, not NULL — a NULL here causes signInWithPassword to
      -- fail with a 500 Internal Server Error even though the row looks fine.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change, email_change_token_new, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_ids[i], 'authenticated', 'authenticated',
        v_emails[i], crypt(v_pass, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('name', v_names[i]),
        '', '', '', '', '', '', '', ''
      );
    end if;

    insert into public.profiles (id, email, name, role, department_code, status)
    select u.id, v_emails[i], v_names[i], v_roles[i], v_depts[i], 'active'
    from auth.users u where u.email = v_emails[i]
    on conflict (id) do nothing;
  end loop;

  -- Repair any seed accounts inserted by an earlier run of this script
  -- before this NULL-vs-empty-string fix existed.
  update auth.users set
    confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change = coalesce(email_change, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change = coalesce(phone_change, ''),
    phone_change_token = coalesce(phone_change_token, ''),
    reauthentication_token = coalesce(reauthentication_token, '')
  where email = any(v_emails);
end $$;

-- A few sample leads so Dashboard/Pipeline/KPI screens aren't empty on first run.
do $$
declare
  v_house_sale uuid;
  v_condo_sale uuid;
begin
  select id into v_house_sale from public.profiles where email = 'house.sale@psmcrm.test';
  select id into v_condo_sale from public.profiles where email = 'condo.sale@psmcrm.test';

  if v_house_sale is not null and not exists (select 1 from public.leads where phone = '09-111-0001') then
    insert into public.leads (name, phone, department_code, status, owner_id, created_by, lead_source)
    values
      ('Aye Aye Win', '09-111-0001', 'house', 'contacted', v_house_sale, v_house_sale, 'Facebook'),
      ('Zaw Zaw', '09-111-0002', 'house', 'site_visit', v_house_sale, v_house_sale, 'TikTok'),
      ('Su Su Hlaing', '09-111-0003', 'condo', 'new', v_condo_sale, v_condo_sale, 'Instagram'),
      ('Kyaw Kyaw', '09-111-0004', 'condo', 'sold', v_condo_sale, v_condo_sale, 'Boss Content');

    update public.leads set sale_amount = 1500000000 where phone = '09-111-0004';
  end if;
end $$;

-- Backfill: one default team per existing manager, so a fresh install (or
-- an existing project applying this schema for the first time) never
-- leaves a manager or their salespeople without a team on day one. Every
-- salesperson in a department is added to EVERY default team in that
-- department, which — using the multi-team-membership feature itself —
-- exactly reproduces "manager sees the whole department" until an
-- Admin/exec deliberately reorganizes teams via the Team Management page.
-- Safe to re-run: skips managers who already have a team.
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
-- 16. SYSTEM BANNER — standalone maintenance/announcement board
-- =============================================================================
-- Deliberately NOT tied to auth.users/profiles — a separate, narrow-purpose
-- login (see supabase/functions/banner-login, supabase/functions/banner-
-- messages) used only to publish a banner message shown to every visitor
-- (including on the login screen, before any CRM account is involved).
-- Every read/write of banner_admins/banner_sessions and every WRITE of
-- system_messages goes through those two service-role edge functions —
-- there is no RLS policy granting the client direct access to them at all.

do $$ begin
  create type system_message_type as enum ('info', 'warning', 'maintenance', 'critical');
exception when duplicate_object then null; end $$;

create table if not exists public.banner_admins (
  id             uuid primary key default gen_random_uuid(),
  username       text not null unique,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

create table if not exists public.banner_sessions (
  token       uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.banner_admins(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '12 hours')
);

-- Only called by the banner-login edge function via the service-role key —
-- lets it check a password against the pgcrypto hash without the client (or
-- any RLS-bound role) ever touching banner_admins directly.
-- search_path includes `extensions` (not just `public`) because Supabase
-- installs pgcrypto's crypt()/gen_salt() there, not into public.
create or replace function public.verify_banner_admin(p_username text, p_password text)
returns table (id uuid)
language sql security definer set search_path = public, extensions as $$
  select id from public.banner_admins
  where username = p_username and password_hash = crypt(p_password, password_hash);
$$;

-- Only called by the banner-messages edge function to check a session token
-- is real and unexpired before allowing any write to system_messages.
create or replace function public.verify_banner_session(p_token uuid)
returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.banner_sessions where token = p_token and expires_at > now()
  );
$$;

create table if not exists public.system_messages (
  id          uuid primary key default gen_random_uuid(),
  message     text not null,
  type        system_message_type not null default 'maintenance',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_system_messages_active on public.system_messages(is_active);

drop trigger if exists trg_system_messages_updated_at on public.system_messages;
create trigger trg_system_messages_updated_at before update on public.system_messages
  for each row execute function public.set_updated_at();

alter table public.banner_admins enable row level security;
alter table public.banner_sessions enable row level security;
alter table public.system_messages enable row level security;

-- system_messages: anyone — signed in or not — can read the *active*
-- message(s); there is no insert/update/delete policy at all, since every
-- write must go through the banner-messages edge function (service role).
drop policy if exists system_messages_select on public.system_messages;
create policy system_messages_select on public.system_messages for select
  to anon, authenticated using (is_active = true);

-- Realtime so the banner appears/updates/disappears live everywhere the
-- instant an admin edits it, with no page refresh needed.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'system_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.system_messages';
  end if;
end $$;

-- Default banner-admin login — CHANGE THIS PASSWORD before going to
-- production. Documented alongside the other demo credentials in
-- database/credentials.txt.
insert into public.banner_admins (username, password_hash)
values ('sysadmin', crypt('Banner@2026!', gen_salt('bf')))
on conflict (username) do nothing;

-- =============================================================================
-- 16b. MAINTENANCE MODE — full-screen, blocking gate (distinct from the
-- dismissible system_messages banner above). When enabled, every visitor —
-- including on the login screen, and including anyone with the app already
-- open, via Realtime — sees a takeover page instead of the app, except
-- /system-banner-admin itself, which must always stay reachable so an admin
-- can turn it back off. Same architecture as system_messages: a singleton
-- row readable by anyone, writable only through the banner-messages edge
-- function (service role) using the same X-Banner-Token session.
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

drop policy if exists maintenance_settings_select on public.maintenance_settings;
create policy maintenance_settings_select on public.maintenance_settings for select
  to anon, authenticated using (true);

-- No insert/update/delete policy — every write goes through the
-- banner-messages edge function (service role), same as system_messages.

-- Public bucket for the uploaded maintenance-page image — only the
-- service-role edge function ever writes to it (no storage RLS policy
-- needed), but anyone can view the resulting public URL.
insert into storage.buckets (id, name, public)
values ('maintenance', 'maintenance', true)
on conflict (id) do update set public = true;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'maintenance_settings'
  ) then
    execute 'alter publication supabase_realtime add table public.maintenance_settings';
  end if;
end $$;

-- =============================================================================
-- End of database/crm.sql
-- =============================================================================
