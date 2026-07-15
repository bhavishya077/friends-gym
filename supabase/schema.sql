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
