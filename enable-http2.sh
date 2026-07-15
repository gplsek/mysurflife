#!/bin/bash

###############################################################################
# MySurfLife — enable HTTP/2 on Apache (PHP-free variant)
#
# Why: Apache runs mpm_prefork (dragged in by mod_php), and mod_http2 silently
# refuses to negotiate h2 under prefork — so every browser is capped at 6
# parallel connections, which throttles map tile bursts (~20 tiles/frame).
#
# This host no longer serves PHP, so the path is simple:
#   1. Disable mod_php (removes the prefork requirement)
#   2. Switch MPM prefork → event
#   3. Enable the h2 protocol globally
#   4. Config-test BEFORE touching the running service; restart; verify
#
# Run:        sudo bash enable-http2.sh
# Roll back:  sudo bash enable-http2.sh --rollback   (restores prefork+mod_php)
###############################################################################

set -eu

PHP_MOD="php8.3"
BACKUP_DIR="/root/apache-http2-backup"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Run with sudo: sudo bash enable-http2.sh${NC}"; exit 1
fi

if [ "${1:-}" = "--rollback" ]; then
    echo "⏪ Rolling back to mod_php + prefork..."
    a2dismod mpm_event >/dev/null 2>&1 || true
    a2enmod mpm_prefork >/dev/null
    a2enmod "$PHP_MOD" >/dev/null
    rm -f /etc/apache2/conf-enabled/http2-protocol.conf /etc/apache2/conf-available/http2-protocol.conf
    apachectl configtest
    systemctl restart apache2
    echo -e "${GREEN}✅ Rolled back. Apache is on prefork + mod_php again.${NC}"
    exit 0
fi

echo "🔍 Preflight"
echo "------------"
MODS=$(apachectl -M 2>/dev/null)
if ! echo "$MODS" | grep -q mpm_prefork_module; then
    echo -e "${YELLOW}prefork not active — maybe already switched? Nothing to do.${NC}"
    exit 0
fi

mkdir -p "$BACKUP_DIR"
cp -r /etc/apache2/mods-enabled "$BACKUP_DIR/mods-enabled.$(date +%s)" 2>/dev/null || true
echo "Backed up mods-enabled to $BACKUP_DIR"

echo ""
echo "🐘 Step 1: disable mod_php (this host no longer serves PHP)"
echo "-----------------------------------------------------------"
if [ -e "/etc/apache2/mods-enabled/${PHP_MOD}.load" ]; then
    a2dismod "$PHP_MOD" >/dev/null
    echo -e "${GREEN}✅ mod_php disabled${NC}"
else
    echo "mod_php already disabled"
fi

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
if ! systemctl is-active --quiet apache2; then
    echo -e "${RED}❌ Apache failed to start! Run: sudo bash enable-http2.sh --rollback${NC}"
    exit 1
fi

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
echo "Full rollback anytime:  sudo bash enable-http2.sh --rollback"
