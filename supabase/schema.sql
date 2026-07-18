-- Friends Gym production database foundation
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_url text,
  role text not null default 'member' check (role in ('member', 'trainer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  plan_name text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'expired', 'cancelled')),
  starts_on date,
  expires_on date,
  amount_inr numeric(10,2) not null default 0,
  payment_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  check_in_method text not null default 'qr' check (check_in_method in ('qr', 'manual'))
);

create table if not exists public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  plan jsonb not null default '[]'::jsonb,
  assigned_by uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.diet_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  daily_calories integer,
  plan jsonb not null default '[]'::jsonb,
  assigned_by uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  trainer_id uuid references public.profiles(id) on delete set null,
  starts_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes > 0),
  capacity integer not null default 20 check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.class_bookings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.class_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked', 'attended', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (class_id, member_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.attendance enable row level security;
alter table public.workout_plans enable row level security;
alter table public.diet_plans enable row level security;
alter table public.class_sessions enable row level security;
alter table public.class_bookings enable row level security;

drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles update own or admin" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke update on table public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on table public.profiles to authenticated;

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  if new_role not in ('member', 'trainer', 'admin') then raise exception 'invalid role'; end if;
  update public.profiles set role = new_role, updated_at = now() where id = target_user_id;
  if not found then raise exception 'profile not found'; end if;
end;
$$;
revoke all on function public.admin_set_user_role(uuid, text) from public;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

create or replace function public.protect_profile_authorization_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role changes require admin authorization';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists protect_profile_authorization_fields on public.profiles;
create trigger protect_profile_authorization_fields before update on public.profiles
for each row execute function public.protect_profile_authorization_fields();

drop policy if exists "memberships read own or admin" on public.memberships;
create policy "memberships read own or admin" on public.memberships for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "memberships admin manage" on public.memberships;
create policy "memberships admin manage" on public.memberships for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "attendance read own or admin" on public.attendance;
create policy "attendance read own or admin" on public.attendance for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "attendance admin manage" on public.attendance;
create policy "attendance admin manage" on public.attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "workouts read own or admin" on public.workout_plans;
create policy "workouts read own or admin" on public.workout_plans for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "workouts admin manage" on public.workout_plans;
create policy "workouts admin manage" on public.workout_plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "diets read own or admin" on public.diet_plans;
create policy "diets read own or admin" on public.diet_plans for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "diets admin manage" on public.diet_plans;
create policy "diets admin manage" on public.diet_plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "classes authenticated read" on public.class_sessions;
create policy "classes authenticated read" on public.class_sessions for select to authenticated using (active or public.is_admin());
drop policy if exists "classes admin manage" on public.class_sessions;
create policy "classes admin manage" on public.class_sessions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bookings read own or admin" on public.class_bookings;
create policy "bookings read own or admin" on public.class_bookings for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "members create own booking" on public.class_bookings;
create policy "members create own booking" on public.class_bookings for insert to authenticated with check (member_id = auth.uid() and status = 'booked');
drop policy if exists "members cancel own booking" on public.class_bookings;
create policy "members cancel own booking" on public.class_bookings for update to authenticated using (member_id = auth.uid() or public.is_admin()) with check (member_id = auth.uid() or public.is_admin());

create or replace function public.protect_member_booking_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  if old.member_id <> auth.uid()
     or new.member_id is distinct from old.member_id
     or new.class_id is distinct from old.class_id
     or old.status <> 'booked'
     or new.status <> 'cancelled' then
    raise exception 'members may only cancel their own booking';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_member_booking_changes on public.class_bookings;
create trigger protect_member_booking_changes
before update on public.class_bookings
for each row execute function public.protect_member_booking_changes();

-- Friends Gym per-user workout activity cloud sync.
-- Run once in Supabase SQL Editor after security-hardening.sql.

