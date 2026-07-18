-- Friends Gym dynamic admin class manager and roster attendance.
-- Run once in Supabase SQL Editor after class-booking.sql.

alter table public.class_bookings
  drop constraint if exists class_bookings_status_check;
alter table public.class_bookings
  add constraint class_bookings_status_check
  check (status in ('booked', 'attended', 'absent', 'cancelled'));

create index if not exists class_sessions_starts_at_idx
  on public.class_sessions(starts_at desc);
create index if not exists class_bookings_class_status_idx
  on public.class_bookings(class_id, status);

create or replace function public.admin_get_class_sessions()
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
  active boolean,
  booked_count bigint,
  attended_count bigint,
  absent_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  return query
  select s.id, s.title, s.category, s.level, s.description, s.trainer_name,
    s.starts_at, s.duration_minutes, s.capacity, s.active,
    count(b.id) filter (where b.status in ('booked', 'attended')) as booked_count,
    count(b.id) filter (where b.status = 'attended') as attended_count,
    count(b.id) filter (where b.status = 'absent') as absent_count
  from public.class_sessions s
  left join public.class_bookings b on b.class_id = s.id
  group by s.id
  order by s.starts_at desc
  limit 100;
end;
$$;

create or replace function public.admin_upsert_class(
  p_class_id uuid,
  p_title text,
  p_category text,
  p_level text,
  p_description text,
  p_trainer_name text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_capacity integer,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
  occupied bigint;
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'class title is required'; end if;
  if length(trim(coalesce(p_trainer_name, ''))) < 2 then raise exception 'trainer name is required'; end if;
  if p_starts_at is null then raise exception 'class date and time are required'; end if;
  if p_duration_minutes not between 10 and 240 then raise exception 'duration must be between 10 and 240 minutes'; end if;
  if p_capacity not between 1 and 500 then raise exception 'capacity must be between 1 and 500'; end if;

  if p_class_id is null then
    insert into public.class_sessions
      (title, category, level, description, trainer_name, starts_at, duration_minutes, capacity, active)
    values
      (trim(p_title), trim(coalesce(p_category, 'Fitness')), trim(coalesce(p_level, 'All levels')),
       trim(coalesce(p_description, '')), trim(p_trainer_name), p_starts_at,
       p_duration_minutes, p_capacity, coalesce(p_active, true))
    returning id into saved_id;
  else
    select count(*) into occupied from public.class_bookings
      where class_id = p_class_id and status in ('booked', 'attended');
    if p_capacity < occupied then raise exception 'capacity cannot be lower than confirmed bookings'; end if;
    update public.class_sessions set
      title = trim(p_title),
      category = trim(coalesce(p_category, 'Fitness')),
      level = trim(coalesce(p_level, 'All levels')),
      description = trim(coalesce(p_description, '')),
      trainer_name = trim(p_trainer_name),
      starts_at = p_starts_at,
      duration_minutes = p_duration_minutes,
      capacity = p_capacity,
      active = coalesce(p_active, true)
    where id = p_class_id
    returning id into saved_id;
    if saved_id is null then raise exception 'class not found'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.admin_cancel_class(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  update public.class_sessions set active = false where id = p_class_id;
  if not found then raise exception 'class not found'; end if;
  update public.class_bookings set status = 'cancelled'
    where class_id = p_class_id and status = 'booked';
end;
$$;

create or replace function public.admin_get_class_roster(p_class_id uuid)
returns table (
  booking_id uuid,
  member_id uuid,
  member_name text,
  member_phone text,
  status text,
  booked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  return query
  select b.id, b.member_id,
    coalesce(nullif(trim(p.full_name), ''), 'Member') as member_name,
    coalesce(p.phone, '') as member_phone,
    b.status, b.created_at
  from public.class_bookings b
  join public.profiles p on p.id = b.member_id
  where b.class_id = p_class_id
  order by b.created_at asc;
end;
$$;

create or replace function public.admin_set_class_attendance(p_booking_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin authorization required'; end if;
  if p_status not in ('booked', 'attended', 'absent', 'cancelled') then
    raise exception 'invalid attendance status';
  end if;
  update public.class_bookings set status = p_status where id = p_booking_id;
  if not found then raise exception 'booking not found'; end if;
end;
$$;

create or replace function public.get_class_schedule()
returns table (
  id uuid, title text, category text, level text, description text,
  trainer_name text, starts_at timestamptz, duration_minutes integer,
  capacity integer, booked_count bigint, user_booking_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.title, s.category, s.level, s.description, s.trainer_name,
    s.starts_at, s.duration_minutes, s.capacity,
    count(b.id) filter (where b.status in ('booked', 'attended')) as booked_count,
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
    where class_id = target_class_id and status in ('booked', 'attended');
  if occupied >= target.capacity then raise exception 'class is full'; end if;
  delete from public.class_bookings
    where class_id = target_class_id and member_id = auth.uid() and status in ('cancelled', 'absent');
  insert into public.class_bookings(class_id, member_id, status)
  values(target_class_id, auth.uid(), 'booked')
  on conflict (class_id, member_id) do nothing;
  return 'booked';
end;
$$;
revoke all on function public.admin_get_class_sessions() from public, anon;
revoke all on function public.admin_upsert_class(uuid,text,text,text,text,text,timestamptz,integer,integer,boolean) from public, anon;
revoke all on function public.admin_cancel_class(uuid) from public, anon;
revoke all on function public.admin_get_class_roster(uuid) from public, anon;
revoke all on function public.admin_set_class_attendance(uuid,text) from public, anon;
grant execute on function public.admin_get_class_sessions() to authenticated;
grant execute on function public.admin_upsert_class(uuid,text,text,text,text,text,timestamptz,integer,integer,boolean) to authenticated;
grant execute on function public.admin_cancel_class(uuid) to authenticated;
grant execute on function public.admin_get_class_roster(uuid) to authenticated;
grant execute on function public.admin_set_class_attendance(uuid,text) to authenticated;
revoke all on function public.book_class(uuid) from public, anon;
grant execute on function public.book_class(uuid) to authenticated;
