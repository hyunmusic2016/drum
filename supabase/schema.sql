-- 합주실 · 드럼연습실 예약 테이블
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- 맨 아래 admins 에 관리자 이메일을 꼭 넣어 주세요.

create table if not exists public.reservations (
  day   date    not null,                       -- 한국 날짜 (예: 2026-11-04)
  room  text    not null check (room in ('band','drum')),
  slot  smallint not null check (slot between 0 and 17), -- 0 = 1:00~1:30 ... 17 = 9:30~10:00
  name  text    not null check (char_length(name) between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (day, room, slot)
);

-- 관리자 목록 (여기 들어 있는 이메일로 로그인한 사람만 수정 가능)
create table if not exists public.admins (
  email text primary key
);

-- 테이블 접근 권한 ('Automatically expose new tables'를 꺼 둔 경우에도 동작하도록)
grant usage on schema public to anon, authenticated;
grant select on public.reservations to anon, authenticated;
grant insert, update, delete on public.reservations to authenticated;
grant select on public.admins to authenticated;

alter table public.reservations enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- 누구나 보기
drop policy if exists "anyone can read" on public.reservations;
create policy "anyone can read" on public.reservations
  for select using (true);

-- 관리자만 쓰기
drop policy if exists "admins insert" on public.reservations;
create policy "admins insert" on public.reservations
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update" on public.reservations;
create policy "admins update" on public.reservations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete" on public.reservations;
create policy "admins delete" on public.reservations
  for delete to authenticated using (public.is_admin());

-- 관리자 본인이 자기 권한을 확인할 수 있게
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

-- 실시간 반영 (보는 사람 화면이 저장 즉시 바뀜)
do $$ begin
  alter publication supabase_realtime add table public.reservations;
exception when duplicate_object then null; end $$;

-- 지난 날짜 기록 매일 자동 삭제 (선택 사항, Database > Extensions 에서 pg_cron 활성화 후)
-- 페이지는 원래 오늘 날짜만 보여 주므로 이 작업이 없어도 매일 초기화된 것처럼 보입니다.
-- select cron.schedule('clear-old-reservations', '5 15 * * *',
--   $$ delete from public.reservations where day < (now() at time zone 'Asia/Seoul')::date $$);

-- ▼ 관리자 이메일로 바꿔서 실행
insert into public.admins (email) values ('관리자이메일@example.com')
on conflict do nothing;
