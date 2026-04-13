# 일반 VPS 배포 가이드

이 프로젝트는 VPS 한 대에서도 바로 동작합니다.
추천 방식은 **Docker Compose + systemd** 입니다.

## 1. 설치
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin nginx unzip
sudo systemctl enable --now docker
sudo mkdir -p /opt/board-app
sudo chown -R $USER:$USER /opt/board-app
```

## 2. 파일 업로드
```bash
scp board-app-postgres-redis-deploy.zip user@YOUR_IP:/tmp/
ssh user@YOUR_IP
cd /opt/board-app
unzip /tmp/board-app-postgres-redis-deploy.zip
cd board-app-postgres-redis
cp .env.example .env
```

## 3. 실행
```bash
docker compose up -d --build
```

## 4. 부팅 시 자동 시작
```bash
sudo cp deploy/vps/board-compose.service /etc/systemd/system/board-compose.service
sudo systemctl daemon-reload
sudo systemctl enable --now board-compose.service
```

## 5. 확인
```bash
docker compose ps
curl http://127.0.0.1/health
```
