#!/usr/bin/env bash
# Configura el venv, instala dependencias, genera sample_catalina.mp3 y
# carga el launchd agent.
#
# Uso:
#   ./bin/setup_backend.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# --- 1. venv + deps ---
if [[ ! -d backend/.venv ]]; then
  echo "→ Creando venv..."
  python3 -m venv backend/.venv
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate
echo "→ Instalando dependencias..."
pip install -q --upgrade pip
pip install -q -r backend/requirements.txt

# --- 2. Test de TTS: generar sample_catalina.mp3 ---
if [[ ! -f sample_catalina.mp3 ]]; then
  echo "→ Generando sample_catalina.mp3 con Edge TTS..."
  (cd backend && python generate_sample.py) && mv backend/sample_catalina.mp3 . || \
    echo "  ⚠ Falló Edge TTS. Chequeá conectividad (a veces MS cambia el endpoint)."
fi

# --- 3. Test de Gmail SMTP ---
if [[ -f backend/.env ]]; then
  set -a; source backend/.env; set +a
  if [[ -n "${GMAIL_APP_PASSWORD:-}" ]]; then
    echo "→ Probando envío por Gmail SMTP..."
    (cd backend && python send_email.py) || \
      echo "  ⚠ Falló el envío. Revisá GMAIL_APP_PASSWORD (16 chars, sin espacios)."
  fi
fi

# --- 4. Instalar launchd agent ---
AGENT_DEST="$HOME/Library/LaunchAgents/com.tormenta.ideas.plist"
if [[ ! -f "$AGENT_DEST" ]]; then
  echo "→ Instalando launchd agent en $AGENT_DEST ..."
  cp launchd/com.tormenta.ideas.plist "$AGENT_DEST"
  launchctl unload "$AGENT_DEST" 2>/dev/null || true
  launchctl load "$AGENT_DEST"
  echo "  ✓ Agent cargado. Va a correr cada 15 min y al arranque."
else
  echo "→ launchd agent ya instalado. Recargando..."
  launchctl unload "$AGENT_DEST" 2>/dev/null || true
  launchctl load "$AGENT_DEST"
fi

echo
echo "✓ Backend listo. Ver logs en tiempo real:"
echo "   tail -f ~/Library/Logs/tormenta.log"
echo
echo "Correr una vuelta manual del backlog:"
echo "   cd backend && ./.venv/bin/python process_backlog.py"
