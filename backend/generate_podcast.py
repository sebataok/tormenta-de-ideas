"""Genera un podcast a partir de una idea + sus avances y episodios previos.

Pipeline por idea:
  1. Junta contexto (idea + avances + guiones previos).
  2. Pide a Claude (via CLI o SDK) un guión con estructura fija.
  3. Convierte guión a MP3 con Edge TTS (es-CL-CatalinaNeural).
  4. Sube MP3 al bucket público de Supabase.
  5. Devuelve dict con url, número, resumen, y transcript.

Diseñado para no depender de una versión específica de Claude Code CLI:
se puede invocar Claude por:
  (a) claude CLI (subprocess) — flag CLAUDE_CMD, default 'claude'
  (b) un prompt manual leído desde un archivo local si CLAUDE_CMD='local'.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

import edge_tts

from supabase_client import SupabaseClient


VOICE = os.environ.get("TTS_VOICE", "es-CL-CatalinaNeural")
RATE = os.environ.get("TTS_RATE", "+5%")   # ligeramente más rápida
PITCH = os.environ.get("TTS_PITCH", "+0Hz")
BUCKET = os.environ.get("PODCAST_BUCKET", "podcasts")

# --- Límite duro de duración del podcast ---
# Ningún episodio puede superar MAX_PODCAST_MINUTES minutos hablados.
# A ~150 palabras/min (ritmo Catalina +5%), 30 min ≈ 4500 palabras.
# Dejamos un pequeño margen (4400) para no rozar el techo.
MAX_PODCAST_MINUTES = int(os.environ.get("MAX_PODCAST_MINUTES", "30"))
WORDS_PER_MINUTE    = int(os.environ.get("WORDS_PER_MINUTE", "150"))
MAX_WORDS = MAX_PODCAST_MINUTES * WORDS_PER_MINUTE - 100  # margen defensivo


def target_words_for_episode(previous_scripts_count: int) -> tuple[int, int]:
    """Rango objetivo (min, max) de palabras según el número de episodio.

    Episodios más avanzados pueden ser más largos, pero nunca superan MAX_WORDS.
    """
    n = previous_scripts_count + 1
    # Base 1500-1700 (10 min), va creciendo ~500 palabras por episodio hasta el tope.
    lo = min(1500 + max(0, n - 1) * 400, MAX_WORDS - 400)
    hi = min(1700 + max(0, n - 1) * 500, MAX_WORDS)
    return lo, hi


# ---------------- Prompt de guión ----------------
SCRIPT_SYSTEM = """Eres un guionista de podcast en español chileno neutro. \
Escribes guiones para que los diga una única voz femenina, en formato monólogo cálido, \
como si conversaras con el oyente. Los episodios son investigativos y profundos: \
usan datos verificados, mencionan fuentes cuando ayudan, y evitan clichés motivacionales."""


def script_user_prompt(idea: dict, advances: list[dict], previous_scripts: list[str]) -> str:
    parts = [
        f"IDEA CENTRAL DEL EPISODIO:\n{idea['text']}\n",
    ]
    if advances:
        parts.append("AVANCES QUE HA HECHO EL USUARIO SOBRE LA IDEA (más recientes al final):")
        for a in advances:
            parts.append(f"- ({a.get('created_at', '')[:10]}) {a['text']}")
        parts.append("")
    if previous_scripts:
        parts.append("EPISODIOS ANTERIORES (guiones completos, para NO repetir y profundizar):")
        for i, s in enumerate(previous_scripts, 1):
            parts.append(f"--- EPISODIO {i} ---\n{s.strip()}\n")

    n = len(previous_scripts) + 1
    lo_words, hi_words = target_words_for_episode(len(previous_scripts))
    lo_min = lo_words // WORDS_PER_MINUTE
    hi_min = hi_words // WORDS_PER_MINUTE
    parts.append(f"""
TAREA:
Escribe el guión del EPISODIO {n} sobre esta idea. Restricciones estrictas:

- Longitud objetivo: {lo_words} a {hi_words} palabras
  (aprox. {lo_min}–{hi_min} minutos hablados a ritmo normal).
- LÍMITE ABSOLUTO: nunca pases de {MAX_WORDS} palabras
  (equivale a {MAX_PODCAST_MINUTES} minutos de audio, tope duro del sistema).
- Español chileno neutro. Sin modismos regionales pesados.
- Estructura obligatoria, marcada con encabezados internos entre corchetes:
  [HOOK 30s] — Enganche fuerte. Presenta la pregunta o tensión central.
  [CONTEXTO 2min] — Sitúa la idea en el mundo: qué se ha pensado, quién lo defiende, quién no.
  [IDEA FUERZA 1] — 1 punto profundo, con datos o ejemplo concreto.
  [IDEA FUERZA 2] — 1 punto profundo, distinto ángulo.
  [IDEA FUERZA 3] — 1 punto profundo, cierra el arco.
  [CIERRE 2min] — 3 próximos pasos accionables y concretos para el oyente.
- Cada episodio debe SER MÁS PROFUNDO que el anterior (sin repetir el material previo),
  pero SIN sobrepasar el tope de {MAX_WORDS} palabras. Si tenés mucho material, priorizá
  lo más denso y guardá el resto para el próximo avance.
- Al inicio del guion, incluye una sola línea con formato:
    TITULO: <título breve del episodio>
    RESUMEN: <2 líneas sobre qué se cubre>
