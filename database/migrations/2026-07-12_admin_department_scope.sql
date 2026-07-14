-- =============================================================================
-- Migration: Admin becomes department-scoped (like Manager, with more power
-- inside the department). Only Boss/Super Admin (is_exec) remain global.
-- Run this once in the Supabase SQL editor. Idempotent.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- NOTE: every Admin profile must now have a department_code; an Admin with
-- NULL department only sees their own records. Assign departments to any
-- existing Admin accounts after running this.
-- =============================================================================

-- Helper: is the lead in the caller's department?
create or replace function public.lead_in_my_department(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads
    where id = p_lead_id and department_code = public.current_department()
  );
$$;

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  to authenticated using (
    id = auth.uid()
    or public.is_exec()
    or (public.current_role() in ('admin', 'manager') and department_code = public.current_department())
  );

-- ---- leads ----
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select
  to authenticated using (
    public.is_exec()
    or (public.current_role() in ('admin', 'manager') and department_code = public.current_department())
    or owner_id = auth.uid()
  );

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

-- ---- lead_assignments ----
drop policy if exists lead_assignments_select on public.lead_assignments;
create policy lead_assignments_select on public.lead_assignments for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l
      where l.id = lead_assignments.lead_id
        and (l.owner_id = auth.uid()
             or (public.current_role() in ('admin', 'manager') and l.department_code = public.current_department()))
    )
  );

-- ---- reassign RPC ----
create or replace function public.reassign_lead(p_lead_id uuid, p_new_owner uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
begin
  select department_code into v_dept from public.leads where id = p_lead_id;

  if not (
    public.is_exec()
    or (public.current_role() in ('admin', 'manager') and v_dept = public.current_department())
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
        and ((public.current_role() in ('admin', 'manager') and l.department_code = public.current_department())
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

drop policy if exists followups_update on public.follow_ups;
create policy followups_update on public.follow_ups for update
  to authenticated using (
    public.is_exec()
    or (public.current_role() = 'admin' and public.lead_in_my_department(lead_id))
    or public.owns_lead(lead_id)
  );

-- ---- pipeline_history ----
drop policy if exists pipeline_history_select on public.pipeline_history;
create policy pipeline_history_select on public.pipeline_history for select
  to authenticated using (
    public.is_exec()
    or exists (
      select 1 from public.leads l where l.id = pipeline_history.lead_id
        and ((public.current_role() in ('admin', 'manager') and l.department_code = public.current_department())
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
        and ((public.current_role() in ('admin', 'manager') and l.department_code = public.current_department())
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
        and ((public.current_role() in ('admin', 'manager') and l.department_code = public.current_department())
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
    or (public.current_role() in ('admin', 'manager') and exists (
      select 1 from public.profiles p where p.id = warnings.issued_to and p.department_code = public.current_department()
    ))
  );

drop policy if exists warnings_insert on public.warnings;
create policy warnings_insert on public.warnings for insert
  to authenticated with check (
    public.is_exec()
    or (public.current_role() in ('admin', 'manager') and exists (
      select 1 from public.profiles p where p.id = warnings.issued_to and p.department_code = public.current_department()
    ))
  );

-- ---- check_ins ----
drop policy if exists checkins_select on public.check_ins;
create policy checkins_select on public.check_ins for select
  to authenticated using (
    employee_id = auth.uid()
    or public.is_exec()
    or (public.current_role() in ('admin', 'manager') and department_code = public.current_department())
  );

drop policy if exists checkins_update on public.check_ins;
create policy checkins_update on public.check_ins for update
  to authenticated using (
    (employee_id = auth.uid() and check_in_date = current_date)
    or public.is_exec()
    or (public.current_role() in ('admin', 'manager') and department_code = public.current_department())
  );