create table if not exists public.activity_days (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  completed_items text[] not null default '{}',
  steps integer,
  minutes numeric(8,2),
  workout_type text,
  intensity text,
  weight_kg numeric(6,2),
  distance_km numeric(9,3),
  calories integer,
  tracking_source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, activity_date),
  constraint activity_steps_valid check (steps is null or steps between 0 and 500000),
  constraint activity_minutes_valid check (minutes is null or minutes between 0 and 1440),
  constraint activity_weight_valid check (weight_kg is null or weight_kg between 20 and 350),
  constraint activity_distance_valid check (distance_km is null or distance_km between 0 and 1000),
  constraint activity_calories_valid check (calories is null or calories between 0 and 50000),
  constraint activity_workout_valid check (workout_type is null or workout_type in ('strength','cardio','hiit','mobility')),
  constraint activity_intensity_valid check (intensity is null or intensity in ('light','moderate','hard')),
  constraint activity_source_valid check (tracking_source in ('manual','sensor','health-connect'))
);

create index if not exists activity_days_member_date_idx
  on public.activity_days(member_id, activity_date desc);

alter table public.activity_days enable row level security;

grant select, insert, update, delete on table public.activity_days to authenticated;

drop policy if exists "activity read own or admin" on public.activity_days;
create policy "activity read own or admin" on public.activity_days
for select to authenticated
using (member_id = auth.uid() or public.is_admin());

drop policy if exists "activity insert own or admin" on public.activity_days;
create policy "activity insert own or admin" on public.activity_days
for insert to authenticated
with check (member_id = auth.uid() or public.is_admin());

drop policy if exists "activity update own or admin" on public.activity_days;
create policy "activity update own or admin" on public.activity_days
for update to authenticated
using (member_id = auth.uid() or public.is_admin())
with check (member_id = auth.uid() or public.is_admin());

drop policy if exists "activity delete own or admin" on public.activity_days;
create policy "activity delete own or admin" on public.activity_days
for delete to authenticated
using (member_id = auth.uid() or public.is_admin());

create or replace function public.set_activity_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activity_days_set_updated_at on public.activity_days;
create trigger activity_days_set_updated_at
before update on public.activity_days
for each row execute function public.set_activity_updated_at();


-- Friends Gym Razorpay payment ledger and atomic membership activation.
-- Run once in Supabase SQL Editor before enabling payment environment variables.

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  plan_code text not null check (plan_code in ('drop_in', 'standard', 'all_in')),
  plan_name text not null,
  duration_days integer not null check (duration_days between 1 and 730),
  amount_paise integer not null check (amount_paise between 100 and 100000000),
  currency text not null default 'INR' check (currency = 'INR'),
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  membership_id uuid references public.memberships(id) on delete set null,
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  signature_verified boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists payment_transactions_member_created_idx
  on public.payment_transactions(member_id, created_at desc);

alter table public.payment_transactions enable row level security;
revoke all on table public.payment_transactions from anon, authenticated;
grant select on table public.payment_transactions to authenticated;

drop policy if exists "payments read own or admin" on public.payment_transactions;
create policy "payments read own or admin" on public.payment_transactions
for select to authenticated
using (member_id = auth.uid() or public.is_admin());

create or replace function public.complete_razorpay_payment(
  target_order_id text,
  target_payment_id text
)
returns table (membership_id uuid, plan_name text, starts_on date, expires_on date)
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.payment_transactions%rowtype;
  new_membership public.memberships%rowtype;
begin
  select * into payment_row
  from public.payment_transactions
  where razorpay_order_id = target_order_id
  for update;

  if not found then raise exception 'payment order not found'; end if;
  if payment_row.status = 'paid' then
    return query
      select m.id, m.plan_name, m.starts_on, m.expires_on
      from public.memberships m where m.id = payment_row.membership_id;
    return;
  end if;
  if payment_row.status <> 'created' then raise exception 'payment order is not payable'; end if;

  insert into public.memberships (
    member_id, plan_name, status, starts_on, expires_on, amount_inr, payment_reference
  ) values (
    payment_row.member_id,
    payment_row.plan_name,
    'active',
    current_date,
    current_date + payment_row.duration_days,
    payment_row.amount_paise / 100.0,
    target_payment_id
  ) returning * into new_membership;

  update public.payment_transactions
  set status = 'paid',
      razorpay_payment_id = target_payment_id,
      membership_id = new_membership.id,
      signature_verified = true,
      paid_at = now(),
      updated_at = now()
  where id = payment_row.id;

  return query select new_membership.id, new_membership.plan_name,
    new_membership.starts_on, new_membership.expires_on;
