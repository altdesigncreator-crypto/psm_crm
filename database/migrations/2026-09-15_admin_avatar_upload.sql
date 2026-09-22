-- =============================================================================
-- Migration: Superadmin/boss can set a staff member's profile photo
-- =============================================================================
-- avatar_photos_insert previously only allowed a user to upload into their
-- own folder in the `avatars` bucket ((storage.foldername(name))[1] =
-- auth.uid()::text). profiles.avatar_url itself was already writable for any
-- row by exec roles (profiles_update RLS already allows id = auth.uid() or
-- is_exec()), but the storage layer blocked an exec from uploading the image
-- file into a sales person's folder in the first place. This widens the
-- storage policy the same way, so Boss/Super Admin can upload a photo into
-- any user's folder from the Staff management page.
-- Additive/policy-only change — no schema/data touched. Run once in the
-- Supabase SQL editor. Idempotent.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- =============================================================================

drop policy if exists avatar_photos_insert on storage.objects;
create policy avatar_photos_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_exec())
  );

-- =============================================================================
-- End of database/migrations/2026-09-15_admin_avatar_upload.sql
-- =============================================================================
