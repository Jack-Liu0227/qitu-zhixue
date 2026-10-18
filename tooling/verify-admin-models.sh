#!/usr/bin/env bash
set -e

cat << 'JSON' > /tmp/admin_login.json
{
  "email": "admin@qtzx.local",
  "password": "admin123"
}
JSON

echo "=== 1. Login as Admin ==="
curl -s -i -X POST http://127.0.0.1:4100/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d @/tmp/admin_login.json \
  -c /tmp/admin_cookies.txt > /tmp/admin_login_res.txt
head -n 1 /tmp/admin_login_res.txt
tail -n 1 /tmp/admin_login_res.txt
echo ""

echo "=== 2. Admin Models (/api/v1/admin/models) ==="
curl -s -X GET http://127.0.0.1:4100/api/v1/admin/models \
  -b /tmp/admin_cookies.txt | jq .
echo ""

echo "=== 3. Model Runtime (/api/v1/models/runtime) ==="
curl -s -X GET http://127.0.0.1:4100/api/v1/models/runtime \
  -b /tmp/admin_cookies.txt | jq .
echo ""

echo "=== 4. Settings Registry (/api/v1/admin/settings/registry) ==="
curl -s -X GET http://127.0.0.1:4100/api/v1/admin/settings/registry \
  -b /tmp/admin_cookies.txt | jq '.data | length'
