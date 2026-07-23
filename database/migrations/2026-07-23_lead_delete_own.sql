-- =============================================================================
-- Migration: Manager/Sale may delete a lead they currently own
-- =============================================================================
-- Previously leads_delete was exec-only (Boss/Super Admin). Business rule
-- change: a Manager or Sales Person may now also delete a lead, but ONLY one
-- they currently own (owner_id = auth.uid()) — not the rest of their
-- department/team. Admin still has no delete rights (unchanged FRD rule).
-- Additive/policy-only change — no schema/data touched. Run once in the
-- Supabase SQL editor. Idempotent.
--
-- Mirrors the same change applied to database/crm.sql — keep both in sync.
-- =============================================================================

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete
  to authenticated using (
    public.is_exec()
    or (public.current_role() in ('manager', 'sale') and owner_id = auth.uid())
  );

-- =============================================================================
-- End of database/migrations/2026-07-23_lead_delete_own.sql
-- =============================================================================
