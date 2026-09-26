-- Enquiry category (Condo vs House & Land), stored on the enquiry itself.
--
-- The source alone can't decide the category: several sources exist under
-- both (Boss Viber, the Department sources, Open Verse), so the category
-- picked in the New/Edit Enquiry form is saved here. The Enquiries page
-- filter and the Dashboard's Condo / House & Land counts both read this
-- column. (enquiry_counters is unrelated — it only generates ENQ numbers.)

alter table public.enquiries
  add column if not exists category text not null default 'condo';

alter table public.enquiries
  drop constraint if exists enquiries_category_check;
alter table public.enquiries
  add constraint enquiries_category_check check (category in ('condo', 'house_land'));

-- Backfill: rows whose source only exists under House & Land.
-- Everything else keeps the 'condo' default.
update public.enquiries
set category = 'house_land'
where source in (
  'House&Land Listing',
  'House Channel',
  'PSM Property (BL)',
  'PSM Property',
  'Property Seeker',
  'House Channel Tiktok',
  'PSM Property Tiktok',
  'IMyanmarHouse',
  'Office Ph Call',
  'Boss Ph Call'
);

-- Manual corrections requested for enquiries created before this column existed.
update public.enquiries set category = 'condo'      where enquiry_no = 'ENQ-2609260001';
update public.enquiries set category = 'house_land' where enquiry_no = 'ENQ-2609260002';

-- Dashboard counts filter on category (and on assigned_to for non-admins).
create index if not exists enquiries_category_idx on public.enquiries (category);
create index if not exists enquiries_assigned_to_category_idx on public.enquiries (assigned_to, category);
