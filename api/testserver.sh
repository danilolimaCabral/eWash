#!/bin/bash
# Teste replicando produção: inicia server.js e testa as rotas públicas via curl
cd /home/ubuntu/eWash/api
rm -f /tmp/leva2.db
export DATABASE_URL=file:/tmp/leva2.db
export JWT_SECRET=test-secret-for-local-123456
export NODE_ENV=test
export PLATFORM_ADMIN_EMAIL=admin@test.com
export PLATFORM_ADMIN_PASSWORD=admin123456
PORT=3499 node src/server.js > /tmp/servertest.log 2>&1 &
PID=$!
sleep 6
echo "--- health ---"
curl -s http://localhost:3499/api/health
echo
echo "--- POST public request ---"
curl -s -X POST "http://localhost:3499/api/public/requests?tenant=LV" \
  -H "Content-Type: application/json" \
  -d '{"name":"Maria Teste","phone":"(11) 98888-7777","address":"Rua A, 100 - Vila B","items":"Lavagem por quilo 5kg + 1 edredom queen"}'
echo
echo "--- tenant desconhecido ---"
curl -s -X POST "http://localhost:3499/api/public/requests?tenant=ZZ" \
  -H "Content-Type: application/json" \
  -d '{"name":"X","phone":"11988887777","address":"Rua B 200","items":"Lavagem"}'
echo
kill $PID 2>/dev/null
wait $PID 2>/dev/null
