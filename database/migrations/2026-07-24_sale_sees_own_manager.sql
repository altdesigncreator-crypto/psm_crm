-- =============================================================================
-- Migration: Sales Person can see the profile of their own team's manager(s)
-- =============================================================================
-- Discovered while building the universal Profile page (src/pages/Profile.tsx):
-- a Sales Person's own profile should show "Manager: <name>", but
-- profiles_select never granted a Sale role visibility into ANY row besides
-- their own (id = auth.uid()) — so the manager's name/email couldn't be
-- resolved even for someone viewing their own profile. This adds the single
-- missing, narrow grant: a Sale may read the profile row of a person who
-- manages a team they belong to. Nothing else changes — Sale still can't see
-- other salespeople, other departments, or any other manager.
-- Additive/policy-only change — no schema/data touched. Run once in the
-- Supabase SQL editor. Idempotent.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- =============================================================================

create or replace function public.is_my_team_manager(p_manager_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.sale_person_id = auth.uid() and t.manager_id = p_manager_id
  );
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  to authenticated using (
    id = auth.uid()
    or public.is_exec()
    or (public.current_role() = 'admin' and department_code = public.current_department())
    or (public.current_role() = 'manager' and public.manages_person(id))
    or (public.current_role() = 'sale' and public.is_my_team_manager(id))
  );

-- =============================================================================
-- End of database/migrations/2026-07-24_sale_sees_own_manager.sql
-- =============================================================================
