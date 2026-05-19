-- Legacy Real Estate Partners Listing Tracker — Supabase schema
-- Run this ONCE in your Supabase SQL editor:
--   https://supabase.com/dashboard/project/ebppujmhtkvtxrylwght/sql

-- ============================================================
-- LISTINGS TABLE
-- ============================================================
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  property_address text default '',
  listing_agent    text default '',
  listing_date     date,
  notes            text default '',
  previous_listing boolean default false,
  printed_items    boolean default false,
  status           text default 'New' check (status in ('New', 'In Progress', 'Completed')),
  photo_date_1     date,
  photo_date_2     date,
  photo_date_3     date,
  need_1           text default '',
  need_2           text default '',
  need_3           text default '',
  sort_order       integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  created_by       uuid references auth.users(id) on delete set null
);

create index if not exists listings_status_idx     on public.listings (status);
create index if not exists listings_sort_order_idx on public.listings (sort_order);

-- ============================================================
-- updated_at TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_listings_updated_at on public.listings;
create trigger set_listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- ============================================================
-- PROFILES TABLE (for displaying who added each listing,
-- and for marking admins)
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  is_admin   boolean default false,
  created_at timestamptz default now()
);

-- Auto-create a profile row when a new auth user signs up.
-- The very first signup is automatically promoted to admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count int;
begin
  select count(*) into existing_count from public.profiles;
  insert into public.profiles (id, email, is_admin)
  values (new.id, new.email, existing_count = 0);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS — DISABLED (team tool, all data shared)
-- ============================================================
alter table public.listings disable row level security;
alter table public.profiles disable row level security;

-- ============================================================
-- GRANTS — allow anon/authenticated clients to read & write
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.listings to anon, authenticated;
grant select, insert, update           on public.profiles to anon, authenticated;

-- ============================================================
-- BOOTSTRAP — if you already have an auth user but no profile row
-- (e.g. signed up before the trigger existed), run this once:
-- ============================================================
-- insert into public.profiles (id, email, is_admin)
-- select id, email, true
-- from auth.users
-- where id not in (select id from public.profiles)
-- order by created_at asc
-- limit 1
-- on conflict (id) do nothing;
