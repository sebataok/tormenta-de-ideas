# ⚡ Tormenta de Ideas

App personal para capturar ideas por voz y recibir por email un podcast investigado
de ~10 minutos por cada avance que hagas sobre la idea.

## Arquitectura corta

```
iPhone (PWA)  ─┐
               ├── Supabase (Postgres + Storage) ── Mac (scheduled task)
               │                                         │
               │                                         ├── Claude CLI  (research + guión)
               │                                         ├── Edge TTS    (voz Catalina, es-CL)
               │                                         ├── Supabase    (sube mp3, marca listo)
               │                                         └── Gmail SMTP  (email con link)
               └────────────────────────────────────────>
```

## Estructura del repo

```
tormenta-de-ideas/
  pwa/          Frontend (deploy a GitHub Pages)
  backend/      Scripts Python que corren en el Mac
  docs/         SETUP + arquitectura
```

## Setup rápido

1. Seguí `docs/SETUP.md` de arriba a abajo (unos 30 minutos la primera vez).
2. Deployá `pwa/` a GitHub Pages.
3. Agregá la app al inicio del iPhone desde Safari (Compartir → Agregar a Inicio).
4. Configurá `backend/.env`.
5. Registrá el cron/launchd que corre `process_backlog.py` cada 15 minutos.

## Estado

MVP funcional. Diseñado para presupuesto cero mensual usando: GitHub Pages + Supabase
Free + Edge TTS + Gmail SMTP + Claude CLI (plan del usuario).
