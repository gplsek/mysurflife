# 🚀 MySurfLife Deployment Guide

Complete guide to deploy MySurfLife on a production server with Apache.

---

## 📋 Prerequisites

- Ubuntu/Debian server (or similar)
- Apache 2.4+ installed
- Python 3.8+
- Node.js 14+ and npm
- Git
- Domain: `mysurflife.com` pointing to your server

---

## 🔧 Initial Server Setup (One-Time)

### 1. Install Required Packages

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Apache and modules
sudo apt install apache2 -y

# Enable required Apache modules
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod rewrite
sudo a2enmod headers
sudo a2enmod ssl

# Install Python and pip
sudo apt install python3 python3-pip python3-venv -y

# Install Node.js and npm (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y

# Install Git
sudo apt install git -y

# Verify installations
apache2 -v
python3 --version
node --version
npm --version
git --version
```

### 2. Clone Repository

```bash
# Create web directory
sudo mkdir -p /var/www/mysurflife

# Clone repository
cd /var/www
sudo git clone git@github.com:gplsek/mysurflife.git mysurflife

# Set permissions
sudo chown -R $USER:$USER /var/www/mysurflife
```

### 3. Backend Setup

```bash
cd /var/www/mysurflife/backend

# Create Python virtual environment
python3 -m venv venv

# Activate venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Test backend (optional)
uvicorn main:app --host 127.0.0.1 --port 8000
# Press Ctrl+C to stop
```

### 4. Frontend Setup

```bash
cd /var/www/mysurflife/frontend

# Install dependencies
npm install

# Build production version
npm run build

