# Render 배포 가이드

이 프로젝트는 Render에서 **웹 서비스 1개 + PostgreSQL + Redis** 구조로 배포할 수 있습니다.

## 1. 권장 방식
1. GitHub에 이 프로젝트를 올립니다.
2. Render에서 **Blueprint** 또는 **New Web Service**로 연결합니다.
3. `render.yaml`을 사용하거나, 수동으로 아래 3개를 만듭니다.
   - Web Service
   - PostgreSQL
   - Redis
4. 웹 서비스 환경변수에 아래 값을 넣습니다.
   - `NODE_ENV=production`
   - `PORT=3000`
   - `TRUST_PROXY=1`
   - `SESSION_SECRET=랜덤긴문자열`
   - `ADMIN_USERNAME=admin`
   - `ADMIN_PASSWORD_HASH=생성한 bcrypt 해시`
   - `DATABASE_URL=Render Postgres 연결문자열`
   - `REDIS_URL=Render Redis 연결문자열`

## 2. 관리자 비밀번호 해시
로컬에서 생성:

```bash
node -e "console.log(require('bcryptjs').hashSync('새비밀번호', 10))"
```

## 3. 주의사항
- Render의 인스턴스 수를 늘리려면 **세션이 Redis에 저장**되므로 이 앱 구조상 문제 없습니다.
- 정적 파일은 앱이 직접 제공하지만, 실제 운영에서는 Cloudflare 앞단 연결을 추천합니다.
- Render 플랜/계정 상태에 따라 Redis 생성 방식이 UI 기준으로 바뀔 수 있습니다.
