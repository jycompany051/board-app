# Oracle Cloud 배포 가이드

이 프로젝트는 Oracle VM 한 대에 Docker Compose로 올리는 방식이 가장 단순합니다.

## 1. 서버 준비
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin nginx unzip
sudo systemctl enable --now docker
```

## 2. 프로젝트 업로드
```bash
scp -i your-key.pem board-app-postgres-redis-deploy.zip ubuntu@YOUR_IP:/home/ubuntu/
ssh -i your-key.pem ubuntu@YOUR_IP
cd /home/ubuntu
unzip board-app-postgres-redis-deploy.zip
cd board-app-postgres-redis
cp .env.example .env
```

## 3. 관리자 비밀번호 해시 생성
```bash
docker run --rm node:20-alpine sh -lc "npm add bcryptjs >/dev/null 2>&1 && node -e \"console.log(require('bcryptjs').hashSync('새비밀번호', 10))\""
```

생성된 해시를 `.env`의 `ADMIN_PASSWORD_HASH`에 넣습니다.

## 4. 앱 실행
```bash
docker compose up -d --build
```

## 5. 외부 nginx 연결
```bash
sudo cp deploy/oracle/nginx.board.conf /etc/nginx/sites-available/board
sudo ln -s /etc/nginx/sites-available/board /etc/nginx/sites-enabled/board
sudo nginx -t
sudo systemctl restart nginx
```

이 설정은 외부 80 포트 → Docker 안의 8080 포트로 연결합니다.

## 6. HTTPS
도메인이 연결되면:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

## 7. 운영 팁
- Oracle 보안목록에서 22, 80, 443 포트를 열어야 합니다.
- 백업은 Docker volume 기반 Postgres dump를 별도로 두는 것이 좋습니다.
