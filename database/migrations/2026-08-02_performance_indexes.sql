-- Performance indexes for columns that are heavily filtered/sorted on as
-- leads/follow_ups/profiles grow into the thousands of rows: leads.created_at
-- (default "Newest first" sort + the Date Added filter on the Leads list,
-- plus Dashboard/TeamActivity date-range queries), follow_ups.created_at/
-- status/created_by (Follow-Ups list + Team Activity's per-day query), and
-- profiles.department_code/role/status (department/role-scoped filtering in
-- User Management, Team Activity, Team Management). Purely additive — no
-- data changes, no risk to existing rows.

create index if not exists idx_leads_created_at on public.leads(created_at desc);

create index if not exists idx_followups_created_at on public.follow_ups(created_at desc);
create index if not exists idx_followups_status on public.follow_ups(status);
create index if not exists idx_followups_created_by on public.follow_ups(created_by);

create index if not exists idx_profiles_department on public.profiles(department_code);
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);
