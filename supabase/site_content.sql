-- v1.37.0 예약표 오른쪽 안내 문구 + QR 이미지
-- Supabase > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮습니다.

create table if not exists public.site_content (
  key   text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;
alter table public.site_content enable row level security;

drop policy if exists "anyone reads content" on public.site_content;
create policy "anyone reads content" on public.site_content for select using (true);
drop policy if exists "admins write content" on public.site_content;
create policy "admins write content" on public.site_content
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- QR 이미지 저장소 (누구나 보기, 관리자만 올리기)
insert into storage.buckets (id, name, public) values ('site', 'site', true)
on conflict (id) do update set public = true;

drop policy if exists "admins upload site files" on storage.objects;
create policy "admins upload site files" on storage.objects
  for insert to authenticated with check (bucket_id = 'site' and public.is_admin());
drop policy if exists "admins update site files" on storage.objects;
create policy "admins update site files" on storage.objects
  for update to authenticated using (bucket_id = 'site' and public.is_admin());
drop policy if exists "admins delete site files" on storage.objects;
create policy "admins delete site files" on storage.objects
  for delete to authenticated using (bucket_id = 'site' and public.is_admin());
