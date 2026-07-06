"""Envía la notificación por email cuando un episodio queda listo.

Usa Gmail SMTP con App Password (2-Step Verification requerido en la cuenta).

Variables de entorno:
  GMAIL_USER            (email de la cuenta que envía, típicamente sagonzar@gmail.com)
  GMAIL_APP_PASSWORD    (App Password de 16 caracteres, SIN espacios)
  NOTIFICATION_EMAIL    (email destino; suele ser el mismo del GMAIL_USER)
  SMTP_HOST             (default smtp.gmail.com)
  SMTP_PORT             (default 587)
"""
from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Optional


HTML_TEMPLATE = """\
<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px; }}
  .card {{ max-width:520px; margin:0 auto; background:#fff; border-radius:16px; box-shadow:0 8px 24px rgba(15,23,42,.06); overflow:hidden; }}
  .hero {{ background:linear-gradient(135deg,#f59e0b,#fbbf24); color:#0f172a; padding:24px; }}
  .hero h1 {{ margin:0; font-size:20px; }}
  .hero p {{ margin:6px 0 0; font-size:14px; }}
  .body {{ padding:22px 24px; line-height:1.5; }}
  .btn {{ display:inline-block; background:#0f172a; color:#fff !important; padding:12px 20px; border-radius:12px; text-decoration:none; font-weight:600; margin:14px 0; }}
  .meta {{ color:#64748b; font-size:12px; margin-top:16px; }}
  h2 {{ font-size:16px; margin:0 0 8px; }}
  .summary {{ color:#334155; }}
</style></head>
<body>
  <div class="card">
    <div class="hero">
      <h1>⚡ Tormenta de Ideas</h1>
      <p>Nuevo episodio listo</p>
    </div>
    <div class="body">
      <h2>{title}</h2>
      <p class="summary">{summary}</p>
      <p><a class="btn" href="{audio_url}">🎧 Escuchar episodio {number}</a></p>
      <p class="meta">Idea original:<br><em>{idea_text}</em></p>
      <p class="meta">Enviado automáticamente por tu asistente. Si algo suena raro, respondé este correo y lo ajusto.</p>
    </div>
  </div>
</body></html>
"""


def send_episode_ready(
    idea: dict,
    episode: dict,
    *,
    gmail_user: Optional[str] = None,
    gmail_app_password: Optional[str] = None,
    notification_email: Optional[str] = None,
) -> None:
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = gmail_user or os.environ["GMAIL_USER"]
    pw   = gmail_app_password or os.environ["GMAIL_APP_PASSWORD"]
    to   = notification_email or os.environ.get("NOTIFICATION_EMAIL", user)

    title   = episode.get("title") or "Nuevo episodio"
    summary = episode.get("summary") or ""
    number  = episode.get("number") or 1
    url     = episode.get("audio_url") or ""
    text    = idea.get("text") or ""

    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = to
    msg["Subject"] = f"🎧 Episodio {number} listo — {title}"

    plain = (
        f"Tu nuevo episodio de Tormenta de Ideas está listo.\n\n"
        f"Título: {title}\n"
        f"Episodio: {number}\n\n"
        f"{summary}\n\n"
        f"Escuchá acá: {url}\n\n"
        f"Idea original:\n{text}\n"
    )
    html = HTML_TEMPLATE.format(
        title=title, summary=summary, audio_url=url, number=number, idea_text=text
    )
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")

    with smtplib.SMTP(host, port) as s:
        s.starttls()
        s.login(user, pw)
        s.send_message(msg)


if __name__ == "__main__":
    demo_idea = {"text": "Prueba de envío desde Tormenta de Ideas."}
    demo_ep = {
        "title": "Test — enviar email de ejemplo",
        "summary": "Este es un correo de prueba del sistema.",
        "number": 1,
        "audio_url": "https://example.com/audio.mp3",
    }
    send_episode_ready(demo_idea, demo_ep)
    print("Correo de prueba enviado.")
