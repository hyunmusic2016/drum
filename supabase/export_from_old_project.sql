-- 지금 드럼 전용 Supabase 프로젝트에서 실행 → 결과로 나온 SQL 문장을 복사해서 B1 프로젝트에서 실행
-- (결과는 한 줄짜리 insert 문 네 개입니다. 비어 있는 줄은 옮길 데이터가 없는 것)

-- 1) 정기 수업 시간표
select 'insert into public.drum_lesson_slots (weekday, room, slot, label) values '
  || string_agg(format('(%s, %L, %s, %L)', weekday, room, slot, label), ', ')
  || ' on conflict do nothing;' as sql
from public.lesson_slots
union all
-- 2) 안내 문구 (상자·자간 설정)
select 'insert into public.drum_site_content (key, value) values '
  || string_agg(format('(%L, %L)', key, value), ', ')
  || ' on conflict (key) do update set value = excluded.value;'
from public.site_content
union all
-- 3) 오늘 이후 예약 (오늘 예약표가 그대로 보이게)
select 'insert into public.drum_reservations (day, room, slot, name) values '
  || string_agg(format('(%L, %L, %s, %L)', day, room, slot, name), ', ')
  || ' on conflict do nothing;'
from public.reservations
where day >= (now() at time zone 'Asia/Seoul')::date
union all
-- 4) 오늘 정기 수업을 이미 넣었다는 기록 (지운 수업이 다시 생기지 않게)
select 'insert into public.drum_lesson_applied (day) values '
  || string_agg(format('(%L)', day), ', ')
  || ' on conflict do nothing;'
from public.lesson_applied
where day >= (now() at time zone 'Asia/Seoul')::date;
