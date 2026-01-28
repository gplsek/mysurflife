#!/bin/bash
# MySurfLife Production Release Script
# Automatically installs dependencies if requirements.txt or package.json changed
# Usage: ./release.sh [--force-install] [--force-build]

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (should be project root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  MySurfLife Production Release${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# Parse arguments
FORCE_INSTALL=false
FORCE_BUILD=false
for arg in "$@"; do
  case $arg in
    --force-install)
      FORCE_INSTALL=true
      echo -e "${YELLOW}🔧 Force install mode enabled${NC}"
      ;;
    --force-build)
      FORCE_BUILD=true
      echo -e "${YELLOW}🔧 Force build mode enabled${NC}"
      ;;
  esac
done

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo -e "${RED}❌ Error: Not in a git repository${NC}"
  exit 1
fi

# Track last released commit
LAST_RELEASE_FILE=".last-release"
LAST_RELEASED_COMMIT=""
if [[ -f "$LAST_RELEASE_FILE" ]]; then
  LAST_RELEASED_COMMIT=$(cat "$LAST_RELEASE_FILE")
fi

# Get current commit before pull
BEFORE_COMMIT=$(git rev-parse HEAD)
echo -e "${BLUE}📍 Current commit: ${BEFORE_COMMIT:0:7}${NC}"

if [[ -n "$LAST_RELEASED_COMMIT" ]]; then
  echo -e "${BLUE}📌 Last released: ${LAST_RELEASED_COMMIT:0:7}${NC}"
fi
echo ""

# Pull latest changes
echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main

# Get commit after pull
AFTER_COMMIT=$(git rev-parse HEAD)

# Determine if we need to process changes
PROCESS_CHANGES=false

if [[ "$FORCE_BUILD" == true ]] || [[ "$FORCE_INSTALL" == true ]]; then
  # Force flags always trigger processing
  PROCESS_CHANGES=true
  echo -e "${YELLOW}🔧 Force mode: processing changes${NC}"
elif [[ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ]]; then
  # Git pull found changes
  PROCESS_CHANGES=true
  echo -e "${GREEN}✅ Updated to commit: ${AFTER_COMMIT:0:7}${NC}"
elif [[ -n "$LAST_RELEASED_COMMIT" ]] && [[ "$AFTER_COMMIT" != "$LAST_RELEASED_COMMIT" ]]; then
  # Current commit differs from last released commit
  PROCESS_CHANGES=true
  echo -e "${YELLOW}⚠️  Current commit (${AFTER_COMMIT:0:7}) differs from last release (${LAST_RELEASED_COMMIT:0:7})${NC}"
  echo -e "${YELLOW}   Building unreleased changes...${NC}"
  # Set BEFORE_COMMIT to last released so we compare correctly
  BEFORE_COMMIT="$LAST_RELEASED_COMMIT"
else
  # No changes detected
  echo -e "${GREEN}✅ Already up to date (${AFTER_COMMIT:0:7})${NC}"
  echo ""
  exit 0
fi

echo -e "${GREEN}✅ Updated to commit: ${AFTER_COMMIT:0:7}${NC}"
echo ""

# Get list of changed files between commits
if [[ "$FORCE_INSTALL" == true ]]; then
  CHANGED_FILES="requirements.txt package.json"
  echo -e "${YELLOW}🔧 Force install: treating requirements.txt and package.json as changed${NC}"
