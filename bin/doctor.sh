#!/usr/bin/env bash
# Diagnóstico rápido — chequea que todo esté en su lugar y funcionando.
#
# Uso:
#   ./bin/doctor.sh

set -uo pipefail
cd "$(dirname "$0")/.."

ok()    { printf "  ✓ %s\n" "$1"; }
warn()  { printf "  ⚠ %s\n" "$1"; }
fail()  { printf "  ✗ %s\n" "$1"; }

echo "== Estructura =="
for f in pwa/index.html backend/schema.sql backend/process_backlog.py backend/.env launchd/com.tormenta.ideas.plist; do
  if [[ -f $f ]]; then ok "$f"; else fail "$f (falta)"; fi
done

echo
echo "== CLIs =="
for c in python3 pip git gh jq curl; do
  if command -v $c >/dev/null 2>&1; then ok "$(command -v $c)"; else warn "$c no instalado"; fi
done

if [[ -f backend/.env ]]; then
  set -a; source backend/.env; set +a
  echo
  echo "== Variables .env =="
  for v in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_KEY GMAIL_USER GMAIL_APP_PASSWORD NOTIFICATION_EMAIL; do
    if [[ -n "${!v:-}" && "${!v}" != *YOUR* && "${!v}" != *xxxx* ]]; then
      ok "$v seteada"
    else
      fail "$v vacía o placeholder"
    fi
  done
fi

echo
echo "== Supabase =="
if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_ANON_KEY:-}" ]]; then
  for t in ideas advances episodes; do
    code=$(curl -sS -o /dev/null -w "%{http_code}" \
      -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      "$SUPABASE_URL/rest/v1/$t?select=id&limit=1")
    if [[ "$code" == "200" ]]; then ok "tabla $t → 200"; else fail "tabla $t → $code"; fi
  done
  # bucket
  bcode=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "apikey: ${SUPABASE_SERVICE_KEY:-$SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY:-$SUPABASE_ANON_KEY}" \
    "$SUPABASE_URL/storage/v1/bucket/${PODCAST_BUCKET:-podcasts}")
  if [[ "$bcode" == "200" ]]; then ok "bucket ${PODCAST_BUCKET:-podcasts} → 200"; else warn "bucket → $bcode"; fi
fi

echo
echo "== launchd =="
if launchctl list | grep -q com.tormenta.ideas; then
  ok "com.tormenta.ideas está cargado"
else
  warn "com.tormenta.ideas NO está cargado. Corré: launchctl load ~/Library/LaunchAgents/com.tormenta.ideas.plist"
fi

echo
echo "== GitHub Pages =="
if [[ -d .git ]] && git remote get-url origin >/dev/null 2>&1; then
  URL=$(git remote get-url origin)
  ok "remote origin: $URL"
  USER=$(echo "$URL" | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#')
  REPO=$(basename "$URL" .git)
  PAGES="https://$USER.github.io/$REPO/"
  code=$(curl -sS -o /dev/null -w "%{http_code}" -L "$PAGES" || echo "000")
  if [[ "$code" == "200" ]]; then ok "PWA en $PAGES"; else warn "PWA $PAGES → $code (todavía puede estar deployando)"; fi
fi

echo
echo "Diagnóstico completo."
