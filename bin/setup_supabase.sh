#!/usr/bin/env bash
# Crea el bucket público 'podcasts' y verifica que las tablas del schema
# hayan sido creadas correctamente en tu proyecto Supabase.
#
# El schema.sql lo aplicás vos manualmente en el SQL Editor (es un solo
# copy-paste; el endpoint programático de queries no es público).
#
# Uso:
#   ./bin/setup_supabase.sh

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f backend/.env ]]; then
  echo "⚠  Falta backend/.env."
  exit 1
fi

# shellcheck disable=SC1091
set -a; source backend/.env; set +a

: "${SUPABASE_URL:?falta SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?falta SUPABASE_SERVICE_KEY}"
: "${SUPABASE_ANON_KEY:?falta SUPABASE_ANON_KEY}"
: "${PODCAST_BUCKET:=podcasts}"

BASE="${SUPABASE_URL%/}"
SVC="$SUPABASE_SERVICE_KEY"

echo "→ Verificando conexión a $BASE ..."
CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" \
  "$BASE/rest/v1/")
if [[ "$CODE" != "200" && "$CODE" != "404" ]]; then
  echo "❌ No pude conectarme ($CODE). Revisá SUPABASE_URL y SUPABASE_SERVICE_KEY."
  exit 2
fi
echo "  ✓ conectividad OK"

echo "→ Verificando tablas del schema..."
MISSING=0
for t in ideas advances episodes; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "apikey: $SVC" -H "Authorization: Bearer $SVC" \
    "$BASE/rest/v1/$t?select=id&limit=1")
  if [[ "$code" == "200" ]]; then
    echo "  ✓ tabla $t"
  else
    echo "  ✗ tabla $t → $code (aplicá backend/schema.sql en el SQL Editor)"
    MISSING=1
  fi
done
if (( MISSING )); then
  echo
  echo "⚠  Aplicá el schema primero:"
  echo "   1. Abrí ${BASE/https:\/\//https://supabase.com/dashboard/project/}/sql/new"
  echo "   2. Pegá TODO el contenido de backend/schema.sql y presioná Run."
  echo "   3. Volvé a correr este script."
  exit 3
fi

echo "→ Creando bucket público '$PODCAST_BUCKET'..."
RESP=$(curl -sS -X POST \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" \
  -H "Content-Type: application/json" \
  --data "{\"id\":\"$PODCAST_BUCKET\",\"name\":\"$PODCAST_BUCKET\",\"public\":true,\"file_size_limit\":52428800}" \
  "$BASE/storage/v1/bucket")
if echo "$RESP" | grep -q '"name"'; then
  echo "  ✓ bucket creado"
elif echo "$RESP" | grep -qi "already exists"; then
  echo "  ✓ bucket ya existía"
  # Asegurar que sea público
  curl -sS -X PUT \
    -H "apikey: $SVC" -H "Authorization: Bearer $SVC" \
    -H "Content-Type: application/json" \
    --data "{\"public\":true}" \
    "$BASE/storage/v1/bucket/$PODCAST_BUCKET" >/dev/null
  echo "  ✓ marcado como público"
else
  echo "  ⚠ respuesta inesperada: $RESP"
fi

echo
echo "✓ Supabase configurado."
echo
echo "Próximos pasos:"
echo "  · Bloque 3: Gmail App Password → luego completar GMAIL_* en .env"
echo "  · Bloque 4: ./bin/setup_github.sh"
