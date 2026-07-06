#!/usr/bin/env bash
# Inicializa git, crea el repo público en GitHub y activa GitHub Pages sobre /pwa.
#
# Requiere:
#   - gh CLI instalado y autenticado (brew install gh; gh auth login).
#   - Estar corriendo dentro de tormenta-de-ideas/.
#
# Uso:
#   ./bin/setup_github.sh [nombre-repo]      # default 'tormenta-de-ideas'

set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="${1:-tormenta-de-ideas}"

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ Falta 'gh' CLI. Instalá con: brew install gh"
  echo "   Después: gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "→ gh no está autenticado. Corriendo 'gh auth login'..."
  gh auth login
fi

USER=$(gh api user -q .login)
echo "→ Usuario GitHub: $USER"

# --- 1. Preparar config de la PWA con la URL real de Supabase ---
if [[ -f backend/.env ]]; then
  # shellcheck disable=SC1091
  set -a; source backend/.env; set +a
fi

if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_ANON_KEY:-}" ]]; then
  echo "→ Inyectando SUPABASE_URL/ANON en pwa/index.html..."
  python3 - <<PY
import re, pathlib
p = pathlib.Path("pwa/index.html")
s = p.read_text()
s = re.sub(r'SUPABASE_URL:\s*"[^"]*"',  f'SUPABASE_URL:  "${SUPABASE_URL}"', s)
s = re.sub(r'SUPABASE_ANON:\s*"[^"]*"', f'SUPABASE_ANON: "${SUPABASE_ANON_KEY}"', s)
p.write_text(s)
print("  ✓ pwa/index.html actualizado")
PY
else
  echo "⚠ backend/.env sin SUPABASE_URL/ANON — la PWA quedará con placeholders."
fi

# --- 2. Git init + primer commit ---
if [[ ! -d .git ]]; then
  git init -q
  git branch -M main
fi
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "MVP tormenta de ideas"
else
  echo "  (no hay cambios para commitear)"
fi

# --- 3. Crear repo remoto ---
if gh repo view "$USER/$REPO_NAME" >/dev/null 2>&1; then
  echo "→ Repo $USER/$REPO_NAME ya existe. Reutilizando."
  # Asegurar remote
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/$USER/$REPO_NAME.git"
  fi
else
  echo "→ Creando repo público $USER/$REPO_NAME..."
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
fi

# Push por si venía de un repo ya existente
git push -u origin main --force

# --- 4. Activar GitHub Pages sobre branch main, folder /pwa ---
echo "→ Activando GitHub Pages..."
gh api -X POST "repos/$USER/$REPO_NAME/pages" \
  -f "source[branch]=main" \
  -f "source[path]=/pwa" 2>/dev/null || \
gh api -X PUT "repos/$USER/$REPO_NAME/pages" \
  -f "source[branch]=main" \
  -f "source[path]=/pwa"

echo "→ Esperando propagación (~10s)..."
sleep 10
PAGES_URL=$(gh api "repos/$USER/$REPO_NAME/pages" -q .html_url 2>/dev/null || echo "")

if [[ -z "$PAGES_URL" ]]; then
  PAGES_URL="https://$USER.github.io/$REPO_NAME/"
fi

echo
echo "✓ Repo:  https://github.com/$USER/$REPO_NAME"
echo "✓ PWA:   $PAGES_URL"
echo "         (puede tardar 1-3 min en aparecer la primera vez)"
echo
echo "Próximos pasos:"
echo "  1. Verificar que la URL cargue: curl -sI $PAGES_URL"
echo "  2. Desde tu iPhone, abrir $PAGES_URL en Safari."
echo "  3. Compartir → Agregar a inicio."
