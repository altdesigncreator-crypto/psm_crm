-- Stops the 'new_lead_assigned' notification from being created on lead
-- insert/reassignment. Leaves lead_assignments (assignment history) and
-- audit_logs untouched — only the notifications insert is removed.
-- Existing 'new_lead_assigned' rows in public.notifications are left as-is;
-- this only affects what happens going forward.
create or replace function public.log_lead_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.owner_id is not null)
     or (tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and new.owner_id is not null) then
    insert into public.lead_assignments (lead_id, assigned_to, assigned_by, note)
    values (new.id, new.owner_id, auth.uid(), case when tg_op = 'INSERT' then 'Initial assignment' else 'Reassigned' end);

    insert into public.audit_logs (action, target_table, target_id, performed_by, new_value)
    values (case when tg_op = 'INSERT' then 'lead_created' else 'lead_reassigned' end,
            'leads', new.id, auth.uid(), jsonb_build_object('owner_id', new.owner_id));
  end if;
  return new;
end;
$$;
