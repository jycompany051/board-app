#!/usr/bin/env bash
set -e

APP_DIR=/opt/board-app
DOMAIN=${1:-_}

sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin nginx git unzip
sudo systemctl enable --now docker
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR

echo "프로젝트 파일을 $APP_DIR 에 넣은 뒤 아래를 실행하세요:"
echo "cd $APP_DIR && cp .env.example .env && docker compose up -d --build"
echo "그 후 nginx 설정 파일을 복사하세요:"
echo "sudo cp deploy/oracle/nginx.board.conf /etc/nginx/sites-available/board"
echo "sudo ln -s /etc/nginx/sites-available/board /etc/nginx/sites-enabled/board"
echo "sudo nginx -t && sudo systemctl restart nginx"
echo "도메인이 있으면 certbot으로 HTTPS를 붙이세요."
