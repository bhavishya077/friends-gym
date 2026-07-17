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
