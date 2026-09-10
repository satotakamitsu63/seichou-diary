-- じゅんひかDiary 用スキーマ
-- Supabase の SQL Editor にこのファイルの内容を貼り付けて一度だけ実行する。

create extension if not exists "pgcrypto";

-- 日記を読み書きできる人のメールアドレス。ここに載っている人だけがアクセスできる。
create table if not exists public.diary_members (
  email text primary key
);

insert into public.diary_members (email)
values ('ragubiiii@gmail.com')
on conflict (email) do nothing;

-- 妻を追加するときは、下の行のメールアドレスを書き換えて実行する。
-- insert into public.diary_members (email) values ('wife@example.com') on conflict do nothing;

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  note text not null,
  child text check (child in ('純', '光', 'ふたり')),
  shita text,
  ieta text,
  oboeta text,
  sorted boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists diary_entries_date_idx
  on public.diary_entries (entry_date desc, created_at desc);

create index if not exists diary_entries_unsorted_idx
  on public.diary_entries (sorted) where not sorted;

alter table public.diary_members enable row level security;
alter table public.diary_entries enable row level security;

create or replace function public.is_diary_member()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.diary_members m
    where m.email = auth.jwt() ->> 'email'
  );
$$;

drop policy if exists diary_members_read on public.diary_members;
create policy diary_members_read on public.diary_members
  for select to authenticated
  using (public.is_diary_member());

drop policy if exists diary_entries_all on public.diary_entries;
create policy diary_entries_all on public.diary_entries
  for all to authenticated
  using (public.is_diary_member())
  with check (public.is_diary_member());
