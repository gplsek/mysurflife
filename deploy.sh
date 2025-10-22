#!/bin/bash

###############################################################################
# MySurfLife Deployment Script
# Usage: ./deploy.sh
###############################################################################

set -e  # Exit on error

echo "🌊 MySurfLife Deployment Script"
echo "================================"

# Configuration
DEPLOY_DIR="/var/www/mysurflife"
REPO_URL="git@github.com:gplsek/mysurflife.git"
BACKEND_SERVICE="mysurflife-backend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root (needed for some operations)
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}⚠️  Not running as root. Some operations may require sudo.${NC}"
fi

echo ""
echo "📁 Step 1: Pull Latest Code"
echo "----------------------------"
cd $DEPLOY_DIR
git fetch origin
git pull origin main
echo -e "${GREEN}✅ Code updated${NC}"

echo ""
echo "🐍 Step 2: Backend Setup"
echo "------------------------"
cd $DEPLOY_DIR/backend

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate venv and install dependencies
source venv/bin/activate
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
echo -e "${GREEN}✅ Backend dependencies installed${NC}"

echo ""
echo "⚛️  Step 3: Frontend Build"
echo "-------------------------"
cd $DEPLOY_DIR/frontend

# Install Node dependencies
echo "Installing Node dependencies..."
npm install

# Build production frontend
echo "Building React app..."
npm run build
echo -e "${GREEN}✅ Frontend built${NC}"

echo ""
echo "📦 Step 4: Copy Frontend Build to Web Root"
echo "-------------------------------------------"
# Create web root if it doesn't exist
mkdir -p $DEPLOY_DIR/public

# Copy built files to public directory
cp -r $DEPLOY_DIR/frontend/build/* $DEPLOY_DIR/public/
echo -e "${GREEN}✅ Frontend deployed to $DEPLOY_DIR/public${NC}"

echo ""
echo "🔄 Step 5: Restart Backend Service"
echo "-----------------------------------"
if systemctl is-active --quiet $BACKEND_SERVICE; then
    echo "Restarting backend service..."
    sudo systemctl restart $BACKEND_SERVICE
    echo -e "${GREEN}✅ Backend service restarted${NC}"
else
    echo -e "${YELLOW}⚠️  Backend service not running. Start with: sudo systemctl start $BACKEND_SERVICE${NC}"
fi

echo ""
echo "🔍 Step 6: Service Status Check"
echo "--------------------------------"
echo "Backend service status:"
sudo systemctl status $BACKEND_SERVICE --no-pager | head -10

echo ""
echo "🎉 Deployment Complete!"
echo "======================="
echo ""
echo "🌐 Your app should now be live at:"
echo "   - https://mysurflife.com"
echo "   - https://www.mysurflife.com"
echo ""
echo "📊 Useful Commands:"
echo "   - View backend logs: sudo journalctl -u $BACKEND_SERVICE -f"
echo "   - Restart backend: sudo systemctl restart $BACKEND_SERVICE"
echo "   - Check Apache: sudo systemctl status apache2"
echo "   - View Apache logs: sudo tail -f /var/log/apache2/mysurflife-*.log"
echo ""

