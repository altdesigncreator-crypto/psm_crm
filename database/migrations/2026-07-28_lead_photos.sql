-- Adds two optional evidence-photo fields to a lead — a site visit photo and
-- an appointment photo — plus the storage bucket and access-control function
-- backing uploads for them. Purely additive: two new nullable columns, one
-- new bucket, two new storage policies, one new helper function. No
-- existing data is touched.

alter table public.leads add column if not exists visit_photo_url text;
alter table public.leads add column if not exists appointment_photo_url text;

-- Who can attach/replace a lead's visit or appointment photo — mirrors the
-- same visibility rule as manager_scoped_lead/canMonitorLead (team-scoped
-- manager, department-scoped admin, exec: all) plus the lead's own owner and
-- whoever created it, so the person filling out Add Lead can still attach a
-- photo for a lead they've just handed off to someone else.
create or replace function public.can_manage_lead_photos(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (
        public.is_exec()
        or (public.current_role() = 'admin' and l.department_code = public.current_department())
        or (public.current_role() = 'manager' and l.team_id is not null and public.manages_team(l.team_id))
        or l.owner_id = auth.uid()
        or l.created_by = auth.uid()
      )
  );
$$;

-- Public bucket, viewable via its unguessable URL. Uploads are keyed by
-- folder = lead id (not uploader id) since more than one authorized person
-- can legitimately attach or replace a given lead's photo over its lifetime.
insert into storage.buckets (id, name, public)
values ('lead-photos', 'lead-photos', true)
on conflict (id) do update set public = true;

drop policy if exists lead_photos_insert on storage.objects;
create policy lead_photos_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'lead-photos'
    and public.can_manage_lead_photos(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists lead_photos_update on storage.objects;
create policy lead_photos_update on storage.objects for update
  to authenticated using (
    bucket_id = 'lead-photos'
    and public.can_manage_lead_photos(((storage.foldername(name))[1])::uuid)
  );
