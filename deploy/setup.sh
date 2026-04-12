#!/bin/bash
# ═══════════════════════════════════════
# Smart Psych API - Setup Script
# Run from the api/ folder:
#   chmod +x deploy/setup.sh
#   sudo deploy/setup.sh api.yourdomain.com
# ═══════════════════════════════════════

set -e

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[✓]${NC} $1"; }

DOMAIN="${1:-$(curl -s ifconfig.me)}"
APP_DIR="$(pwd)"
DB_NAME="smart_psych"
DB_USER="smartpsych_user"
DB_PASS="$(openssl rand -base64 24)"
JWT_SECRET="$(openssl rand -base64 48)"

echo ""
echo "═══════════════════════════════════"
echo "  Smart Psych API Setup"
echo "  Domain: ${DOMAIN}"
echo "═══════════════════════════════════"
echo ""

# 1. Node.js
if ! command -v node &>/dev/null; then
    log "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
log "Node $(node -v)"

# 2. MySQL
if ! command -v mysql &>/dev/null; then
    log "Installing MySQL..."
    apt install -y mysql-server
    systemctl start mysql && systemctl enable mysql
fi

# 3. PM2
if ! command -v pm2 &>/dev/null; then
    log "Installing PM2..."
    npm install -g pm2
fi

# 4. Nginx
if ! command -v nginx &>/dev/null; then
    log "Installing Nginx..."
    apt install -y nginx
    systemctl enable nginx
fi

# 5. Database
log "Setting up database..."
mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';" 2>/dev/null || true
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost'; FLUSH PRIVILEGES;" 2>/dev/null || true

# 6. .env
log "Creating .env..."
cat > ${APP_DIR}/.env << EOF
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=30d
EOF

# 7. Install + migrate + seed
log "Installing dependencies..."
cd ${APP_DIR}
npm install --production
mkdir -p logs

log "Running migrations..."
mysql -u ${DB_USER} -p"${DB_PASS}" ${DB_NAME} < migrations/schema.sql 2>/dev/null || true

log "Seeding admin user..."
node seed.js || true

# 8. Nginx
log "Configuring Nginx..."
cat > /etc/nginx/sites-available/smartpsych-api << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 90s;
        client_max_body_size 10M;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/smartpsych-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 9. PM2
log "Starting with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════"
echo -e "  ${GREEN}API Ready!${NC}"
echo "═══════════════════════════════════════"
echo ""
echo "  URL:       http://${DOMAIN}/api/health"
echo "  Admin:     mbmabadie@gmail.com / 123456"
echo "  DB User:   ${DB_USER}"
echo "  DB Pass:   ${DB_PASS}"
echo ""
echo "  Commands:"
echo "    pm2 status    - check"
echo "    pm2 logs      - logs"
echo "    pm2 restart smartpsych-api"
echo ""
echo "  SSL:"
echo "    certbot --nginx -d ${DOMAIN}"
echo "═══════════════════════════════════════"
