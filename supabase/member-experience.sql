-- Friends Gym personalised member experience.
-- Run once in Supabase SQL Editor after schema.sql and activity-sync.sql.

begin;

alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists height_cm numeric(6,2);
alter table public.profiles add column if not exists weight_kg numeric(6,2);
alter table public.profiles add column if not exists fitness_goal text;
alter table public.profiles add column if not exists experience_level text;
alter table public.profiles add column if not exists workout_days integer;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
alter table public.profiles add column if not exists units text not null default 'metric';
alter table public.profiles add column if not exists notification_preferences jsonb not null default '{"workout":true,"classes":true,"membership":true}'::jsonb;
alter table public.profiles add column if not exists checkin_token uuid not null default gen_random_uuid();
create unique index if not exists profiles_checkin_token_unique on public.profiles(checkin_token);

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check check (gender is null or gender in ('male','female','other','prefer_not_to_say'));
alter table public.profiles drop constraint if exists profiles_goal_check;
alter table public.profiles add constraint profiles_goal_check check (fitness_goal is null or fitness_goal in ('lose','maintain','gain','strength','endurance','mobility'));
alter table public.profiles drop constraint if exists profiles_experience_check;
alter table public.profiles add constraint profiles_experience_check check (experience_level is null or experience_level in ('beginner','intermediate','advanced'));
alter table public.profiles drop constraint if exists profiles_units_check;
alter table public.profiles add constraint profiles_units_check check (units in ('metric','imperial'));
alter table public.profiles drop constraint if exists profiles_height_check;
alter table public.profiles add constraint profiles_height_check check (height_cm is null or height_cm between 100 and 250);
alter table public.profiles drop constraint if exists profiles_weight_check;
alter table public.profiles add constraint profiles_weight_check check (weight_kg is null or weight_kg between 25 and 350);
alter table public.profiles drop constraint if exists profiles_workout_days_check;
alter table public.profiles add constraint profiles_workout_days_check check (workout_days is null or workout_days between 1 and 7);

grant update (full_name, phone, avatar_url, birth_date, gender, height_cm, weight_kg, fitness_goal, experience_level, workout_days, onboarding_complete, units, notification_preferences)
on table public.profiles to authenticated;

create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  measured_on date not null default current_date,
  weight_kg numeric(6,2),
  waist_cm numeric(6,2),
  body_fat_percent numeric(5,2),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (member_id, measured_on),
  constraint measurement_weight_valid check (weight_kg is null or weight_kg between 25 and 350),
  constraint measurement_waist_valid check (waist_cm is null or waist_cm between 30 and 250),
  constraint measurement_body_fat_valid check (body_fat_percent is null or body_fat_percent between 2 and 70)
);

create table if not exists public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  logged_on date not null default current_date,
  meal_type text not null default 'meal',
  item_name text not null,
  calories integer not null default 0,
  protein_g numeric(7,2) not null default 0,
  carbs_g numeric(7,2) not null default 0,
  fats_g numeric(7,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint nutrition_meal_type_valid check (meal_type in ('breakfast','lunch','dinner','snack','meal')),
  constraint nutrition_calories_valid check (calories between 0 and 10000),
  constraint nutrition_macros_valid check (protein_g between 0 and 1000 and carbs_g between 0 and 2000 and fats_g between 0 and 1000)
);

create index if not exists body_measurements_member_date_idx on public.body_measurements(member_id, measured_on desc);
create index if not exists nutrition_logs_member_date_idx on public.nutrition_logs(member_id, logged_on desc, created_at desc);

alter table public.body_measurements enable row level security;
alter table public.nutrition_logs enable row level security;
grant select, insert, update, delete on public.body_measurements to authenticated;
grant select, insert, update, delete on public.nutrition_logs to authenticated;

drop policy if exists "measurements read own or admin" on public.body_measurements;
create policy "measurements read own or admin" on public.body_measurements for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "measurements insert own or admin" on public.body_measurements;
create policy "measurements insert own or admin" on public.body_measurements for insert to authenticated with check (member_id = auth.uid() or public.is_admin());
drop policy if exists "measurements update own or admin" on public.body_measurements;
create policy "measurements update own or admin" on public.body_measurements for update to authenticated using (member_id = auth.uid() or public.is_admin()) with check (member_id = auth.uid() or public.is_admin());
drop policy if exists "measurements delete own or admin" on public.body_measurements;
create policy "measurements delete own or admin" on public.body_measurements for delete to authenticated using (member_id = auth.uid() or public.is_admin());

drop policy if exists "nutrition read own or admin" on public.nutrition_logs;
create policy "nutrition read own or admin" on public.nutrition_logs for select to authenticated using (member_id = auth.uid() or public.is_admin());
drop policy if exists "nutrition insert own or admin" on public.nutrition_logs;
create policy "nutrition insert own or admin" on public.nutrition_logs for insert to authenticated with check (member_id = auth.uid() or public.is_admin());
drop policy if exists "nutrition update own or admin" on public.nutrition_logs;
create policy "nutrition update own or admin" on public.nutrition_logs for update to authenticated using (member_id = auth.uid() or public.is_admin()) with check (member_id = auth.uid() or public.is_admin());
drop policy if exists "nutrition delete own or admin" on public.nutrition_logs;
create policy "nutrition delete own or admin" on public.nutrition_logs for delete to authenticated using (member_id = auth.uid() or public.is_admin());


create or replace function public.admin_qr_checkin(p_member_id uuid, p_token text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_token text;
  recent_checkin timestamptz;
  saved_at timestamptz;
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  select checkin_token::text into expected_token from public.profiles where id = p_member_id;
  if expected_token is null or expected_token <> trim(coalesce(p_token, '')) then raise exception 'invalid member QR token'; end if;
  select max(checked_in_at) into recent_checkin from public.attendance where member_id = p_member_id;
  if recent_checkin is not null and recent_checkin > now() - interval '4 hours' then raise exception 'member is already checked in'; end if;
  insert into public.attendance(member_id, check_in_method) values(p_member_id, 'qr') returning checked_in_at into saved_at;
  return saved_at;
end;
$$;
revoke all on function public.admin_qr_checkin(uuid,text) from public, anon;
grant execute on function public.admin_qr_checkin(uuid,text) to authenticated;
commit;
