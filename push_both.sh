#!/usr/bin/env bash
# ------------------------------------------------------------------
# Pushea:
#   1) Fix de Tormenta (delete + SW v3 + [hidden]!important + z-index PIN)
#   2) Repo NUEVO Ayuda Memoria (crea repo, primer push, activa Pages via workflow)
# ------------------------------------------------------------------
set -uo pipefail

if [[ -t 1 ]]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_HDR=$'\033[1;36m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_HDR=""; C_DIM=""; C_END=""
fi
ok()   { printf "  ${C_OK}✓${C_END} %s\n" "$*"; }
warn() { printf "  ${C_WARN}⚠${C_END} %s\n" "$*"; }
fail() { printf "  ${C_ERR}✗${C_END} %s\n" "$*"; }
hdr()  { printf "\n${C_HDR}== %s ==${C_END}\n" "$*"; }

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  fail "gh CLI no disponible o no autenticado."
  echo "     brew install gh && gh auth login"
  exit 1
fi
GH_USER=$(gh api user -q .login)
ok "gh CLI OK como $GH_USER"

BASE="/Users/sebastiangonzalez/Documents/Claude/Projects/Taok y Seba"

# =====================================================================
# 1) TORMENTA — commit fix + push
# =====================================================================
hdr "1. Fix de Tormenta"
cd "$BASE/tormenta-de-ideas"
git add pwa/ >/dev/null 2>&1 || true
if git diff --cached --quiet; then
  ok "sin cambios para commitear (fix ya aplicado)"
else
  git -c user.email="fix@tormenta.local" -c user.name="Tormenta Fix" \
    commit -q -m "feat: delete idea button + fix pin gate ([hidden]!important, z-index, SW v3)"
  HASH=$(git rev-parse --short HEAD)
  ok "commit $HASH"
fi
git push origin main >/dev/null 2>&1 && ok "push Tormenta OK" || warn "push Tormenta falló"

# =====================================================================
# 2) AYUDA MEMORIA — repo nuevo
# =====================================================================
hdr "2. Repo nuevo: ayuda-memoria"
cd "$BASE/ayuda-memoria"

if [[ ! -d .git ]]; then
  git init -q
  git branch -M main 2>/dev/null || true
fi
git add -A >/dev/null 2>&1
if ! git diff --cached --quiet; then
  git -c user.email="init@ayudamemoria.local" -c user.name="Ayuda Memoria" \
    commit -q -m "init: ayuda memoria PWA — pendientes por voz/texto con delete en batch"
  ok "commit inicial"
fi

if gh repo view "$GH_USER/ayuda-memoria" >/dev/null 2>&1; then
  ok "repo $GH_USER/ayuda-memoria ya existe"
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/$GH_USER/ayuda-memoria.git"
  fi
  git push -u origin main --force >/dev/null 2>&1 && ok "push OK" || warn "push falló"
else
  if gh repo create ayuda-memoria --public --source=. --remote=origin --push >/dev/null 2>&1; then
    ok "repo creado y pusheado"
  else
    warn "gh repo create falló, intentando manual"
    git remote add origin "https://github.com/$GH_USER/ayuda-memoria.git" 2>/dev/null || true
    git push -u origin main --force >/dev/null 2>&1 || warn "push manual falló"
  fi
fi

hdr "3. Activar Pages con workflow"
# Crear Pages con build_type=workflow (o cambiar si ya existe)
if gh api "repos/$GH_USER/ayuda-memoria/pages" >/dev/null 2>&1; then
  gh api -X PATCH "repos/$GH_USER/ayuda-memoria/pages" -f "build_type=workflow" >/dev/null 2>&1 \
    && ok "Pages set to build_type=workflow"
else
  gh api -X POST "repos/$GH_USER/ayuda-memoria/pages" -f "build_type=workflow" >/dev/null 2>&1 \
    && ok "Pages creado con build_type=workflow" \
    || warn "no pude crear Pages por API"
fi
# Disparar workflow por si acaso
gh workflow run "pages.yml" --repo "$GH_USER/ayuda-memoria" >/dev/null 2>&1 && ok "workflow disparado" || true

hdr "4. Esperando 60s a que arranquen los workflows"
sleep 60

hdr "5. Estado final"
printf "\n${C_HDR}Tormenta:${C_END}\n"
gh run list --repo "$GH_USER/tormenta-de-ideas" --workflow pages.yml --limit 2 || true
TORM_URL=$(gh api "repos/$GH_USER/tormenta-de-ideas/pages" --jq '.html_url' 2>/dev/null || echo "https://$GH_USER.github.io/tormenta-de-ideas/")

printf "\n${C_HDR}Ayuda Memoria:${C_END}\n"
gh run list --repo "$GH_USER/ayuda-memoria" --workflow pages.yml --limit 2 || true
MEM_URL=$(gh api "repos/$GH_USER/ayuda-memoria/pages" --jq '.html_url' 2>/dev/null || echo "https://$GH_USER.github.io/ayuda-memoria/")

printf "\n${C_HDR}══════════ URLs ══════════${C_END}\n"
printf "  ⚡ Tormenta:       %s\n" "$TORM_URL"
printf "  ✅ Ayuda Memoria:  %s\n" "$MEM_URL"

printf "\n${C_WARN}⚠ Paso manual restante (1 min):${C_END}\n"
printf "   Aplicá el schema de Ayuda Memoria en el SQL Editor de Supabase:\n"
printf "   1. Abrí https://supabase.com/dashboard/project/aspqpyjgzkcvukxezxgz/sql/new\n"
printf "   2. Pegá el contenido de:\n"
printf "      %s/ayuda-memoria/schema.sql\n" "$BASE"
printf "   3. Run.\n"
printf "\n${C_OK}En el iPhone:${C_END} recargá Tormenta (Ajustes → Safari → Datos de sitios → borrar sebataok)\n"
printf "   y agregá Ayuda Memoria a Inicio como PWA nueva.\n"
