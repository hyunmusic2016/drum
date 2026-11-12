-- 드럼 예약 사이트를 다른 사이트(B1 음악 연습실)와 같은 Supabase 프로젝트에서 쓰기 위한 설정
-- 모든 이름이 drum_ 으로 시작해서 B1 쪽 표(admins, reservations …)와 겹치지 않습니다.
-- B1 프로젝트의 SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮습니다.
-- ▼ 맨 아래 관리자 이메일을 꼭 바꿔서 실행하세요.

-- 1) 표 ---------------------------------------------------------------
create table if not exists public.drum_reservations (
  day   date     not null,
  room  text     not null check (room in ('band','drum')),
  slot  smallint not null check (slot between 0 and 17),
  name  text     not null check (char_length(name) between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (day, room, slot)
);

create table if not exists public.drum_admins (
  email text primary key
);

create table if not exists public.drum_lesson_slots (
  weekday smallint not null check (weekday between 0 and 6),
  room    text     not null check (room in ('band','drum')),
  slot    smallint not null check (slot between 0 and 17),
  label   text     not null default '수업' check (char_length(label) between 1 and 20),
  primary key (weekday, room, slot)
);

create table if not exists public.drum_lesson_applied (
  day date primary key
);

create table if not exists public.drum_site_content (
  key   text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

-- 2) 권한 -------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.drum_reservations to anon, authenticated;
grant insert, update, delete on public.drum_reservations to authenticated;
grant select on public.drum_admins to authenticated;
grant select, insert, update, delete on public.drum_lesson_slots to authenticated;
grant select on public.drum_site_content to anon, authenticated;
grant insert, update, delete on public.drum_site_content to authenticated;

alter table public.drum_reservations   enable row level security;
alter table public.drum_admins         enable row level security;
alter table public.drum_lesson_slots   enable row level security;
alter table public.drum_lesson_applied enable row level security;
alter table public.drum_site_content   enable row level security;

-- 드럼 관리자인지 (B1 관리자와 따로)
create or replace function public.drum_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.drum_admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

drop policy if exists "drum anyone can read" on public.drum_reservations;
create policy "drum anyone can read" on public.drum_reservations for select using (true);
drop policy if exists "drum admins insert" on public.drum_reservations;
create policy "drum admins insert" on public.drum_reservations
  for insert to authenticated with check (public.drum_is_admin());
drop policy if exists "drum admins update" on public.drum_reservations;
create policy "drum admins update" on public.drum_reservations
  for update to authenticated using (public.drum_is_admin()) with check (public.drum_is_admin());
drop policy if exists "drum admins delete" on public.drum_reservations;
create policy "drum admins delete" on public.drum_reservations
  for delete to authenticated using (public.drum_is_admin());

drop policy if exists "drum admins read self" on public.drum_admins;
create policy "drum admins read self" on public.drum_admins
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "drum admins manage lesson slots" on public.drum_lesson_slots;
create policy "drum admins manage lesson slots" on public.drum_lesson_slots
  for all to authenticated using (public.drum_is_admin()) with check (public.drum_is_admin());

drop policy if exists "drum anyone reads content" on public.drum_site_content;
create policy "drum anyone reads content" on public.drum_site_content for select using (true);
drop policy if exists "drum admins write content" on public.drum_site_content;
create policy "drum admins write content" on public.drum_site_content
  for all to authenticated using (public.drum_is_admin()) with check (public.drum_is_admin());

-- 3) 오늘 요일 정기 수업을 예약표에 넣기 (예약표가 열릴 때 호출) ---------------
create or replace function public.drum_apply_today_lessons() returns integer
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  n integer := 0;
begin
  insert into drum_lesson_applied(day) values (d) on conflict do nothing;
  if not found then
    return 0;
  end if;
  insert into drum_reservations(day, room, slot, name)
  select d, l.room, l.slot, l.label
  from drum_lesson_slots l
  where l.weekday = extract(dow from d)::int
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.drum_apply_today_lessons() from public;
grant execute on function public.drum_apply_today_lessons() to anon, authenticated;

-- 4) 실시간 반영 --------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.drum_reservations;
exception when duplicate_object then null; end $$;

-- 5) QR 이미지 저장소 (drum-site) ---------------------------------------
insert into storage.buckets (id, name, public) values ('drum-site', 'drum-site', true)
on conflict (id) do update set public = true;

drop policy if exists "drum admins upload site files" on storage.objects;
create policy "drum admins upload site files" on storage.objects
  for insert to authenticated with check (bucket_id = 'drum-site' and public.drum_is_admin());
drop policy if exists "drum admins update site files" on storage.objects;
create policy "drum admins update site files" on storage.objects
  for update to authenticated using (bucket_id = 'drum-site' and public.drum_is_admin());
drop policy if exists "drum admins delete site files" on storage.objects;
create policy "drum admins delete site files" on storage.objects
  for delete to authenticated using (bucket_id = 'drum-site' and public.drum_is_admin());

-- 6) 드럼 관리자 등록 ▼ 이메일을 바꿔서 실행 ---------------------------------
-- (Authentication > Users 에서 이 이메일로 비밀번호 계정을 먼저 만들어 두세요)
insert into public.drum_admins (email) values ('hyunmusic2016@naver.com')
on conflict do nothing;
