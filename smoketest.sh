#!/bin/bash
# Smoke test LavTr local — fluxo completo de onboarding de uma lavandaria
BASE=http://localhost:8787/api

echo "=== 1. Registrar nova lavandaria (tenant) ==="
REG=$(curl -s -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d '{"business_name":"Lavanderia Teste SP","branch_name":"Loja Centro","name":"Danilo Cabral","email":"danilo@teste.com","password":"Senha123!","code_prefix":"TS"}')
echo "$REG"
ACT_URL=$(echo "$REG" | python3 -c "import sys,json;print(json.load(sys.stdin).get('activation_url',''))" 2>/dev/null)
echo "activation_url: $ACT_URL"

echo "=== 2. Inspecionar token de ativação ==="
TOKEN=$(echo "$REG" | python3 -c "import sys,json;u=json.load(sys.stdin).get('activation_url','');print(u.split('token=')[-1] if 'token=' in u else '')")
echo "token: ${TOKEN:0:10}..."
INSPECT=$(curl -s -X POST "$BASE/auth/activate/inspect" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}")
echo "$INSPECT"

echo "=== 3. Ativar conta ==="
ACT=$(curl -s -X POST "$BASE/auth/activate" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}")
echo "$ACT"

echo "=== 4. Login do tenant ==="
UAT=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"danilo@teste.com","password":"Senha123!"}')
TEN=$(echo "$UAT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('token','ERRO: '+str(d)[:200])[:120])")
echo "tenant token: ${TEN:0:40}..."

echo "=== 5. Ver catálogo de serviços seedado (PT-BR) ==="
curl -s "$BASE/services" -H "Authorization: Bearer $TEN" | python3 -m json.tool 2>/dev/null | head -40

echo "=== 6. Ver clientes/branches/me ==="
curl -s "$BASE/me" -H "Authorization: Bearer $TEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print('tenant:', d.get('tenant',{}).get('name'), '| currency:', d.get('tenant',{}).get('currency'), '| role:', d.get('role',{}).get('name'))"
