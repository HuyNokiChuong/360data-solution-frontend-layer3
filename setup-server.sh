#!/bin/bash

###############################################################################
# Server Setup Script - Cài đặt môi trường production lần đầu
# Chạy script này trên server để cài đặt Node.js, PM2, Nginx
###############################################################################

set -e  # Exit on error

echo "🚀 Bắt đầu cài đặt môi trường production server..."

# Update system packages
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Node.js 20 LTS
echo "📦 Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify Node.js installation
node --version
npm --version

# Install PM2 globally
echo "📦 Installing PM2 process manager..."
npm install -g pm2

# Install Nginx
echo "📦 Installing Nginx..."
apt install -y nginx

# Install Git (if not already installed)
echo "📦 Installing Git..."
apt install -y git

# Create application directory
echo "📁 Creating application directory..."
mkdir -p /var/www/360data-bi
chown -R $USER:$USER /var/www/360data-bi

# Configure firewall (UFW)
echo "🔥 Configuring firewall..."
ufw allow 22/tcp      # SSH
ufw allow 2305/tcp    # Custom SSH port
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw allow 8080/tcp    # Node.js app
ufw --force enable

# Setup PM2 startup script
echo "⚙️ Setting up PM2 startup..."
pm2 startup systemd -u $USER --hp /root
env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /root

echo "✅ Server setup completed!"
echo ""
echo "📝 Next steps:"
echo "1. Upload your application code to /var/www/360data-bi"
echo "2. Create .env file with your environment variables"
echo "3. Run 'npm install' in the application directory"
echo "4. Configure Nginx (copy nginx.conf to /etc/nginx/sites-available/)"
echo "5. Start application with PM2"
