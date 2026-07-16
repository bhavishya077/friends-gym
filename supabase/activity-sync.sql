-- Friends Gym per-user workout activity cloud sync.
-- Run once in Supabase SQL Editor after security-hardening.sql.

begin;

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

commit;
