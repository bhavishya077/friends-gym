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
