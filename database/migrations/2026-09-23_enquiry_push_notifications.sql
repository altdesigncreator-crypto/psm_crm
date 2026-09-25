-- =============================================================================
-- Migration: Notify the assignee when an Enquiry is created
-- =============================================================================
-- Adds a dedicated notification_type value + FK column so assigning an
-- Enquiry (public.enquiries, added in 2026-09-23_enquiries.sql) can raise an
-- in-app notification for the assignee, same shape as every other
-- notification row. Actual sending (in-app insert + real Web Push) happens
-- from the client right after the enquiries insert succeeds — see
-- src/pages/Enquiries.tsx and the new send-user-push edge function; nothing
-- here triggers automatically.
--
-- Additive only. Run once via
-- `supabase db query --linked --file database/migrations/2026-09-23_enquiry_push_notifications.sql`.
--
-- Mirrors database/crm.sql (§1 enum types, §6 notifications) — keep both in sync.
-- =============================================================================

do $$ begin
  create type notification_type as enum (
    'new_lead_assigned', 'followup_reminder', 'appointment_reminder',
    'site_visit_reminder', 'booking_confirmation', 'warning_notification',
    'checkin_reminder', 'new_enquiry_assigned'
  );
exception when duplicate_object then null; end $$;

alter type notification_type add value if not exists 'new_enquiry_assigned';

alter table public.notifications add column if not exists related_enquiry_id uuid references public.enquiries(id) on delete cascade;

-- =============================================================================
-- End of database/migrations/2026-09-23_enquiry_push_notifications.sql
-- =============================================================================
