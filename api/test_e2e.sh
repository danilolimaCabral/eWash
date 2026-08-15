#!/bin/bash
# Teste E2E Leva e Traz contra servidor local
rm -f /tmp/leva3.db
PORT=3498 DATABASE_URL=file:/tmp/leva3.db JWT_SECRET=test-secret-for-local-123456 \
NODE_ENV=test PLATFORM_ADMIN_EMAIL=admin@test.com PLATFORM_ADMIN_PASSWORD=admin123456 \
node /home/ubuntu/eWash/api/src/server.js >/tmp/s3.log 2>&1 &
PID=$!
sleep 6
BASE=http://localhost:3498
echo "--- 1. criar pedido ---"
CREATE=$(curl -s -X POST "$BASE/api/public/requests?tenant=LV" -H "Content-Type: application/json" \
  -d '{"name":"Maria Teste","phone":"(11) 98888-7777","address":"Rua A, 100 - Vila B","items":"Lavagem por quilo 5kg + 1 edredom queen"}')
echo "$CREATE"
CODE=$(echo "$CREATE" | python3 -c "import sys,json;print(json.load(sys.stdin)['request']['access_code'])")
echo "CODE=$CODE"
echo "--- 2. rastreio ---"
curl -s "$BASE/api/public/r/$CODE?tenant=LV"
echo
echo "--- 3. login admin (tenant) ---"
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"demo@lavatr.app","password":"Demo123456"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
echo "TOKEN=${TOKEN:0:20}..."
echo "--- 4. listar admin ---"
curl -s "$BASE/api/levae-traz" -H "Authorization: Bearer $TOKEN" | head -c 300
echo
echo "--- 5. patch accepted ---"
REQ_ID=$(curl -s "$BASE/api/levae-traz" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['requests'][0]['id'])")
curl -s -X PATCH "$BASE/api/levae-traz/$REQ_ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"status":"accepted"}'
echo
echo "--- 6. rastreio final ---"
curl -s "$BASE/api/public/r/$CODE?tenant=LV"
echo
kill $PID 2>/dev/null; wait $PID 2>/dev/null
