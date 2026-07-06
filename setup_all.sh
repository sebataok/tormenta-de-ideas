#!/usr/bin/env bash
# ------------------------------------------------------------------
# Tormenta de Ideas — setup end-to-end.
# Idempotente: podés correrlo varias veces sin romper nada.
#
# Uso:
#   bash "/Users/sebastiangonzalez/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas/setup_all.sh"
# ------------------------------------------------------------------

set -uo pipefail
IFS=$'\n\t'

# --- colores ---
if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_HDR=$'\033[1;36m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_HDR=""; C_DIM=""; C_END=""
fi
ok()   { printf "  ${C_OK}✓${C_END} %s\n" "$*"; }
warn() { printf "  ${C_WARN}⚠${C_END} %s\n" "$*"; }
fail() { printf "  ${C_ERR}✗${C_END} %s\n" "$*"; }
hdr()  { printf "\n${C_HDR}== %s ==${C_END}\n" "$*"; }
dim()  { printf "  ${C_DIM}%s${C_END}\n" "$*"; }

# --- Cambiar al directorio del proyecto ---
PROJECT="/Users/sebastiangonzalez/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas"
if [[ ! -d "$PROJECT" ]]; then
  fail "No encuentro el proyecto en $PROJECT"
  exit 1
fi
cd "$PROJECT"

# --- Cargar .env ---
if [[ ! -f backend/.env ]]; then
  fail "Falta backend/.env. Copiá backend/.env.example y completá los valores."
  exit 1
fi
set -a
# shellcheck disable=SC1091
source backend/.env
set +a

: "${SUPABASE_URL:?falta SUPABASE_URL en backend/.env}"
: "${SUPABASE_SERVICE_KEY:?falta SUPABASE_SERVICE_KEY en backend/.env}"
: "${SUPABASE_ANON_KEY:?falta SUPABASE_ANON_KEY en backend/.env}"
: "${PODCAST_BUCKET:=podcasts}"

BASE="${SUPABASE_URL%/}"
PROJECT_REF=$(echo "$BASE" | sed -E 's#https://([^.]+)\..*#\1#')

# Marcadores para el resumen final
S_TABLES="pending"; S_BUCKET="pending"; S_DEPS="pending"; S_TTS="pending"; S_MAIL="pending"
S_GITREPO="pending"; S_GHPAGES="pending"; S_LAUNCHD="pending"
REPO_URL=""; PAGES_URL=""

# ------------------------------------------------------------------
# 1) Verificar tablas
# ------------------------------------------------------------------
hdr "1. Verificando tablas de Supabase"
MISS=0
for t in ideas advances episodes; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    "$BASE/rest/v1/$t?select=id&limit=1")
  if [[ "$code" == "200" ]]; then ok "tabla $t"; else fail "tabla $t → HTTP $code"; MISS=1; fi
done
if (( MISS )); then
  S_TABLES="miss"
  warn "Faltan tablas. Aplicá backend/schema.sql en:"
  echo "        https://supabase.com/dashboard/project/$PROJECT_REF/sql/new"
else
  S_TABLES="ok"
fi

