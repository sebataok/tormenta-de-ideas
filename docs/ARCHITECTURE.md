# Arquitectura — Tormenta de Ideas

## Componentes

| Bloque | Elección | Fallback |
|---|---|---|
| Hosting PWA | GitHub Pages | Cloudflare Pages |
| Voz a texto | Web Speech API (Safari iOS, `es-CL`) | Audio crudo + Whisper local en el Mac |
| Storage / sync | IndexedDB (device) + Supabase Free (canónico) | Sólo IndexedDB (modo desconectado) |
| Orquestador backend | Cron/launchd cada 15 min en el Mac | Cron manual + ejecución a demanda |
| Research + guión | Claude CLI (usa plan del usuario) | Prompt manual (stub) |
| TTS | Edge TTS `es-CL-CatalinaNeural`, rate `+5%` | `macOS say -v Monica` |
| Hosting de audio | Supabase Storage bucket público `podcasts` | Cloudflare R2 |
| Notificación | Gmail SMTP (App Password) | Cualquier SMTP libre |
| Autenticación | PIN 4 dígitos (SHA-256 en localStorage) | — |

## Flujo end-to-end

1. En el iPhone, el usuario toca el botón grande. Web Speech API transcribe en tiempo real.
2. Al confirmar, la idea se guarda en IndexedDB y se encola en `outbox` para sync.
3. Cuando hay red, `Storage.syncNow()` empuja la cola a Supabase (upsert idempotente por `id`).
4. El Mac (launchd cada 15 min) corre `process_backlog.py`:
   - Selecciona ideas con status `pending_research` o `pending_deepdive`.
   - Ordena por `priority DESC, updated_at DESC` (más avances = más prioridad).
   - Para cada una: junta contexto (idea + avances + guiones previos), llama a Claude para
     un guión con estructura fija de ~1500 palabras, corre Edge TTS para MP3, sube al bucket
     público, escribe el registro en `episodes` y envía email.
5. El usuario recibe email con link al MP3. La PWA, al abrirse, sincroniza y muestra el
   nuevo episodio en la tarjeta de la idea.

## Modelo de datos

- **ideas** (`id`, `title`, `text`, `priority`, `status`, `created_at`, `updated_at`)
- **advances** (`id`, `idea_id`, `text`, `created_at`) — cada avance suma 1 a `priority`.
- **episodes** (`id`, `idea_id`, `number`, `title`, `summary`, `script`, `audio_url`, `created_at`)

## Decisiones no obvias

- **PIN en cliente**: el hash SHA-256 vive sólo en `localStorage`. No hay auth server-side
  porque la app es de un solo usuario y la seguridad real la da tener el link a la PWA en
  el home screen. Se puede endurecer más adelante con Supabase Auth.
- **Sync bidireccional simple**: el cliente empuja con `Prefer: resolution=merge-duplicates`
  (upsert) y jala todo el estado del servidor. Sin CRDT porque hay un solo usuario y las
  colisiones son casi imposibles.
- **Prioridad = número de avances**: cada `addAdvance` incrementa `priority` y marca la idea
  como `pending_deepdive`. El backend procesa primero las ideas con más avances (profundidad
  antes que amplitud, como pediste).
- **Edge TTS con chunks por párrafo**: evita cortar por límite del endpoint no oficial.
  Los chunks se concatenan directo en un MP3 sin re-encoding (funciona porque los frames
  MPEG son sumables).
- **Bucket público con path por idea**: `podcasts/{idea_id}/ep-01-xxxx.mp3`. Los `episodes.audio_url`
  son URLs públicas — si en el futuro necesitás privacidad, se cambia a URLs firmadas.
