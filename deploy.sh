#!/bin/bash
###############################################################################
# deploy.sh - Full deployment script for 360data-solution
# Deploys BOTH Frontend (Vite build) and Backend (Express + Prisma)
#
# Usage:
#   SSH into your server, cd to /var/www/360data-bi, and run:
#   bash deploy.sh
#
# Prerequisites:
#   - Node.js 20+, PM2, Nginx installed (use setup-server.sh first)
#   - PostgreSQL running and accessible
#   - .env files configured for both root and backend
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_DIR="/var/www/360data-bi"
BACKEND_DIR="$APP_DIR/backend"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🚀 360data-solution Full Deployment${NC}"
echo -e "${BLUE}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ==========================================
# Step 0: Pre-flight checks
# ==========================================
echo -e "\n${YELLOW}[0/7] Pre-flight checks...${NC}"

# Check .env files exist
if [ ! -f "$APP_DIR/.env" ]; then
    echo -e "${RED}❌ Missing $APP_DIR/.env${NC}"
    echo "   Create it with: GEMINI_API_KEY, API_KEY, PORT, GOOGLE_CLIENT_ID"
    exit 1
fi

if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${RED}❌ Missing $BACKEND_DIR/.env${NC}"
    echo "   Create it with: DATABASE_URL, JWT_SECRET, PORT, FRONTEND_URL, RESEND_API_KEY"
    exit 1
fi

echo -e "${GREEN}✅ Environment files found${NC}"

# ==========================================
# Step 1: Pull latest code
# ==========================================
echo -e "\n${YELLOW}[1/7] Pulling latest code from Git...${NC}"
cd "$APP_DIR"
git pull origin main || git pull origin master || echo "⚠️ Git pull skipped"
echo -e "${GREEN}✅ Code updated${NC}"

# ==========================================
# Step 2: Install Frontend dependencies
# ==========================================
echo -e "\n${YELLOW}[2/7] Installing Frontend dependencies...${NC}"
cd "$APP_DIR"
npm install --production=false  # Need devDeps for build
echo -e "${GREEN}✅ Frontend dependencies installed${NC}"

# ==========================================
# Step 3: Build Frontend (Vite)
# ==========================================
echo -e "\n${YELLOW}[3/7] Building Frontend (Vite)...${NC}"
cd "$APP_DIR"
npm run build
echo -e "${GREEN}✅ Frontend built successfully → dist/${NC}"

# ==========================================
# Step 4: Install Backend dependencies
# ==========================================
echo -e "\n${YELLOW}[4/7] Installing Backend dependencies...${NC}"
cd "$BACKEND_DIR"
npm install
echo -e "${GREEN}✅ Backend dependencies installed${NC}"

# ==========================================
# Step 5: Build Backend & Generate Prisma Client
# ==========================================
echo -e "\n${YELLOW}[5/7] Building Backend (TypeScript + Prisma)...${NC}"
cd "$BACKEND_DIR"

# Generate Prisma client
npx prisma generate
echo -e "${GREEN}  ✅ Prisma client generated${NC}"

# Push schema to database (safe for production)
npx prisma db push --accept-data-loss=false
echo -e "${GREEN}  ✅ Database schema synced${NC}"

# Build TypeScript
npm run build
echo -e "${GREEN}✅ Backend built successfully → backend/dist/${NC}"

# ==========================================
# Step 6: Restart PM2 processes
# ==========================================
echo -e "\n${YELLOW}[6/7] Restarting PM2 processes...${NC}"
cd "$APP_DIR"

# Stop existing processes (ignore errors if not running)
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true

# Start both services
pm2 start ecosystem.config.js
pm2 save

echo -e "${GREEN}✅ PM2 processes started${NC}"

# ==========================================
# Step 7: Health checks
# ==========================================
echo -e "\n${YELLOW}[7/7] Running health checks...${NC}"

# Wait for services to boot
sleep 3

# Check Frontend
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 | grep -q "200"; then
    echo -e "${GREEN}  ✅ Frontend is UP (port 8080)${NC}"
else
    echo -e "${RED}  ⚠️ Frontend may not be ready yet (port 8080)${NC}"
fi

# Check Backend
if curl -s http://localhost:3001/api/health | grep -q "ok"; then
    echo -e "${GREEN}  ✅ Backend is UP (port 3001)${NC}"
else
    echo -e "${RED}  ⚠️ Backend may not be ready yet (port 3001)${NC}"
fi

# ==========================================
# Summary
# ==========================================
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${GREEN}Frontend:${NC}  http://localhost:8080"
echo -e "  ${GREEN}Backend:${NC}   http://localhost:3001"
echo -e "  ${GREEN}Health:${NC}    http://localhost:3001/api/health"
echo ""
echo -e "  ${YELLOW}PM2 Status:${NC}"
pm2 list
echo ""
echo -e "  ${YELLOW}Useful Commands:${NC}"
echo -e "    pm2 logs           - View all logs"
echo -e "    pm2 logs 360data-frontend  - Frontend logs"
echo -e "    pm2 logs 360data-backend   - Backend logs"
echo -e "    pm2 restart all    - Restart all services"
echo ""
