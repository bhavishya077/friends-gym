-- Friends Gym security hardening migration
-- Run once in Supabase SQL Editor.

begin;

-- Members may edit safe profile fields, but never their authorization role.
revoke update on table public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on table public.profiles to authenticated;

drop policy if exists "profiles update own or admin" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Role changes are only possible through this audited admin-only function.
create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin authorization required';
  end if;
  if new_role not in ('member', 'trainer', 'admin') then
    raise exception 'invalid role';
  end if;
  update public.profiles set role = new_role, updated_at = now() where id = target_user_id;
  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- Prevent members from changing protected fields even if grants are changed later.
create or replace function public.protect_profile_authorization_fields()
returns trigger
language plpgsql
security definer
set search_path = public
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
create trigger protect_profile_authorization_fields
before update on public.profiles
for each row execute function public.protect_profile_authorization_fields();

-- Useful ownership indexes for policy-filtered queries.
create index if not exists memberships_member_id_idx on public.memberships(member_id);
create index if not exists attendance_member_id_idx on public.attendance(member_id);
create index if not exists workout_plans_member_id_idx on public.workout_plans(member_id);
create index if not exists diet_plans_member_id_idx on public.diet_plans(member_id);
create index if not exists class_bookings_member_id_idx on public.class_bookings(member_id);

-- Members can only create normal bookings and cancel their own existing booking.
drop policy if exists "members create own booking" on public.class_bookings;
create policy "members create own booking" on public.class_bookings
for insert to authenticated
with check (member_id = auth.uid() and status = 'booked');

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
commit;
