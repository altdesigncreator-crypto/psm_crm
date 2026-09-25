-- =============================================================================
-- Migration: Notify the assigning Admin when their Enquiry is accepted/completed
-- =============================================================================
-- Adds the two remaining notification_type values needed to close the loop
-- back to whoever assigned an Enquiry (public.enquiries.assigned_by): they
-- get pinged when the assignee accepts it and again when it's converted
-- into a Lead. Sending happens client-side right after each status update
-- succeeds — see src/pages/Enquiries.tsx (accept) and src/pages/AddLead.tsx
-- (convert) — nothing here triggers automatically.
--
-- Additive only. Run once via
-- `supabase db query --linked --file database/migrations/2026-09-23_enquiry_status_notifications.sql`.
--
-- Mirrors database/crm.sql (§1 enum types) — keep both in sync.
-- =============================================================================

do $$ begin
  create type notification_type as enum (
    'new_lead_assigned', 'followup_reminder', 'appointment_reminder',
    'site_visit_reminder', 'booking_confirmation', 'warning_notification',
    'checkin_reminder', 'new_enquiry_assigned', 'enquiry_accepted', 'enquiry_completed'
  );
exception when duplicate_object then null; end $$;

alter type notification_type add value if not exists 'enquiry_accepted';
alter type notification_type add value if not exists 'enquiry_completed';

-- =============================================================================
-- End of database/migrations/2026-09-23_enquiry_status_notifications.sql
-- =============================================================================
