-- Fixes: changing a manager's or salesperson's department never moved their
-- existing leads with them, stranding those leads under the department
-- they'd left — invisible to the new department's admin, and blocking the
-- old department from ever being deleted (its leads still reference it via
-- the leads.department_code foreign key).
--
-- Two parts:
--  1. A trigger so this can never happen again, regardless of which UI path
--     changes a profile's department.
--  2. A one-time backfill that repairs every lead already out of sync with
--     its current owner's department, using the same rule.
--
-- Additive/policy-only — no columns dropped, no rows deleted. Safe to re-run.

create or replace function public.cascade_profile_department_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.department_code is distinct from old.department_code and new.department_code is not null then
    update public.leads
      set department_code = new.department_code, team_id = null
      where owner_id = new.id
        and department_code is distinct from new.department_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_cascade_department on public.profiles;
create trigger trg_profiles_cascade_department after update of department_code on public.profiles
  for each row execute function public.cascade_profile_department_change();

-- One-time repair of existing drift, same rule as the trigger above.
update public.leads l
set department_code = p.department_code, team_id = null
from public.profiles p
where l.owner_id = p.id
  and p.department_code is not null
  and l.department_code is distinct from p.department_code;
