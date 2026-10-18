-- Sale details captured when a lead is marked Sold: the sale amount, the
-- company's commission percentage, and the resulting company income.
--
-- The KPI Board ranks sales people by deals closed, conversion (sold ÷
-- leads) and the income they bring the company, instead of lead grade.
--
--   sale_amount        (existing) total sale value in MMK
--   commission_rate    company commission, percent 0–100
--   commission_amount  company income = sale_amount × commission_rate / 100,
--                      a generated column so it can never drift from its inputs
--   sold_at            when the lead entered Sold — server-owned, used to
--                      attribute a deal to a KPI period
--
-- Enforced here rather than only in the UI so every write path (Lead Detail,
-- Pipeline Board, future imports) is held to the same rule: a lead cannot
-- enter Sold without a positive sale amount and a 0–100 commission rate.
-- Sold leads recorded before this migration keep working untouched; they
-- only need both values once someone edits their sale details.
--
-- Mirrors database/crm.sql (§3 leads, §9 triggers, §14 views) — keep both in sync.
-- Idempotent.

-- 1. Columns ----------------------------------------------------------------

alter table public.leads
  add column if not exists commission_rate numeric(5, 2),
  add column if not exists sold_at timestamptz;

alter table public.leads
  add column if not exists commission_amount numeric(14, 2)
    generated always as (round(sale_amount * commission_rate / 100, 2)) stored;

alter table public.leads drop constraint if exists leads_sale_amount_check;
alter table public.leads
  add constraint leads_sale_amount_check check (sale_amount is null or sale_amount >= 0);

alter table public.leads drop constraint if exists leads_commission_rate_check;
alter table public.leads
  add constraint leads_commission_rate_check check (commission_rate is null or commission_rate between 0 and 100);

-- 2. Backfill sold_at for leads already in Sold -----------------------------
-- Uses the most recent move into Sold from pipeline_history, falling back to
-- the row's last update. The guard trigger (§3) is dropped first — it treats
-- sold_at as server-owned and would discard this write on a re-run — and the
-- updated_at trigger is paused so the backfill doesn't rewrite edit times.

drop trigger if exists trg_leads_sale_details on public.leads;
alter table public.leads disable trigger trg_leads_updated_at;

update public.leads l
set sold_at = coalesce(
  (select max(h.changed_at) from public.pipeline_history h where h.lead_id = l.id and h.to_stage = 'sold'),
  l.updated_at
)
where l.status = 'sold' and l.sold_at is null;

alter table public.leads enable trigger trg_leads_updated_at;

create index if not exists idx_leads_sold_at on public.leads(sold_at desc) where status = 'sold';

-- 3. Guard: sale details required on entering Sold; sold_at server-owned ----

create or replace function public.enforce_sale_details() returns trigger
language plpgsql set search_path = public as $$
declare
  v_entering_sold boolean := false;
  v_editing_sale  boolean := false;
begin
  if tg_op = 'INSERT' then
    v_entering_sold := new.status = 'sold';
  else
    v_entering_sold := new.status = 'sold' and old.status is distinct from 'sold';
    v_editing_sale  := new.status = 'sold' and old.status = 'sold'
      and (new.sale_amount is distinct from old.sale_amount
           or new.commission_rate is distinct from old.commission_rate);
  end if;

  if v_entering_sold or v_editing_sale then
    if new.sale_amount is null or new.sale_amount <= 0 then
      raise exception 'A sold lead requires a sale amount greater than 0.'
        using errcode = 'check_violation', hint = 'sale_amount';
    end if;
    if new.commission_rate is null or new.commission_rate < 0 or new.commission_rate > 100 then
      raise exception 'A sold lead requires a commission rate between 0 and 100.'
        using errcode = 'check_violation', hint = 'commission_rate';
    end if;
  end if;

  if v_entering_sold then
    new.sold_at := now();
  elsif new.status is distinct from 'sold' then
    new.sold_at := null;
  elsif tg_op = 'UPDATE' then
    new.sold_at := old.sold_at;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leads_sale_details on public.leads;
create trigger trg_leads_sale_details
  before insert or update of status, sale_amount, commission_rate, sold_at on public.leads
  for each row execute function public.enforce_sale_details();

-- 4. Audit: sale details travel with the pipeline change, and corrections ---
--    to an already-sold lead are logged on their own.

create or replace function public.log_pipeline_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.pipeline_history (lead_id, from_stage, to_stage, changed_by)
    values (new.id, old.status, new.status, auth.uid());

    insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
    values ('pipeline_stage_changed', 'leads', new.id, auth.uid(),
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status) || case when new.status = 'sold' then jsonb_build_object(
              'sale_amount', new.sale_amount,
              'commission_rate', new.commission_rate,
              'commission_amount', new.commission_amount
            ) else '{}'::jsonb end);
  end if;
  return new;
end;
$$;

create or replace function public.log_sale_details_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sold' and old.status = 'sold'
     and (new.sale_amount is distinct from old.sale_amount
          or new.commission_rate is distinct from old.commission_rate) then
    insert into public.audit_logs (action, target_table, target_id, performed_by, old_value, new_value)
    values ('sale_details_updated', 'leads', new.id, auth.uid(),
            jsonb_build_object('sale_amount', old.sale_amount, 'commission_rate', old.commission_rate, 'commission_amount', old.commission_amount),
            jsonb_build_object('sale_amount', new.sale_amount, 'commission_rate', new.commission_rate, 'commission_amount', new.commission_amount));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_sale_audit on public.leads;
create trigger trg_leads_sale_audit after update of sale_amount, commission_rate on public.leads
  for each row execute function public.log_sale_details_change();

-- 5. KPI view: company income per agent (new column appended at the end) ---

create or replace view public.v_agent_performance
  with (security_invoker = true) as
  select
    owner_id as agent_id,
    department_code,
    count(*) as total_leads,
    count(*) filter (where status = 'sold') as sold_count,
    coalesce(sum(sale_amount) filter (where status = 'sold'), 0) as total_revenue,
    coalesce(sum(commission_amount) filter (where status = 'sold'), 0) as company_income
  from public.leads
  where owner_id is not null
  group by owner_id, department_code;
