# Release Script Documentation

## Overview

`release.sh` is an automated production deployment script that intelligently detects dependency changes and runs necessary installation and build commands.

## Location

```
/var/www/mysurflife/release.sh
```

## What It Does

The script automates the entire release workflow:

1. **Pull Latest Changes** - Fetches and merges from `origin/main`
2. **Detect Dependency Changes** - Compares commits to find changed files
3. **Install Backend Dependencies** - If `backend/requirements.txt` changed
4. **Install Frontend Dependencies** - If `frontend/package.json` changed
5. **Build Frontend** - If frontend source files or package.json changed
6. **Clear All Caches** - Python bytecode cache + Redis (on any changes)
7. **Restart Backend Service** - systemd service restart (on any changes)
8. **Restart Apache Webserver** - apache2/httpd restart (on any changes)
9. **Show Status** - Display service health and summary

## Usage

### Standard Release (Recommended)

```bash
cd /var/www/mysurflife
./release.sh
```

This will:
- Pull latest changes
- Only install dependencies if `requirements.txt` or `package.json` changed
- Build frontend if source files changed
- Restart services as needed

### Force Install Mode

```bash
./release.sh --force-install
```

Force install treats `requirements.txt` and `package.json` as changed, even if they haven't been modified. Use this when:
- Dependency files are corrupt
- You suspect cache issues
- Manual verification needed

### Dry Run (Check What Would Change)

```bash
cd /var/www/mysurflife

# See what files changed in latest commits
git fetch origin main
git diff --name-only HEAD origin/main
```

## Requirements

The script expects this production setup:

- Git repository at `/var/www/mysurflife`
- Python virtual environment at `backend/venv`
- Node.js and npm installed
- systemd service: `mysurflife-backend.service`
- sudo permissions for systemctl commands

## Example Output

```bash
$ ./release.sh

═══════════════════════════════════════════════════
  MySurfLife Production Release
═══════════════════════════════════════════════════

📍 Current commit: 3acd197

📥 Pulling latest changes...
✅ Updated to commit: edeb3d2

📝 Changed files:
  backend/requirements.txt
  frontend/src/SpotDetail.js
  frontend/src/SpotDetail.css

🐍 Backend requirements.txt changed
   Installing Python dependencies...
✅ Backend dependencies installed

🎨 Frontend source files changed
🔨 Building frontend for production...
✅ Frontend built successfully

🧹 Clearing caches...
  • Clearing Python bytecode cache...
    ✓ Python cache cleared
  • Flushing Redis cache...
    ✓ Redis cache flushed
✅ Caches cleared

🔄 Restarting backend service...
✅ Backend service restarted
✅ Backend service is running

🌐 Restarting Apache webserver...
✅ Apache2 webserver restarted

═══════════════════════════════════════════════════
  Release Summary
═══════════════════════════════════════════════════
✅ Commit: edeb3d2
✅ Dependencies updated
✅ Frontend built
✅ Caches cleared (Python bytecode + Redis)
✅ Backend restarted
✅ Apache restarted

🚀 Release complete!
```

## What Gets Installed

### Backend (requirements.txt changed)

```bash
cd backend
source venv/bin/activate
pip install --upgrade -r requirements.txt
deactivate
```

### Frontend (package.json changed)

```bash
cd frontend
npm install
npm run build  # Production build
```

## Error Handling

The script uses `set -e` (exit on error), so it will stop immediately if:
- Git pull fails
- Virtual environment not found
- pip install fails
- npm install fails
- npm build fails

Check the error message and fix the issue before re-running.

## Cache Clearing

On any changes (code or dependencies), the script clears all caches:

### Python Bytecode Cache
```bash
find backend -type d -name __pycache__ -exec rm -rf {} +
find backend -name "*.pyc" -delete
```

Ensures Python doesn't use stale compiled bytecode files.

### Redis Cache
```bash
redis-cli FLUSHALL
```

Clears all cached API responses, buoy data, and forecast data. The script gracefully handles:
- Redis not installed (skips with warning)
- Redis not running (skips with warning)

## Service Restart

On any changes (code or dependencies), the script restarts services:

### Backend Service
```bash
sudo systemctl restart mysurflife-backend
```

