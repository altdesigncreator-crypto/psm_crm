-- =============================================================================
-- Migration: Profile photo storage
-- =============================================================================
-- Lets every user upload their own profile photo, shown wherever their name
-- appears (NameLink, the Profile page, Team Activity, Staff directory, the
-- sidebar). `profiles.avatar_url` already existed in the schema but was never
-- populated or rendered anywhere — this adds the storage bucket + policy so
-- the app can actually write to it. No RLS change needed on `profiles`
-- itself: profiles_update already lets a user update their own row
-- (id = auth.uid()), and the enforce_profile_update_rules trigger only
-- restricts role/department_code/status changes, not avatar_url.
-- Additive/policy-only change — no schema/data touched. Run once in the
-- Supabase SQL editor. Idempotent.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- =============================================================================

-- Public bucket, same reasoning as checkin-photos: viewable via its
-- (unguessable, UUID/timestamp-keyed) URL, but only the owning user can
-- upload into their own folder.
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
-- End of database/migrations/2026-07-25_avatar_photos.sql
-- =============================================================================
