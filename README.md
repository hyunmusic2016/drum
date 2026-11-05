# 합주실 · 드럼연습실 예약

오늘 하루의 합주실·드럼연습실 예약 현황을 보여 주는 페이지입니다.

- **관리자**: 이메일 로그인 후 페이지에서 바로 예약을 넣고 지울 수 있습니다.
- **방문자**: 링크로 들어와서 보기만 할 수 있습니다. 저장하면 열려 있는 화면에 실시간으로 반영됩니다.
- **매일 초기화**: 한국 시간 기준 오늘 날짜의 예약만 보여 주므로, 자정이 지나면 표가 비어 있습니다.
- 데스크탑과 모바일 모두 대응합니다.

GitHub Pages(정적 호스팅) + Supabase(DB·로그인)로 동작합니다.

## 처음 설정 (한 번만)

### 1. Supabase 프로젝트 만들기
1. https://supabase.com 에서 새 프로젝트를 만듭니다. (무료 등급으로 충분)
2. **SQL Editor**를 열고 `supabase/schema.sql` 내용을 붙여 넣습니다.
3. 맨 아래 `'관리자이메일@example.com'`을 실제 관리자 이메일로 바꾼 뒤 **Run**을 누릅니다.
   관리자를 더 추가하려면 같은 줄을 이메일만 바꿔 한 번 더 실행하면 됩니다.

### 2. 키 넣기
**Project Settings > API**에서 `Project URL`과 `anon public` 키를 복사해 `config.js`에 넣습니다.
`anon` 키는 공개되어도 괜찮습니다. 쓰기 권한은 DB 정책이 관리자에게만 허용합니다.
`service_role` 키는 절대 넣지 마세요.

### 3. GitHub Pages 켜기
저장소 **Settings > Pages**에서 Source를 `Deploy from a branch`, Branch를 `main` / `/ (root)`로 지정합니다.
잠시 후 `https://<아이디>.github.io/<저장소이름>/` 주소가 생깁니다.
개인 도메인: `CNAME` 파일(drum.hyunmusic.com) + DNS에 CNAME `drum` → `hyunmusic2016.github.io`.

### 4. 로그인 링크가 돌아올 주소 등록
Supabase **Authentication > URL Configuration**에서
- **Site URL**: 위 GitHub Pages 주소
- **Redirect URLs**: 같은 주소를 추가

## 사용법

- 관리자: 페이지 맨 아래 **관리자 로그인** → 이메일로 온 링크 클릭 → **예약 편집**
  → 칸 여러 개 선택 → 이름 입력 후 **적용** → **저장**
- 방문자: 링크만 공유하면 됩니다.

## 지난 기록 정리 (선택)
페이지는 오늘 것만 보여 주므로 정리하지 않아도 됩니다. DB를 깔끔하게 유지하려면
Supabase **Database > Extensions**에서 `pg_cron`을 켜고 `schema.sql` 안의 `cron.schedule` 주석을 풀어 실행하세요.
매일 자정(한국 시간) 직후 지난 날짜 예약이 삭제됩니다.

## 파일
| 파일 | 내용 |
|---|---|
| `index.html` | 페이지 구조와 스타일 |
| `app.js` | 예약 불러오기·편집·저장, 로그인 |
| `config.js` | Supabase 주소와 공개 키 |
| `supabase/schema.sql` | 테이블, 권한 정책, 실시간 설정 |
