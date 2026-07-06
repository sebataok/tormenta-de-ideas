# SETUP — Tormenta de Ideas

Guía paso a paso, primera vez. Reservá ~30-40 minutos.

## 0. Requisitos previos

- Cuenta Gmail (ya tenés `sagonzar@gmail.com`).
- Cuenta GitHub (para hostear la PWA).
- Un iPhone con iOS 15+ y Safari.
- El Mac donde corre esto tiene Python 3.10+ y Node opcional.
- Claude Code CLI instalado (`claude`) con tu plan ya autenticado.

---

## 1. Supabase

1. Andá a https://supabase.com y creá cuenta gratis con Google (usá el mismo Gmail).
2. **New project**:
   - Name: `tormenta-ideas`
   - Database Password: generá una fuerte y guardala en el manager.
   - Region: `South America (São Paulo)` o `West US (California)`.
   - Free plan.
3. Cuando esté listo, andá a **Settings → API** y copiá:
   - `URL` → va en `SUPABASE_URL`
   - `anon public` key → va en `SUPABASE_ANON_KEY`
   - `service_role` key (revelar y copiar) → va en `SUPABASE_SERVICE_KEY`
     ⚠ Esta última NUNCA la subas al frontend.
4. Andá a **SQL Editor** → **New query** y pegá TODO el contenido de
   `backend/schema.sql`. Ejecutá. Tenés que ver 3 tablas: `ideas`, `advances`, `episodes`.
5. Andá a **Storage** → **New bucket**:
   - Name: `podcasts`
   - Public bucket: ✅ sí
   - Create.

---

## 2. Gmail App Password

1. Entrá a https://myaccount.google.com/security.
2. Activá **2-Step Verification** si no lo tenés.
3. Volvé y entrá a **App passwords** (o buscá "app password" en la barra).
4. Creá una nueva:
   - App: **Mail**
   - Device: **Mac** (o el nombre que quieras)
5. Google te da 16 caracteres tipo `abcd efgh ijkl mnop`. Copiá esos 16
   caracteres SIN los espacios → van en `SMTP_PASS`.

---

## 3. Backend en el Mac

```bash
cd "~/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas/backend"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.env .env
# Ahora editá .env con los valores reales del paso 1 y 2.
```

Probá que el TTS funcione (genera un mp3 de prueba):

```bash
python -c "
import asyncio, edge_tts
async def go():
    c = edge_tts.Communicate('Hola. Soy Catalina y este es mi primer episodio para tí.', 'es-CL-CatalinaNeural', rate='+5%')
    await c.save('test.mp3')
asyncio.run(go())
"
open test.mp3
```

Debería sonar la voz chilena Catalina. Si no, revisá que `edge-tts` haya
quedado instalado.

Probá el envío de email:

```bash
python send_email.py
# revisá tu bandeja de sagonzar@gmail.com
```

---

## 4. Deployar la PWA a GitHub Pages

### 4.1 Crear el repo

```bash
cd "~/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas"
git init
git add .
git commit -m "MVP tormenta de ideas"
gh repo create tormenta-de-ideas --public --source=. --remote=origin --push
# Si no tenés gh CLI: crealo desde github.com y pusheá manual.
```

### 4.2 Configurar Pages

En GitHub → **Settings → Pages**:
- Source: **Deploy from a branch**
- Branch: `main`, folder: `/pwa`
- Save.

En ~2 minutos vas a tener una URL tipo `https://<usuario>.github.io/tormenta-de-ideas/`.

### 4.3 Configurar la config de la PWA

Antes de push, editá `pwa/index.html` y cambiá:

```js
window.TORMENTA_CONFIG = {
  SUPABASE_URL:  "https://<tu-proyecto>.supabase.co",
  SUPABASE_ANON: "<tu anon public key>",
  APP_VERSION:   "0.1.0"
};
```

Volvé a commitear/push. Pages se rebuildea solo.

---

## 5. Instalar en el iPhone

1. Abrí Safari en el iPhone.
2. Andá a la URL de tu PWA (`https://<usuario>.github.io/tormenta-de-ideas/`).
3. Iniciá sesión con el PIN (la primera vez lo definís, la segunda lo confirma).
4. Tocá el botón **Compartir** ⬆.
5. **Agregar a Inicio**.
6. Nombre: **Tormenta**. Agregar.
7. Volvé al home. Vas a ver el ícono ⚡. Al abrirlo se abre standalone (sin barra Safari).
8. La primera vez que grabes va a pedir permiso de micrófono → **Permitir**.

---

## 6. Programar el loop en el Mac

Elegí **una** de las dos rutas:

### Ruta A — launchd (recomendado en macOS)

Guardá este archivo como `~/Library/LaunchAgents/com.tormenta.backlog.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.tormenta.backlog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd "$HOME/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas/backend" &amp;&amp; ./.venv/bin/python process_backlog.py &gt;&gt; ~/Library/Logs/tormenta.log 2&gt;&amp;1</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

Cargalo:

```bash
launchctl load ~/Library/LaunchAgents/com.tormenta.backlog.plist
```

### Ruta B — cron

```bash
crontab -e
# Agregá esta línea (una sola):
*/15 * * * * cd "$HOME/Documents/Claude/Projects/Taok y Seba/tormenta-de-ideas/backend" && ./.venv/bin/python process_backlog.py >> ~/Library/Logs/tormenta.log 2>&1
```

Chequeá que corre:

```bash
tail -f ~/Library/Logs/tormenta.log
```

---

## 7. Prueba end-to-end

1. Desde el iPhone, agregá tu primera idea grabándola.
2. Esperá ~15 minutos (o corré manualmente `python process_backlog.py`).
3. Revisá tu Gmail: debería llegarte el email con el link al MP3.
4. Reproducí desde el mail o desde la PWA.

---

## Troubleshooting

- **No transcribe en el iPhone**: revisá permisos de micrófono en Ajustes → Safari →
  Micrófono.
- **Sync badge en rojo**: la config de Supabase está mal. Abrí la consola en Safari
  (Ajustes → Safari → Web Inspector activado, luego con el Mac).
- **`edge-tts` falla con 4XX**: probablemente Microsoft cambió el endpoint. Actualizá
  la librería: `pip install -U edge-tts`.
- **Gmail rechaza el login**: rehacé el App Password. Asegurate de escribirlo sin espacios.
- **`process_backlog.py` no corre**: probá manual con `./.venv/bin/python process_backlog.py`.
  Si funciona a mano pero no en launchd, chequeá permisos del `.plist`.
- **Supabase pausa el proyecto**: cada corrida del backlog hace un ping, así que se
  mantiene activo. Si estuviste varias semanas sin actividad, entrá al dashboard de
  Supabase y hacé Resume.
