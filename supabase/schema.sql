-- じゅんひかDiary 用スキーマ
-- Supabase の SQL Editor にこのファイルの内容を貼り付けて一度だけ実行する。

create extension if not exists "pgcrypto";

-- 日記を読み書きできる人のメールアドレス。ここに載っている人だけがアクセスできる。
create table if not exists public.diary_members (
  email text primary key
);

insert into public.diary_members (email)
values ('ragubiiiii@gmail.com')
on conflict (email) do nothing;

-- 家族が増えるときは合言葉から自分で登録できる（このファイルの末尾を参照）。
-- 手で追加したいときは、下の行のメールアドレスを書き換えて実行する。
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

-- 家族の合言葉。これを知っている人はアプリから自分で登録できる。
create table if not exists public.diary_invite (
  code text primary key
);

-- ポリシーを作らないので、誰も直接は読めない。下の関数の中だけで参照される。
alter table public.diary_invite enable row level security;

insert into public.diary_invite (code)
values ('JUNHIKA')
on conflict (code) do nothing;

create or replace function public.join_diary(invite_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null then
    return false;
  end if;

  if not exists (select 1 from public.diary_invite i where i.code = invite_code) then
    return false;
  end if;

  insert into public.diary_members (email)
  values (caller_email)
  on conflict (email) do nothing;

  return true;
end;
$$;

revoke all on function public.join_diary(text) from public, anon;
grant execute on function public.join_diary(text) to authenticated;

-- 写真・動画。記録1件につき1つまで。実体はStorageに置き、ここには置き場所と種類だけを持つ。
alter table public.diary_entries add column if not exists media_path text;
alter table public.diary_entries add column if not exists media_type text
  check (media_type in ('image', 'video'));

-- 非公開のバケット。URLを知られても中身は見られない（署名付きURLでのみ表示する）。
-- 1ファイル50MBまで。長い動画は入らないので、アプリ側で先に知らせる。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'diary-media',
  'diary-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists diary_media_all on storage.objects;
create policy diary_media_all on storage.objects
  for all to authenticated
  using (bucket_id = 'diary-media' and public.is_diary_member())
  with check (bucket_id = 'diary-media' and public.is_diary_member());