- Escribe SOLO el texto que la voz va a decir (sin acotaciones tipo "*pausa*").
- Evita listas numeradas verbalizadas ("uno, dos, tres"); usá conectores narrativos.
""")
    return "\n".join(parts)


def call_claude_for_script(system: str, user: str) -> str:
    """Invoca Claude para producir el guión.

    Modos:
      * CLAUDE_CMD env var no seteada / 'claude': usa `claude -p <prompt>`
        (CLI del plan del usuario).
      * CLAUDE_CMD='local': lee guión desde un archivo local (para tests).
    """
    mode = os.environ.get("CLAUDE_CMD", "claude")

    if mode == "local":
        stub = Path(os.environ.get("SCRIPT_STUB", "./stub_script.txt"))
        return stub.read_text(encoding="utf-8")

    combined = f"{system}\n\n---\n\n{user}"
    # Se pasa el prompt por stdin para no chocar con el shell.
    try:
        proc = subprocess.run(
            [mode, "-p", "--output-format", "text"],
            input=combined,
            text=True,
            capture_output=True,
            check=True,
            timeout=180,
        )
        return proc.stdout.strip()
    except FileNotFoundError:
        raise RuntimeError(
            f"No encontré el CLI '{mode}'. Instala Claude Code CLI o setea CLAUDE_CMD=local para tests."
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Claude CLI falló ({e.returncode}): {e.stderr[:500]}")


def parse_title_summary(script_text: str) -> tuple[str, str, str]:
    """Extrae TITULO y RESUMEN de las primeras líneas; devuelve (title, summary, body_for_tts)."""
    title = "Nuevo episodio"
    summary = ""
    lines = script_text.splitlines()
    body_start = 0
    for i, line in enumerate(lines[:6]):
        m = re.match(r"^\s*TITULO\s*:\s*(.+)$", line, re.I)
        if m:
            title = m.group(1).strip()
            body_start = max(body_start, i + 1)
        m = re.match(r"^\s*RESUMEN\s*:\s*(.+)$", line, re.I)
        if m:
            summary = m.group(1).strip()
            body_start = max(body_start, i + 1)
    body = "\n".join(lines[body_start:]).strip()
    # Quita marcas de estructura para que Catalina no las diga
    body = re.sub(r"\[[A-ZÁÉÍÓÚÑ0-9 ·]+?\]", "", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return title, summary, body


# ---------------- TTS ----------------
async def synth_tts(text: str, out_mp3: Path) -> None:
    """Divide el texto en chunks amables para Edge TTS y concatena a un solo MP3."""
    # Chunk por párrafos para evitar cortes largos y respetar límites del endpoint.
    paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    with out_mp3.open("wb") as f:
        for para in paras:
            comm = edge_tts.Communicate(para, VOICE, rate=RATE, pitch=PITCH)
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])


# ---------------- Pipeline ----------------
def generate_for_idea(sb: SupabaseClient, idea: dict) -> dict:
    advances = sb.select("advances", {"select": "*", "idea_id": f"eq.{idea['id']}", "order": "created_at.asc"})
    previous_episodes = sb.select("episodes", {"select": "*", "idea_id": f"eq.{idea['id']}", "order": "number.asc"})
    previous_scripts = [ep.get("script", "") for ep in previous_episodes if ep.get("script")]

    system = SCRIPT_SYSTEM
    user = script_user_prompt(idea, advances, previous_scripts)
    print(f"  · pidiendo guión a Claude (contexto: {len(advances)} avances, {len(previous_scripts)} episodios previos)")
    raw = call_claude_for_script(system, user)
    title, summary, body = parse_title_summary(raw)
    word_count = len(body.split())
    est_minutes = word_count / WORDS_PER_MINUTE
    print(f"  · guión listo: '{title}' — {word_count} palabras (≈ {est_minutes:.1f} min)")

    # --- Enforce hard cap: si Claude se pasó de MAX_WORDS, truncamos ---
    if word_count > MAX_WORDS:
        print(f"  ⚠ excede el tope de {MAX_PODCAST_MINUTES} min ({MAX_WORDS} palabras). Truncando...")
        words = body.split()
        # Truncar dejando espacio para un cierre corto
        keep = MAX_WORDS - 40
        body = " ".join(words[:keep]).rstrip(",;:") + ". Hasta acá el episodio de hoy; en el próximo avance retomamos lo que quedó pendiente."
        word_count = len(body.split())
        est_minutes = word_count / WORDS_PER_MINUTE
        print(f"  · guión truncado: {word_count} palabras (≈ {est_minutes:.1f} min)")

    # TTS
    with tempfile.TemporaryDirectory() as td:
        out_mp3 = Path(td) / "ep.mp3"
        asyncio.run(synth_tts(body, out_mp3))
        audio_bytes = out_mp3.read_bytes()
    print(f"  · MP3 generado: {len(audio_bytes)//1024} KB")

    number = len(previous_episodes) + 1
    filename = f"{idea['id']}/ep-{number:02d}-{uuid.uuid4().hex[:8]}.mp3"
    audio_url = sb.upload_public(BUCKET, filename, audio_bytes, "audio/mpeg")
    print(f"  · subido: {audio_url}")

    ep = {
        "id": str(uuid.uuid4()),
        "idea_id": idea["id"],
        "number": number,
        "title": title,
        "summary": summary,
        "script": raw,
        "audio_url": audio_url,
    }
    sb.upsert("episodes", ep)
    sb.update("ideas", {"id": idea["id"]}, {"status": "delivered"})
    return ep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idea-id", help="Procesar sólo una idea por id (opcional)")
    args = ap.parse_args()

    sb = SupabaseClient.from_env()
    ideas = sb.select("ideas", {"select": "*", "id": f"eq.{args.idea_id}"} if args.idea_id else {"select": "*"})
    for idea in ideas:
        print(f"→ Generando podcast para: {idea.get('title', idea['id'])}")
        ep = generate_for_idea(sb, idea)
        print(f"✓ Episodio {ep['number']} listo: {ep['audio_url']}")


if __name__ == "__main__":
    main()