# ------------------------------------------------------------------
# 2) Bucket público 'podcasts'
# ------------------------------------------------------------------
hdr "2. Bucket público '$PODCAST_BUCKET'"
BODY='{"id":"'"$PODCAST_BUCKET"'","name":"'"$PODCAST_BUCKET"'","public":true,"file_size_limit":52428800,"allowed_mime_types":["audio/mpeg","audio/mp3"]}'
RESP=$(curl -sS -X POST \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" --data "$BODY" \
  "$BASE/storage/v1/bucket")
if echo "$RESP" | grep -q '"name"'; then
  ok "bucket creado"; S_BUCKET="ok"
elif echo "$RESP" | grep -qiE "already exists|duplicate"; then
  ok "bucket ya existía; forzando public=true"
  curl -sS -X PUT \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    --data '{"public":true,"file_size_limit":52428800,"allowed_mime_types":["audio/mpeg","audio/mp3"]}' \
    "$BASE/storage/v1/bucket/$PODCAST_BUCKET" >/dev/null
  S_BUCKET="ok"
else
  fail "respuesta inesperada: $RESP"
  S_BUCKET="err"
fi

# ------------------------------------------------------------------
# 3) Dependencias Python en venv
# ------------------------------------------------------------------
hdr "3. Dependencias Python"
if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv || { fail "no pude crear venv"; S_DEPS="err"; }
fi
if [[ -d backend/.venv ]]; then
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
  pip install -q --upgrade pip >/dev/null 2>&1
  if pip install -q -r backend/requirements.txt; then
    ok "requirements instalados (edge-tts, requests, python-dotenv)"
    S_DEPS="ok"
  else
    fail "falló pip install -r requirements.txt"
    S_DEPS="err"
  fi
  deactivate 2>/dev/null || true
fi

# ------------------------------------------------------------------
# 4) Prueba real de TTS con Catalina
# ------------------------------------------------------------------
hdr "4. Prueba de Edge TTS (voz Catalina)"
if [[ -d backend/.venv ]]; then
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
  if (cd backend && python generate_sample.py) >/dev/null 2>&1; then
    if [[ -f backend/sample_catalina.mp3 ]]; then
      mv -f backend/sample_catalina.mp3 sample_catalina.mp3
    fi
    if [[ -f sample_catalina.mp3 ]]; then
      sz=$(stat -f%z sample_catalina.mp3 2>/dev/null || stat -c%s sample_catalina.mp3)
      ok "sample_catalina.mp3 generado ($sz bytes)"
      S_TTS="ok"
    else
      warn "generate_sample.py no produjo el mp3 esperado"
      S_TTS="err"
    fi
  else
    warn "Edge TTS falló (endpoint de Microsoft puede estar bloqueado ahora)."
    S_TTS="err"
  fi
  deactivate 2>/dev/null || true
fi

# ------------------------------------------------------------------
# 5) Prueba de Gmail SMTP (opcional, envía un correo de test)
# ------------------------------------------------------------------
hdr "5. Prueba de Gmail SMTP (envía 1 correo de test)"
if [[ -n "${GMAIL_USER:-}" && -n "${GMAIL_APP_PASSWORD:-}" ]]; then
  # shellcheck disable=SC1091
  source backend/.venv/bin/activate
  if (cd backend && python -c "
from send_email import send_episode_ready
send_episode_ready(
    {'text':'Prueba de setup end-to-end.'},
    {'title':'Setup completado ✅','summary':'Este es un correo de prueba enviado por setup_all.sh.','number':0,'audio_url':'https://example.com/test'}
)
"); then
    ok "correo de prueba enviado a $NOTIFICATION_EMAIL"
    S_MAIL="ok"
  else
    warn "SMTP falló. Verificá GMAIL_APP_PASSWORD (16 chars sin espacios) y que 2FA esté activa."
    S_MAIL="err"
  fi
  deactivate 2>/dev/null || true
else
  warn "GMAIL_USER/GMAIL_APP_PASSWORD vacíos"
  S_MAIL="skip"
fi

# ------------------------------------------------------------------
# 6) Inyectar SUPABASE_URL/ANON en pwa/index.html
# ------------------------------------------------------------------
hdr "6. Inyectando config Supabase en pwa/index.html"
python3 - <<PY || warn "no pude reemplazar en pwa/index.html"
import re, pathlib, os
p = pathlib.Path("pwa/index.html")
s = p.read_text()
s = re.sub(r'SUPABASE_URL:\s*"[^"]*"',
           'SUPABASE_URL:  "' + os.environ["SUPABASE_URL"] + '"', s)
s = re.sub(r'SUPABASE_ANON:\s*"[^"]*"',
           'SUPABASE_ANON: "' + os.environ["SUPABASE_ANON_KEY"] + '"', s)
p.write_text(s)
print("  ok pwa/index.html")
PY
ok "pwa/index.html apunta a $BASE"

# ------------------------------------------------------------------
# 7) Repo + GitHub Pages
# ------------------------------------------------------------------
hdr "7. Repo GitHub + Pages"
GH_OK=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_OK=1
  GH_USER=$(gh api user -q .login)
  ok "gh CLI autenticado como $GH_USER"
else
  warn "gh CLI no disponible o no autenticado."
  dim  "Instalar: brew install gh && gh auth login"
  dim  "Después volvé a correr este script y hará el push + Pages automáticamente."
fi

# Git init + commit siempre (aunque no haya gh)
if [[ ! -d .git ]]; then
  git init -q
  git branch -M main 2>/dev/null || true
fi
git add -A >/dev/null 2>&1
if ! git diff --cached --quiet; then
  git -c user.email="setup@tormenta.local" -c user.name="Tormenta Setup" \
    commit -q -m "setup: MVP tormenta de ideas" || true
fi

if (( GH_OK )); then
  if gh repo view "$GH_USER/tormenta-de-ideas" >/dev/null 2>&1; then
    ok "repo $GH_USER/tormenta-de-ideas ya existe"
    if ! git remote get-url origin >/dev/null 2>&1; then
      git remote add origin "https://github.com/$GH_USER/tormenta-de-ideas.git"
    fi
    git push -u origin main --force >/dev/null 2>&1 && ok "push OK" || warn "push falló"
  else
    if gh repo create tormenta-de-ideas --public --source=. --remote=origin --push >/dev/null 2>&1; then
      ok "repo creado y pusheado"
    else
      warn "gh repo create falló; intentando push manual"
      git remote add origin "https://github.com/$GH_USER/tormenta-de-ideas.git" 2>/dev/null || true
      git push -u origin main --force >/dev/null 2>&1 || warn "push manual también falló"
    fi
  fi
  REPO_URL="https://github.com/$GH_USER/tormenta-de-ideas"
  S_GITREPO="ok"

  # Activar Pages
  if gh api "repos/$GH_USER/tormenta-de-ideas/pages" >/dev/null 2>&1; then
    ok "Pages ya activo"
  else
    if gh api -X POST "repos/$GH_USER/tormenta-de-ideas/pages" \
         -f "source[branch]=main" -f "source[path]=/pwa" >/dev/null 2>&1; then
      ok "Pages activado sobre main:/pwa"
    else
      warn "no pude activar Pages por API; activalo manual en Settings → Pages"
    fi
  fi
  PAGES_URL=$(gh api "repos/$GH_USER/tormenta-de-ideas/pages" --jq .html_url 2>/dev/null || echo "")
  [[ -z "$PAGES_URL" ]] && PAGES_URL="https://$GH_USER.github.io/tormenta-de-ideas/"
  ok "Pages URL: $PAGES_URL"
  S_GHPAGES="ok"
else
  S_GITREPO="skip"
  S_GHPAGES="skip"
  dim "Manual: crear repo en https://github.com/new (public, nombre tormenta-de-ideas),"
  dim "luego: git remote add origin https://github.com/<TU>/tormenta-de-ideas.git && git push -u origin main"
  dim "y activar Pages en Settings → Pages → Deploy from branch → main → /pwa"
fi

# ------------------------------------------------------------------
# 8) launchd
# ------------------------------------------------------------------
hdr "8. launchd (procesa el backlog cada 15 min)"
AGENT_SRC="launchd/com.tormenta.ideas.plist"
AGENT_DST="$HOME/Library/LaunchAgents/com.tormenta.ideas.plist"
if [[ -f "$AGENT_SRC" ]]; then
  cp -f "$AGENT_SRC" "$AGENT_DST"
  launchctl unload "$AGENT_DST" 2>/dev/null || true
  if launchctl load "$AGENT_DST" 2>&1 | grep -qv "error"; then
    ok "agent cargado ($AGENT_DST)"
    S_LAUNCHD="ok"
  else
    warn "launchctl load reportó error; probá: launchctl bootstrap gui/$(id -u) $AGENT_DST"
    S_LAUNCHD="err"
  fi
else
  fail "no encuentro $AGENT_SRC"
  S_LAUNCHD="err"
fi

# ------------------------------------------------------------------
# RESUMEN
# ------------------------------------------------------------------
printf "\n${C_HDR}══════════════════ RESUMEN ══════════════════${C_END}\n"
row() {
  case "$2" in
    ok)   printf "  ${C_OK}✓${C_END} %-24s ${C_DIM}%s${C_END}\n" "$1" "${3:-}";;
    err)  printf "  ${C_ERR}✗${C_END} %-24s ${C_DIM}%s${C_END}\n" "$1" "${3:-}";;
    skip) printf "  ${C_WARN}·${C_END} %-24s ${C_DIM}%s${C_END}\n" "$1" "${3:-skip}";;
    miss) printf "  ${C_ERR}✗${C_END} %-24s ${C_DIM}%s${C_END}\n" "$1" "faltan tablas";;
    *)    printf "  ${C_WARN}?${C_END} %-24s ${C_DIM}%s${C_END}\n" "$1" "${3:-}";;
  esac
}
row "Tablas Supabase"      "$S_TABLES"
row "Bucket $PODCAST_BUCKET" "$S_BUCKET"
row "Dependencias Python"  "$S_DEPS"
row "Edge TTS (Catalina)"  "$S_TTS"
row "Gmail SMTP"           "$S_MAIL"
row "Repo GitHub"          "$S_GITREPO" "$REPO_URL"
row "GitHub Pages"         "$S_GHPAGES" "$PAGES_URL"
row "launchd"              "$S_LAUNCHD"

echo
if [[ -n "$PAGES_URL" ]]; then
  printf "${C_OK}📱 Próximo paso:${C_END} abrí desde el iPhone en Safari:\n"
  printf "     %s\n" "$PAGES_URL"
  printf "   Compartir → Agregar a inicio. Al abrirla te pide PIN de 4 dígitos (elegilo tú).\n"
  printf "   Grabá una idea y en <15 min te llega el podcast por email.\n"
fi
if [[ "$S_TABLES" == "miss" ]]; then
  printf "\n${C_WARN}⚠  Antes de todo aplicá el schema en el SQL Editor y volvé a correr este script.${C_END}\n"
fi
echo
echo "Logs del backend en tiempo real:"
echo "   tail -f ~/Library/Logs/tormenta.log"
