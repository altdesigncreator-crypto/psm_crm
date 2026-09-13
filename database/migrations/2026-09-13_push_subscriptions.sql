-- Web Push subscriptions, so the System Banner Admin can send a real OS-level
-- push notification (arrives even if the CRM tab/app is closed), separate
-- from the existing dismissible system_messages banner.
--
-- Each row is one browser/device's push endpoint for one CRM staff member
-- (auth.users, NOT banner_admins — pushes go to regular app users, only the
-- *sending* is gated behind the banner-admin login). A user can have several
-- rows (phone + laptop, etc). Sending is done service-role-only from the
-- banner-messages edge function; RLS here only ever needs to let a signed-in
-- user manage their own subscription rows.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete
  to authenticated using (auth.uid() = user_id);
