#!/bin/bash

###############################################################################
# MySurfLife — enable HTTP/2 on Apache
#
# Why: Apache runs mpm_prefork (required by mod_php), and mod_http2 silently
# refuses to negotiate h2 under prefork — so every browser is capped at 6
# parallel connections, which throttles map tile bursts (~20 tiles/frame).
#
# What this does (Ubuntu 24.04, Apache 2.4, PHP 8.3):
#   1. Switch PHP handling from mod_php to php-fpm (already installed)
#   2. Switch MPM from prefork to event
#   3. Enable the h2 protocol globally
#   4. Config-test BEFORE touching the running service; restart; verify
#
# Run:  sudo bash enable-http2.sh
# Roll back:  sudo bash enable-http2.sh --rollback
###############################################################################

set -euo pipefail

PHP_VER="8.3"
BACKUP_DIR="/root/apache-http2-backup"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Run with sudo: sudo bash enable-http2.sh${NC}"; exit 1
fi

if [ "${1:-}" = "--rollback" ]; then
    echo "⏪ Rolling back to mod_php + prefork..."
    a2dismod http2 >/dev/null || true
    a2dismod mpm_event >/dev/null || true
    a2enmod mpm_prefork >/dev/null
    a2enmod "php${PHP_VER}" >/dev/null
    a2disconf "php${PHP_VER}-fpm" >/dev/null || true
    rm -f /etc/apache2/conf-enabled/http2-protocol.conf /etc/apache2/conf-available/http2-protocol.conf
    apachectl configtest
    systemctl restart apache2
    echo -e "${GREEN}✅ Rolled back. Apache is on prefork + mod_php again.${NC}"
    exit 0
fi

echo "🔍 Preflight"
echo "------------"
apachectl -M | grep -q mpm_prefork_module || { echo -e "${YELLOW}prefork not active — maybe already switched? Nothing to do.${NC}"; exit 0; }
systemctl list-unit-files | grep -q "php${PHP_VER}-fpm" || { echo -e "${RED}php${PHP_VER}-fpm not installed — apt install php${PHP_VER}-fpm first${NC}"; exit 1; }

mkdir -p "$BACKUP_DIR"
cp -r /etc/apache2/mods-enabled "$BACKUP_DIR/mods-enabled.$(date +%s)" 2>/dev/null || true
echo "Backed up mods-enabled to $BACKUP_DIR"

echo ""
echo "🐘 Step 1: mod_php → php-fpm"
echo "----------------------------"
systemctl enable --now "php${PHP_VER}-fpm"
a2enmod proxy_fcgi setenvif >/dev/null
a2enconf "php${PHP_VER}-fpm" >/dev/null
a2dismod "php${PHP_VER}" >/dev/null
echo -e "${GREEN}✅ PHP now handled by php${PHP_VER}-fpm via proxy_fcgi${NC}"

echo ""
echo "⚙️  Step 2: mpm_prefork → mpm_event"
echo "-----------------------------------"
a2dismod mpm_prefork >/dev/null
a2enmod mpm_event >/dev/null
echo -e "${GREEN}✅ MPM switched to event${NC}"

echo ""
echo "🚀 Step 3: enable h2"
echo "--------------------"
a2enmod http2 >/dev/null
cat > /etc/apache2/conf-available/http2-protocol.conf <<'EOF'
# Prefer HTTP/2 on TLS connections (mod_http2 requires a threaded MPM)
Protocols h2 http/1.1
EOF
a2enconf http2-protocol >/dev/null
echo -e "${GREEN}✅ Protocols h2 http/1.1 configured globally${NC}"

echo ""
echo "🧪 Step 4: config test + restart"
echo "--------------------------------"
if ! apachectl configtest; then
    echo -e "${RED}❌ configtest FAILED — Apache was NOT restarted (still serving on old config).${NC}"
    echo -e "${RED}   Inspect the error above, or run: sudo bash enable-http2.sh --rollback${NC}"
    exit 1
fi
systemctl restart apache2
sleep 2
systemctl is-active --quiet apache2 || { echo -e "${RED}❌ Apache failed to start! Run: sudo bash enable-http2.sh --rollback${NC}"; exit 1; }

echo ""
echo "🔎 Step 5: verify"
echo "-----------------"
NEGOTIATED=$(curl -sI --http2 -o /dev/null -w "%{http_version}" https://mysurflife.com/ || echo "fail")
if [ "$NEGOTIATED" = "2" ]; then
    echo -e "${GREEN}🎉 HTTP/2 is live (negotiated http_version=2)${NC}"
else
    echo -e "${YELLOW}⚠️  Negotiated http_version=$NEGOTIATED (expected 2).${NC}"
    echo "   Apache is running; check that the TLS vhost doesn't override Protocols."
fi
echo ""
echo "If any PHP page on this host misbehaves, verify php-fpm:"
echo "  systemctl status php${PHP_VER}-fpm"
echo "Full rollback anytime:  sudo bash enable-http2.sh --rollback"
