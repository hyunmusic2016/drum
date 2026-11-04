-- v1.8.0 정기 수업 (요일별 고정 수업)
-- Supabase > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮습니다.

-- 요일별 수업 시간표. weekday: 0=일 1=월 ... 6=토, hour: 시작 시각(13=오후 1시 ... 21=오후 9시), 1시간 수업
create table if not exists public.lessons (
  weekday smallint not null check (weekday between 0 and 6),
  room    text     not null check (room in ('band','drum')),
  hour    smallint not null check (hour between 13 and 21),
  label   text     not null default '수업' check (char_length(label) between 1 and 20),
  primary key (weekday, room, hour)
);

-- 날짜별로 수업을 이미 예약표에 넣었는지 기록 (관리자가 그날 수업을 지워도 다시 생기지 않게)
create table if not exists public.lesson_applied (
  day date primary key
);

grant select, insert, update, delete on public.lessons to authenticated;

alter table public.lessons enable row level security;
alter table public.lesson_applied enable row level security;

drop policy if exists "admins manage lessons" on public.lessons;
create policy "admins manage lessons" on public.lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 오늘(한국 시간) 요일의 수업을 예약표에 한 번만 넣습니다. 이미 다른 예약이 있는 칸은 건드리지 않습니다.
-- 예약 페이지가 열릴 때 자동으로 호출됩니다.
create or replace function public.apply_today_lessons() returns integer
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  n integer := 0;
begin
  insert into lesson_applied(day) values (d) on conflict do nothing;
  if not found then
    return 0;
  end if;
  insert into reservations(day, room, slot, name)
  select d, l.room, (l.hour - 13) * 2 + s.k, l.label
  from lessons l cross join (values (0), (1)) as s(k)
  where l.weekday = extract(dow from d)::int
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.apply_today_lessons() from public;
grant execute on function public.apply_today_lessons() to anon, authenticated;
