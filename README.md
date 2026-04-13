# PostgreSQL + Redis + 확장형 게시판

## 이 버전에서 바뀐 점
- SQLite 대신 **PostgreSQL** 사용
- 세션 저장소를 **Redis**로 분리해서 앱 서버 여러 대에서도 관리자 로그인 유지
- `app1`, `app2` 두 대를 `nginx`가 로드밸런싱
- 공지 상단 고정, 일반 글 번호 증가, 관리자 답글/삭제 유지
- Health 체크와 기본 Rate Limit 포함

## 빠른 실행
```bash
cp .env.example .env
docker compose up -d --build
```

브라우저 접속:
```bash
http://localhost
```

## 기본 관리자 계정
- 아이디: `admin`
- 비밀번호: `admin1234`

배포 전에는 반드시 `.env`의 아래 두 값을 바꾸세요.
- `SESSION_SECRET`
- `ADMIN_PASSWORD_HASH`

## 관리자 비밀번호 해시 만들기
```bash
docker run --rm node:20-alpine sh -lc "npm add bcryptjs >/dev/null 2>&1 && node -e \"console.log(require('bcryptjs').hashSync('새비밀번호', 10))\""
```

## 구성
```text
사용자
  ↓
nginx (로드밸런서)
  ↓
app1, app2 (Express)
  ↓
PostgreSQL
  ↓
Redis (세션 저장소)
```

## 주요 엔드포인트
- `/` : 게시판 UI
- `/health` : 상태 확인

## 운영 팁
- 외부 배포 시 `TRUST_PROXY=1` 유지
- HTTPS 뒤에서 운영 시 `NODE_ENV=production`
- 앱 서버를 더 늘리고 싶으면 `app3`, `app4`를 추가하고 nginx upstream에 붙이면 됩니다.
