-- v1.28.0 정기 수업을 30분 단위로
-- Supabase > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮습니다.
-- (lessons.sql 을 먼저 실행한 상태여야 합니다)

-- 30분 칸 단위 시간표. slot: 0 = 1:00~1:30 ... 17 = 9:30~10:00 (예약표와 같음)
create table if not exists public.lesson_slots (
  weekday smallint not null check (weekday between 0 and 6),
  room    text     not null check (room in ('band','drum')),
  slot    smallint not null check (slot between 0 and 17),
  label   text     not null default '수업' check (char_length(label) between 1 and 20),
  primary key (weekday, room, slot)
);

grant select, insert, update, delete on public.lesson_slots to authenticated;
alter table public.lesson_slots enable row level security;

drop policy if exists "admins manage lesson slots" on public.lesson_slots;
create policy "admins manage lesson slots" on public.lesson_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 기존 1시간 단위 수업을 30분 칸 두 개로 옮기기
insert into public.lesson_slots (weekday, room, slot, label)
select l.weekday, l.room, (l.hour - 13) * 2 + s.k, l.label
from public.lessons l cross join (values (0), (1)) as s(k)
on conflict do nothing;

-- 오늘 요일 수업을 예약표에 넣는 함수: 이제 30분 칸 시간표를 사용
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
  select d, l.room, l.slot, l.label
  from lesson_slots l
  where l.weekday = extract(dow from d)::int
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.apply_today_lessons() from public;
grant execute on function public.apply_today_lessons() to anon, authenticated;
