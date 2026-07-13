#!/usr/bin/env bash
# ------------------------------------------------------------------
# Reconfigura GitHub Pages para que sirva /pwa vía GitHub Actions.
# ------------------------------------------------------------------

set -uo pipefail

PROJECT="/Users/sebastiangonzalez/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas"
REPO="sebataok/tormenta-de-ideas"
cd "$PROJECT"

# colores
if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_HDR=$'\033[1;36m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_HDR=""; C_DIM=""; C_END=""
fi
ok()   { printf "  ${C_OK}✓${C_END} %s\n" "$*"; }
warn() { printf "  ${C_WARN}⚠${C_END} %s\n" "$*"; }
fail() { printf "  ${C_ERR}✗${C_END} %s\n" "$*"; }
hdr()  { printf "\n${C_HDR}== %s ==${C_END}\n" "$*"; }

# --- Precheck ---
if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  fail "gh CLI no disponible o no autenticado."
  echo "     brew install gh && gh auth login"
  exit 1
fi

if [[ ! -f .github/workflows/pages.yml ]]; then
  fail "Falta .github/workflows/pages.yml"
  exit 1
fi

# --- 1. Commit + push del workflow ---
hdr "1. Commit + push del workflow"
git add .github/workflows/pages.yml pwa/ >/dev/null 2>&1 || true
if git diff --cached --quiet; then
  ok "sin cambios para commitear"
else
  git -c user.email="setup@tormenta.local" -c user.name="Tormenta Setup" \
    commit -q -m "add pages deploy workflow"
  ok "commit hecho"
fi
if git push origin main >/dev/null 2>&1; then
  ok "push OK"
else
  warn "push falló (¿ya estaba al día?)"
fi

# --- 2. Cambiar Pages source a workflow ---
hdr "2. Cambiar source de Pages a 'workflow'"
RESP=$(gh api -X PATCH "repos/$REPO/pages" -f "build_type=workflow" 2>&1 || true)
if echo "$RESP" | grep -qi "error\|not found"; then
  # Si no existe, crearlo desde cero con build_type=workflow
  gh api -X POST "repos/$REPO/pages" -f "build_type=workflow" >/dev/null 2>&1 \
    && ok "Pages creado con build_type=workflow" \
    || warn "no pude configurar Pages: $RESP"
else
  ok "Pages ahora usa build_type=workflow"
fi

# --- 3. Disparar el workflow (por si el push no lo hizo automáticamente) ---
hdr "3. Disparando workflow"
if gh workflow run "pages.yml" --repo "$REPO" >/dev/null 2>&1; then
  ok "workflow disparado manualmente"
else
  warn "workflow_dispatch no disponible aún — esperando el push trigger"
fi

# --- 4. Esperar 60s y verificar corrida ---
hdr "4. Esperando 60s a que arranque..."
sleep 60
RUN=$(gh run list --repo "$REPO" --workflow pages.yml --limit 1 --json status,conclusion,url,createdAt 2>/dev/null || echo "")
if [[ -n "$RUN" && "$RUN" != "[]" ]]; then
  status=$(echo "$RUN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('status',''))")
  conclusion=$(echo "$RUN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('conclusion','') or '')")
  url=$(echo "$RUN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('url',''))")
  ok "última corrida: status=$status conclusion=${conclusion:-en_progreso}"
  ok "log: $url"
else
  warn "no encontré corridas todavía (puede tardar 1-2 min más)"
fi

# --- 5. URL de Pages ---
hdr "5. URL de la PWA"
PAGES_URL=$(gh api "repos/$REPO/pages" --jq '.html_url' 2>/dev/null || echo "https://sebataok.github.io/tormenta-de-ideas/")
ok "$PAGES_URL"

echo
printf "${C_OK}📱 En 1-3 min esa URL va a servir la PWA (contenido de /pwa).${C_END}\n"
printf "   Podés seguir el progreso: gh run watch --repo %s\n" "$REPO"
printf "   Cuando cargue, abrila desde el iPhone en Safari → Compartir → Agregar a inicio.\n"
