-- Grade-based follow-up system.
--
-- Rules implemented here:
--   * New leads get an initial follow-up due in 14 days, staggered across an
--     8/rep/day cap so a large spreadsheet import doesn't dump every due
--     date on the same day for one rep.
--   * After each logged follow-up, the next due date depends on the lead's
--     (already auto-synced) grade: A/B -> 2 weeks, C -> 1 month.
--   * A follow-up outcome of Lost/Not Interested auto-closes the lead
--     (status -> lost), which stops all future scheduling.
--   * Old leads are excluded from the automated cadence via a separate
--     follow_up_state ('active' | 'cold') column — NOT by changing the
--     lead's own pipeline stage. A lead's status (New/Contacted/.../Sold/
--     Lost) is left exactly as it already is; follow_up_state only governs
--     whether the automation schedules/reminds on it.
--   * A Cold lead that gets a follow-up logged on it is automatically
--     reactivated (follow_up_state -> 'active') and scheduled as above.
--   * Existing leads are cut over to follow_up_state = 'cold' in one pass
--     below, so only leads created from this point forward are governed by
--     the rules above. This cutover never touches leads.status.

do $$ begin
  create type follow_up_state as enum ('active', 'cold');
exception when duplicate_object then null; end $$;

alter table public.leads add column if not exists follow_up_state follow_up_state not null default 'active';
alter table public.leads add column if not exists follow_up_notified_at timestamptz;

-- Defensive: some callers (e.g. the nested update below, whenever it does
-- include status in its SET list) can fire this AFTER UPDATE OF status
-- trigger even when the value didn't actually change, since Postgres fires
-- column-list triggers based on what's in the SET clause, not on whether
-- the value differs. Without this guard such a no-op would still force a
-- stage-implied grade recompute and could clobber a grade that was just
-- set by sync_grade_from_followup() in the same statement.
create or replace function public.sync_grade_from_pipeline() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new_grade lead_grade;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

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

-- Extends the existing grade-sync trigger to also reactivate a Cold lead
-- and (re)schedule its next due date, in the same statement that already
-- sets the grade so the two can never disagree with each other. status is
-- only ever touched in a separate, conditional statement below — never as
-- a no-op write — so this never spuriously re-fires the pipeline-grade
-- trigger.
create or replace function public.sync_grade_from_followup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new_grade lead_grade;
  v_lead_status lead_stage;
begin
  v_new_grade := public.followup_status_to_grade(new.status);
  select status into v_lead_status from public.leads where id = new.lead_id;

  update public.leads
    set lead_grade = v_new_grade,
        lead_grade_reason = 'Auto-set from follow-up outcome: ' || public.followup_status_label(new.status),
        follow_up_state = 'active',
        next_follow_up_at = case
          when new.status in ('lost', 'not_interested') then null
          when v_lead_status in ('sold', 'lost') then null
          when v_new_grade in ('A', 'B') then now() + interval '14 days'
          else now() + interval '1 month'
        end,
        follow_up_notified_at = null
    where id = new.lead_id;

  if new.status in ('lost', 'not_interested') and v_lead_status not in ('sold', 'lost') then
    update public.leads set status = 'lost' where id = new.lead_id;
  end if;

  return new;
end;
$$;

-- New leads (status left at its default 'new', no explicit follow-up date
-- given) get an initial due date 14 days out, walked forward a day at a
-- time until a day under the 8/rep/day cap is found. Both existing
-- bulk-import flows (Leads.tsx, FollowUps.tsx) already omit
-- next_follow_up_at on insert, so this staggers them with no frontend
-- changes needed.
create or replace function public.stagger_new_lead_follow_up() returns trigger
language plpgsql as $$
declare
  v_candidate date;
  v_count int;
  v_iterations int := 0;
begin
  if new.next_follow_up_at is null and new.owner_id is not null
     and new.status not in ('sold', 'lost') and new.follow_up_state = 'active' then
    v_candidate := current_date + 14;
    loop
      select count(*) into v_count
        from public.leads
        where owner_id = new.owner_id
          and status not in ('sold', 'lost')
          and follow_up_state = 'active'
          and next_follow_up_at::date = v_candidate;
      exit when v_count < 8 or v_iterations >= 90;
      v_candidate := v_candidate + 1;
      v_iterations := v_iterations + 1;
    end loop;
    new.next_follow_up_at := v_candidate::timestamptz;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_stagger_followup on public.leads;
create trigger trg_leads_stagger_followup before insert on public.leads
  for each row execute function public.stagger_new_lead_follow_up();

-- One-time cutover: every currently-open lead is excluded from the new
-- automated cadence by marking it Cold. This never touches leads.status —
-- each lead's pipeline stage (New/Contacted/Qualified/.../Sold/Lost) is
-- left exactly as it already is. Sold/Lost leads are already "done" and
-- are left at follow_up_state's default.
update public.leads set follow_up_state = 'cold' where status not in ('sold', 'lost');