# Create public directory and copy build
sudo mkdir -p /var/www/mysurflife/public
sudo cp -r build/* /var/www/mysurflife/public/
```

### 5. Configure Backend Service

```bash
# Copy service file
sudo cp /var/www/mysurflife/mysurflife-backend.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable mysurflife-backend

# Start service
sudo systemctl start mysurflife-backend

# Check status
sudo systemctl status mysurflife-backend
```

### 6. Configure Apache Virtual Host

```bash
# Copy Apache config
sudo cp /var/www/mysurflife/mysurflife.conf /etc/apache2/sites-available/

# Disable default site (optional)
sudo a2dissite 000-default.conf

# Enable MySurfLife site
sudo a2ensite mysurflife.conf

# Test Apache configuration
sudo apache2ctl configtest

# Restart Apache
sudo systemctl restart apache2
```

### 7. Set Proper Permissions

```bash
# Set ownership to www-data (Apache user)
sudo chown -R www-data:www-data /var/www/mysurflife/public
sudo chown -R www-data:www-data /var/www/mysurflife/backend

# Make deploy script executable
chmod +x /var/www/mysurflife/deploy.sh
```

### 8. Configure Firewall

```bash
# Allow HTTP and HTTPS
sudo ufw allow 'Apache Full'

# Check firewall status
sudo ufw status
```

### 9. Setup SSL (HTTPS) with Let's Encrypt (OPTIONAL - Add Later)

Skip this for now. Add SSL when ready:

```bash
# Install Certbot (when ready for SSL)
sudo apt install certbot python3-certbot-apache -y

# Get SSL certificate (when ready for SSL)
sudo certbot --apache -d mysurflife.com -d www.mysurflife.com

# Follow prompts to:
# - Enter email
# - Agree to terms
# - Choose to redirect HTTP to HTTPS (recommended)

# Test auto-renewal
sudo certbot renew --dry-run
```

**Note**: Certbot will automatically update your Apache config when you run it.

---

## 🔄 Deployment Process (Updates)

Every time you want to deploy new code:

### Option 1: Automated Deployment Script (Recommended)

```bash
cd /var/www/mysurflife
./deploy.sh
```

This script will:
- ✅ Pull latest code from Git
- ✅ Install Python dependencies
- ✅ Install Node dependencies
- ✅ Build React frontend
- ✅ Copy build to public directory
- ✅ Restart backend service

### Option 2: Manual Deployment

```bash
# 1. Pull latest code
cd /var/www/mysurflife
git pull origin main

# 2. Update backend
cd backend
source venv/bin/activate
pip install -r requirements.txt

# 3. Build frontend
cd ../frontend
npm install
npm run build

# 4. Copy to public
sudo cp -r build/* /var/www/mysurflife/public/

# 5. Restart backend
sudo systemctl restart mysurflife-backend

# 6. Check status
sudo systemctl status mysurflife-backend
```

---

## 🔍 Useful Commands

### View Logs

```bash
# Backend logs (live)
sudo journalctl -u mysurflife-backend -f

# Backend logs (last 50 lines)
sudo journalctl -u mysurflife-backend -n 50

# Apache access logs
sudo tail -f /var/log/apache2/mysurflife-access.log

# Apache error logs
sudo tail -f /var/log/apache2/mysurflife-error.log
```

### Service Management

```bash
# Restart backend
sudo systemctl restart mysurflife-backend

# Stop backend
sudo systemctl stop mysurflife-backend

# Start backend
sudo systemctl start mysurflife-backend

# Check backend status
sudo systemctl status mysurflife-backend

# Restart Apache
sudo systemctl restart apache2

# Check Apache status
sudo systemctl status apache2
```

### Troubleshooting

```bash
# Test Apache configuration
sudo apache2ctl configtest

# Check if backend is running
curl http://localhost:8000/api/buoy-status/all

# Check Apache port bindings
sudo netstat -tulpn | grep apache

# Check backend port
sudo netstat -tulpn | grep 8000

# View all enabled Apache sites
ls -la /etc/apache2/sites-enabled/

# Check file permissions
ls -la /var/www/mysurflife/public/
```

---

## 📁 Directory Structure

```
/var/www/mysurflife/
├── backend/
│   ├── venv/              # Python virtual environment
│   ├── main.py            # FastAPI application
│   ├── requirements.txt   # Python dependencies
│   └── ...
├── frontend/
│   ├── src/               # React source code
│   ├── build/             # Production build (generated)
│   ├── package.json       # Node dependencies
│   └── ...
├── public/                # Apache document root
│   ├── index.html         # Copied from frontend/build
│   ├── static/            # Copied from frontend/build
│   └── ...
├── deploy.sh              # Deployment script
├── mysurflife.conf        # Apache vhost config
├── mysurflife-backend.service  # Systemd service
└── DEPLOYMENT.md          # This file
```

---

## 🔐 Security Checklist

- ⏳ SSL/HTTPS (add later with certbot)
- ✅ Security headers configured in Apache
- ✅ Backend only accessible via localhost (127.0.0.1:8000)
- ✅ Frontend served via Apache with proper permissions
- ✅ Firewall configured (UFW)
- ✅ Regular updates: `sudo apt update && sudo apt upgrade`

**Note**: Add SSL certificate when ready for production use.

---

## 🧪 Testing Deployment

After deployment, test these URLs:

1. **Frontend**: http://mysurflife.com (or http://your-server-ip)
   - Should load the React app
   - Check browser console for errors

2. **Backend API**: http://mysurflife.com/api/buoy-status/all
   - Should return JSON with 14 buoys

3. **Mobile**: Open on phone
   - Should be responsive
   - Full-screen buoy details should work

**Note**: URLs will use `https://` after SSL certificate is installed.

---

## 🐛 Common Issues

### Issue: Apache shows "403 Forbidden"
```bash
# Fix permissions
sudo chown -R www-data:www-data /var/www/mysurflife/public
sudo chmod -R 755 /var/www/mysurflife/public
```

### Issue: Backend API not responding
```bash
# Check if backend is running
sudo systemctl status mysurflife-backend

# View backend logs
sudo journalctl -u mysurflife-backend -n 50

# Restart backend
sudo systemctl restart mysurflife-backend
```

### Issue: SSL certificate errors
```bash
# Renew certificate
sudo certbot renew

# Restart Apache
sudo systemctl restart apache2
```

### Issue: React app shows blank page
```bash
# Check browser console for errors
# Rebuild frontend
cd /var/www/mysurflife/frontend
npm run build
sudo cp -r build/* /var/www/mysurflife/public/
```

---

## 🔄 Rollback

If something goes wrong:

```bash
# Revert to previous Git commit
cd /var/www/mysurflife
git log  # Find previous commit hash
git checkout <commit-hash>

# Redeploy
./deploy.sh
```

---

## 📞 Support

- Check logs first: `sudo journalctl -u mysurflife-backend -f`
- Test backend directly: `curl http://localhost:8000/api/buoy-status/all`
- Verify Apache config: `sudo apache2ctl configtest`

---

**Deployment created**: 2025-10-22
**Last updated**: Check Git commit history

