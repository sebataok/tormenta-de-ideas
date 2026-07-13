#!/usr/bin/env bash
# Commit + push del fix del PIN y el bump del SW, después mira el run del workflow.
set -uo pipefail

PROJECT="/Users/sebastiangonzalez/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas"
REPO="sebataok/tormenta-de-ideas"
cd "$PROJECT"

if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_HDR=$'\033[1;36m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_HDR=""; C_END=""
fi
ok()   { printf "  ${C_OK}✓${C_END} %s\n" "$*"; }
warn() { printf "  ${C_WARN}⚠${C_END} %s\n" "$*"; }
hdr()  { printf "\n${C_HDR}== %s ==${C_END}\n" "$*"; }

hdr "1. Commit + push"
git add pwa/css/app.css pwa/js/app.js pwa/service-worker.js
if git diff --cached --quiet; then
  ok "sin cambios para commitear"
else
  git -c user.email="fix@tormenta.local" -c user.name="Tormenta Fix" \
    commit -q -m "fix: gate pin screen, force [hidden]!important, close idea sheet on init, bump SW v2"
  HASH=$(git rev-parse --short HEAD)
  ok "commit $HASH"
fi
git push origin main >/dev/null 2>&1 && ok "push OK" || warn "push falló"

hdr "2. Esperando arranque del workflow (60s)"
sleep 60

hdr "3. Estado de la última corrida"
gh run list --repo "$REPO" --workflow pages.yml --limit 3 || true

hdr "4. URL de la PWA"
PAGES_URL=$(gh api "repos/$REPO/pages" --jq '.html_url' 2>/dev/null || echo "https://sebataok.github.io/tormenta-de-ideas/")
echo "   $PAGES_URL"
echo
printf "${C_OK}Cuando el run esté en verde, en el iPhone:${C_END}\n"
printf "   1. Cerrá y reabrí la PWA (o Safari → Configuración → Avanzado → Datos de sitios web → tormenta-de-ideas → Eliminar)\n"
printf "   2. Si probaste desde Chrome de Mac: DevTools → Application → Service Workers → Unregister,\n"
printf "      después Cmd+Shift+R para hard refresh.\n"