else
  CHANGED_FILES=$(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT")
fi

echo -e "${BLUE}📝 Changed files:${NC}"
echo "$CHANGED_FILES" | sed 's/^/  /'
echo ""

# Track if any installs happened
INSTALLED_SOMETHING=false
NEEDS_BACKEND_RESTART=false
NEEDS_FRONTEND_BUILD=false

# Check if backend requirements changed
if echo "$CHANGED_FILES" | grep -q "backend/requirements.txt"; then
  echo -e "${YELLOW}🐍 Backend requirements.txt changed${NC}"
  echo -e "${YELLOW}   Installing Python dependencies...${NC}"

  cd backend

  # Check if venv exists
  if [[ ! -d "venv" ]]; then
    echo -e "${RED}❌ Error: Virtual environment not found at backend/venv${NC}"
    exit 1
  fi

  # Activate venv and install
  source venv/bin/activate
  pip install --upgrade -r requirements.txt
  deactivate

  cd ..

  echo -e "${GREEN}✅ Backend dependencies installed${NC}"
  INSTALLED_SOMETHING=true
  NEEDS_BACKEND_RESTART=true
  echo ""
fi

# Check if frontend package.json changed
if echo "$CHANGED_FILES" | grep -q "frontend/package.json"; then
  echo -e "${YELLOW}📦 Frontend package.json changed${NC}"
  echo -e "${YELLOW}   Installing Node dependencies...${NC}"

  cd frontend

  # Check if node_modules exists
  if [[ ! -d "node_modules" ]]; then
    echo -e "${YELLOW}⚠️  Warning: node_modules not found, running clean install${NC}"
  fi

  npm install

  cd ..

  echo -e "${GREEN}✅ Frontend dependencies installed${NC}"
  INSTALLED_SOMETHING=true
  NEEDS_FRONTEND_BUILD=true
  echo ""
fi

# Check if any frontend source files changed
if echo "$CHANGED_FILES" | grep -q "^frontend/src/"; then
  echo -e "${YELLOW}🎨 Frontend source files changed${NC}"
  NEEDS_FRONTEND_BUILD=true
fi

# Build frontend if needed
if [[ "$NEEDS_FRONTEND_BUILD" == true ]]; then
  echo -e "${YELLOW}🔨 Building frontend for production...${NC}"

  cd frontend
  npm run build
  cd ..

  echo -e "${GREEN}✅ Frontend built successfully${NC}"
  echo ""
fi

# Clear caches (always run on any changes)
if [[ "$PROCESS_CHANGES" == true ]]; then
  echo -e "${YELLOW}🧹 Clearing caches...${NC}"

  # Clear Python bytecode cache
  echo -e "  • Clearing Python bytecode cache..."
  find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
  find backend -name "*.pyc" -delete 2>/dev/null || true
  echo -e "    ${GREEN}✓${NC} Python cache cleared"

  # Clear Redis cache
  if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
      echo -e "  • Flushing Redis cache..."
      redis-cli FLUSHALL > /dev/null
      echo -e "    ${GREEN}✓${NC} Redis cache flushed"
    else
      echo -e "    ${YELLOW}⚠${NC} Redis not running, skipping"
    fi
  else
    echo -e "    ${YELLOW}⚠${NC} redis-cli not found, skipping"
  fi

  echo -e "${GREEN}✅ Caches cleared${NC}"
  echo ""
fi

# Restart backend service (always restart on any changes)
if [[ "$PROCESS_CHANGES" == true ]]; then
  echo -e "${YELLOW}🔄 Restarting backend service...${NC}"

  # Check if systemd service exists
  if systemctl list-units --type=service --all | grep -q "mysurflife-backend.service"; then
    sudo systemctl restart mysurflife-backend
    echo -e "${GREEN}✅ Backend service restarted${NC}"

    # Wait for service to start
    sleep 3

    # Check service status
    if systemctl is-active --quiet mysurflife-backend; then
      echo -e "${GREEN}✅ Backend service is running${NC}"
    else
      echo -e "${RED}❌ Warning: Backend service may not have started correctly${NC}"
      echo -e "${YELLOW}   Check logs: sudo journalctl -u mysurflife-backend -n 50${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  Warning: mysurflife-backend.service not found${NC}"
    echo -e "${YELLOW}   You may need to restart the backend manually${NC}"
  fi
  echo ""
fi

# Restart Apache webserver (always restart on any changes)
if [[ "$PROCESS_CHANGES" == true ]]; then
  echo -e "${YELLOW}🌐 Restarting Apache webserver...${NC}"

  # Check if Apache is running
  if systemctl list-units --type=service --all | grep -qE "apache2.service|httpd.service"; then
    # Try apache2 first (Debian/Ubuntu), then httpd (RHEL/CentOS)
    if systemctl list-units --type=service --all | grep -q "apache2.service"; then
      sudo systemctl restart apache2
      echo -e "${GREEN}✅ Apache2 webserver restarted${NC}"
    elif systemctl list-units --type=service --all | grep -q "httpd.service"; then
      sudo systemctl restart httpd
      echo -e "${GREEN}✅ HTTPD webserver restarted${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  Warning: Apache/HTTPD service not found${NC}"
    echo -e "${YELLOW}   You may need to restart the webserver manually${NC}"
  fi
  echo ""
fi

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Release Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Commit: ${AFTER_COMMIT:0:7}${NC}"

if [[ "$INSTALLED_SOMETHING" == true ]]; then
  echo -e "${GREEN}✅ Dependencies updated${NC}"
else
  echo -e "${BLUE}ℹ️  No dependency changes detected${NC}"
fi

if [[ "$NEEDS_FRONTEND_BUILD" == true ]]; then
  echo -e "${GREEN}✅ Frontend built${NC}"
fi

if [[ "$PROCESS_CHANGES" == true ]]; then
  echo -e "${GREEN}✅ Caches cleared (Python bytecode + Redis)${NC}"
  echo -e "${GREEN}✅ Backend restarted${NC}"
  echo -e "${GREEN}✅ Apache restarted${NC}"
fi

echo ""
echo -e "${GREEN}🚀 Release complete!${NC}"
echo ""

# Save released commit for future comparisons
echo "$AFTER_COMMIT" > "$LAST_RELEASE_FILE"
echo -e "${BLUE}📝 Saved release marker: ${AFTER_COMMIT:0:7}${NC}"
echo ""

# Show service status
if systemctl list-units --type=service --all | grep -q "mysurflife-backend.service"; then
  echo -e "${BLUE}Backend status:${NC}"
  systemctl status mysurflife-backend --no-pager -n 0
fi