Then checks service health:
- Waits 3 seconds for startup
- Verifies service is active
- Shows warning if service didn't start

If service fails to start, check logs:
```bash
sudo journalctl -u mysurflife-backend -n 50 -f
```

### Apache Webserver
```bash
sudo systemctl restart apache2  # or httpd on RHEL/CentOS
```

Ensures Apache picks up any configuration changes and serves the new frontend build. The script automatically detects:
- Ubuntu/Debian: `apache2.service`
- RHEL/CentOS: `httpd.service`

## Common Scenarios

### Scenario 1: Only Code Changes (No Dependencies)

```bash
Changed files:
  frontend/src/MapOverlay.js
  backend/main.py

🎨 Frontend source files changed
🔨 Building frontend for production...
✅ Frontend built successfully

Release Summary
✅ Commit: abc1234
ℹ️  No dependency changes detected
✅ Frontend built
```

Backend automatically reloads with uvicorn --reload, no restart needed.

### Scenario 2: Backend Dependencies + Code Changes

```bash
Changed files:
  backend/requirements.txt
  backend/main.py

🐍 Backend requirements.txt changed
   Installing Python dependencies...
✅ Backend dependencies installed

🔄 Restarting backend service...
✅ Backend service restarted
```

### Scenario 3: Frontend Dependencies + Code Changes

```bash
Changed files:
  frontend/package.json
  frontend/src/App.js

📦 Frontend package.json changed
   Installing Node dependencies...
✅ Frontend dependencies installed

🎨 Frontend source files changed
🔨 Building frontend for production...
✅ Frontend built successfully
```

### Scenario 4: No Changes (Already Up to Date)

```bash
✅ Already up to date (3acd197)
```

Script exits immediately, no operations performed.

## Integration with Apache

After frontend build, Apache serves the new build automatically from:
```
/var/www/mysurflife/frontend/build/
```

No Apache restart needed (static files updated in place).

## Troubleshooting

### Script Says "Not in a git repository"

```bash
cd /var/www/mysurflife
git status  # Verify you're in the right place
```

### Virtual Environment Not Found

```bash
# Check if venv exists
ls backend/venv

# If missing, recreate:
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Permission Denied on systemctl

```bash
# Add sudo if not already using it
sudo ./release.sh

# Or add your user to sudoers for systemctl commands
sudo visudo
# Add: youruser ALL=(ALL) NOPASSWD: /bin/systemctl restart mysurflife-backend
```

### npm install Fails

```bash
# Clear npm cache
cd frontend
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Frontend Build Fails

```bash
# Check for JavaScript errors
cd frontend
npm run build

# Check Node version
node --version  # Should be 16+ for React 18
```

## Best Practices

1. **Always pull before making local changes** on production
2. **Test the release script** in a staging environment first
3. **Monitor logs** after release: `sudo journalctl -u mysurflife-backend -f`
4. **Keep backups** of working builds before major releases
5. **Use force-install sparingly** - only when troubleshooting

## Monitoring Release

After running release.sh, verify everything works:

```bash
# Check backend health
curl http://localhost:8000/api/buoy-status/all

# Check frontend
curl -I https://mysurflife.com

# Check service logs
sudo journalctl -u mysurflife-backend -n 50

# Check Apache logs
sudo tail -f /var/log/apache2/mysurflife-error.log
```

## Rollback

If a release breaks production:

```bash
cd /var/www/mysurflife

# Rollback to previous commit
git log --oneline -5  # Find previous commit
git reset --hard <previous-commit>

# Reinstall dependencies
./release.sh --force-install
```

## Alternative: Manual Release

If you prefer manual control:

```bash
cd /var/www/mysurflife

# 1. Pull changes
git pull origin main

# 2. Backend (if needed)
cd backend
source venv/bin/activate
pip install --upgrade -r requirements.txt
deactivate
sudo systemctl restart mysurflife-backend
cd ..

# 3. Frontend (if needed)
cd frontend
npm install
npm run build
cd ..
```

---

**Created**: 2026-01-28
**Purpose**: Automate production deployments with smart dependency detection
**Owner**: DevOps/Deployment workflow