end;
$$;

revoke all on function public.complete_razorpay_payment(text, text) from public, anon, authenticated;
grant execute on function public.complete_razorpay_payment(text, text) to service_role;


-- Friends Gym secure live class schedule and per-member bookings.
-- Run once in Supabase SQL Editor.

alter table public.class_sessions add column if not exists category text not null default 'Fitness';
alter table public.class_sessions add column if not exists level text not null default 'All levels';
alter table public.class_sessions add column if not exists description text not null default '';
alter table public.class_sessions add column if not exists trainer_name text not null default 'Friends Gym Coach';

create unique index if not exists class_sessions_title_start_unique
  on public.class_sessions(title, starts_at);

insert into public.class_sessions
  (title, category, level, description, trainer_name, starts_at, duration_minutes, capacity, active)
values
  ('Boxing Fundamentals', 'Combat', 'Intermediate', 'Footwork, combinations and pad work.', 'Coach Riya', (current_date + 1) + time '18:00', 45, 16, true),
  ('Power Lifting Basics', 'Strength', 'Beginner', 'Safe technique for squat, bench and deadlift.', 'Coach Arjun', (current_date + 2) + time '07:00', 60, 12, true),
  ('Mobility & Stretch Flow', 'Recovery', 'All levels', 'Guided mobility to improve range of motion.', 'Coach Neha', (current_date + 3) + time '17:30', 30, 20, true)
on conflict (title, starts_at) do nothing;

create or replace function public.get_class_schedule()
returns table (
  id uuid,
  title text,
  category text,
  level text,
  description text,
  trainer_name text,
  starts_at timestamptz,
  duration_minutes integer,
  capacity integer,
  booked_count bigint,
  user_booking_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.title, s.category, s.level, s.description, s.trainer_name,
    s.starts_at, s.duration_minutes, s.capacity,
    count(b.id) filter (where b.status = 'booked') as booked_count,
    max(case when b.member_id = auth.uid() then b.status end) as user_booking_status
  from public.class_sessions s
  left join public.class_bookings b on b.class_id = s.id
  where s.active and s.starts_at >= now() - interval '2 hours'
  group by s.id
  order by s.starts_at asc
  limit 30;
$$;

create or replace function public.book_class(target_class_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.class_sessions%rowtype;
  occupied bigint;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into target from public.class_sessions where id = target_class_id for update;
  if not found or not target.active then raise exception 'class unavailable'; end if;
  if target.starts_at <= now() then raise exception 'class has already started'; end if;
  select count(*) into occupied from public.class_bookings
    where class_id = target_class_id and status = 'booked';
  if occupied >= target.capacity then raise exception 'class is full'; end if;

  delete from public.class_bookings
    where class_id = target_class_id and member_id = auth.uid() and status = 'cancelled';
  insert into public.class_bookings(class_id, member_id, status)
  values(target_class_id, auth.uid(), 'booked')
  on conflict (class_id, member_id) do nothing;
  return 'booked';
end;
$$;

create or replace function public.cancel_class_booking(target_class_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.class_bookings set status = 'cancelled'
    where class_id = target_class_id and member_id = auth.uid() and status = 'booked';
  if not found then raise exception 'active booking not found'; end if;
  return 'cancelled';
end;
$$;

revoke all on function public.get_class_schedule() from public, anon;
revoke all on function public.book_class(uuid) from public, anon;
revoke all on function public.cancel_class_booking(uuid) from public, anon;
grant execute on function public.get_class_schedule() to authenticated;
grant execute on function public.book_class(uuid) to authenticated;
grant execute on function public.cancel_class_booking(uuid) to authenticated;
