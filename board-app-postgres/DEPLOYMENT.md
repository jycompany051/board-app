# 배포 요약

## 가장 쉬운 선택
- **Render**: 운영 쉬움, 외부 관리형 DB/Redis 사용
- **Oracle/VPS**: Docker Compose 한 번에 실행 가능

## Render
- `render.yaml` 제공
- 외부 Postgres/Redis 연결형
- 실제 서비스에서는 Cloudflare 앞단 추천

## Oracle/VPS
- `docker compose up -d --build`
- 서비스 구성: Postgres + Redis + app1 + app2 + nginx
- 서버 한 대 안에서도 앱 서버 2개로 로드밸런싱

## 꼭 바꿔야 하는 환경변수
- `SESSION_SECRET`
- `ADMIN_PASSWORD_HASH`
- 필요하면 `ADMIN_USERNAME`

## 포트
- Docker Compose 직접 실행: 80
- Oracle 외부 nginx 연결형 예시: 8080 → 80 프록시

## 헬스체크
- `/health`
