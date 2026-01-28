#!/bin/bash
# Debug script to check production build status

echo "🔍 MySurfLife Production Debug"
echo "================================"
echo ""

echo "1. Git Status:"
cd /var/www/mysurflife
git log --oneline -2
echo ""

echo "2. Check App.js source has new code:"
grep -c "Live Buoys" frontend/src/App.js
echo "(Should be 1 or more)"
echo ""

echo "3. Check if build folder exists:"
ls -ld frontend/build/
echo ""

echo "4. Check build timestamp:"
stat -c '%y' frontend/build/index.html 2>/dev/null || stat -f '%Sm' frontend/build/index.html
echo ""

echo "5. Check if build has new React bundle:"
ls -lh frontend/build/static/js/main.*.js | head -1
echo ""

echo "6. Search build for 'Live Buoys' (should find it):"
grep -o "Live Buoys" frontend/build/static/js/main.*.js | head -1
echo ""

echo "7. Apache DocumentRoot:"
sudo grep -r "DocumentRoot\|Directory.*mysurflife" /etc/apache2/sites-enabled/ | grep -v "#"
echo ""

echo "8. Apache is serving from:"
curl -sI https://mysurflife.com | grep -E "Server|Content-Type"
echo ""

echo "9. Check what index.html is actually served:"
curl -s https://mysurflife.com | grep -o "<title>.*</title>"
echo ""

echo "10. Frontend build exit code from last build:"
cd frontend
npm run build 2>&1 | tail -20