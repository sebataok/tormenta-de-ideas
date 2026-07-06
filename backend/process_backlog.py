"""Loop principal que corre en el Mac (cron / launchd).

Cada corrida:
  1. Consulta Supabase por ideas pendientes.
  2. Ordena por priority DESC (más avances marcados primero) y updated_at DESC.
  3. Procesa hasta MAX_PER_RUN ideas.
  4. Envía email de notificación por cada episodio nuevo.

Diseñado para ser idempotente y silencioso si no hay nada que hacer.
"""
from __future__ import annotations

import os
import sys
import traceback

from dotenv import load_dotenv

# Carga .env desde el directorio actual
load_dotenv()

from supabase_client import SupabaseClient           # noqa: E402
from generate_podcast import generate_for_idea       # noqa: E402
from send_email import send_episode_ready            # noqa: E402


MAX_PER_RUN = int(os.environ.get("MAX_PER_RUN", "3"))
PENDING_STATUSES = ("pending_research", "pending_deepdive")


def pending_ideas(sb: SupabaseClient) -> list[dict]:
    """Prioridad: más avances primero, luego más recientes."""
    rows = sb.select("ideas", {
        "select": "*",
        "status": "in.(pending_research,pending_deepdive)",
        "order": "priority.desc,updated_at.desc",
        "limit": str(MAX_PER_RUN),
    })
    return rows


def main() -> int:
    try:
        sb = SupabaseClient.from_env()
    except KeyError as e:
        print(f"[error] falta env var: {e}", file=sys.stderr)
        return 2

    # Ping suave para que Supabase no pause el proyecto
    try:
        sb.select("ideas", {"select": "id", "limit": "1"})
    except Exception as e:
        print(f"[warn] ping falló: {e}", file=sys.stderr)

    ideas = pending_ideas(sb)
    if not ideas:
        print("[ok] backlog vacío.")
        return 0

    print(f"[ok] procesando {len(ideas)} idea(s)")
    for idea in ideas:
        try:
            print(f"  → {idea.get('title', idea['id'])} (priority={idea.get('priority')})")
            ep = generate_for_idea(sb, idea)
            try:
                send_episode_ready(idea, ep)
                print(f"    ✉ email enviado")
            except Exception as e:
                print(f"    [warn] email falló: {e}")
                sb.update("episodes", {"id": ep["id"]}, {"delivery_error": str(e)[:400]})
        except Exception as e:
            print(f"  [error] {idea['id']}: {e}", file=sys.stderr)
            traceback.print_exc()
            sb.update("ideas", {"id": idea["id"]}, {"status": "error", "last_error": str(e)[:400]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
