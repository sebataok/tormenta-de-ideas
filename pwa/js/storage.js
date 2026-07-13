// storage.js — IndexedDB local + sync bidireccional con Supabase.
// Estrategia offline-first:
//   * Toda escritura pasa primero por IndexedDB.
//   * Cada operación (upsert idea, upsert avance) se encola en la tabla `outbox`.
//   * Un intervalo periódico intenta enviar la cola cuando hay red.

const DB_NAME = 'tormenta';
const DB_VERSION = 1;

/** @returns {Promise<IDBDatabase>} */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ideas')) {
        const s = db.createObjectStore('ideas', { keyPath: 'id' });
        s.createIndex('by_created', 'created_at');
      }
      if (!db.objectStoreNames.contains('advances')) {
        const s = db.createObjectStore('advances', { keyPath: 'id' });
        s.createIndex('by_idea', 'idea_id');
      }
      if (!db.objectStoreNames.contains('episodes')) {
        const s = db.createObjectStore('episodes', { keyPath: 'id' });
        s.createIndex('by_idea', 'idea_id');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function tx(db, stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}
function req2p(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const Storage = {
  db: null,

  async init() {
    this.db = await openDB();
    return this;
  },

  // ---------- LECTURA ----------
  async listIdeas() {
    const t = tx(this.db, ['ideas']);
    return await req2p(t.objectStore('ideas').getAll());
  },
  async listAdvances(ideaId) {
    const t = tx(this.db, ['advances']);
    const idx = t.objectStore('advances').index('by_idea');
    return await req2p(idx.getAll(IDBKeyRange.only(ideaId)));
  },
  async listEpisodes(ideaId) {
    const t = tx(this.db, ['episodes']);
    const idx = t.objectStore('episodes').index('by_idea');
    return await req2p(idx.getAll(IDBKeyRange.only(ideaId)));
  },
  async getIdea(id) {
    const t = tx(this.db, ['ideas']);
    return await req2p(t.objectStore('ideas').get(id));
  },

  // ---------- ESCRITURA + OUTBOX ----------
  async saveIdea({ text }) {
    const now = new Date().toISOString();
    const idea = {
      id: uuid(),
      title: this._deriveTitle(text),
      text,
      created_at: now,
      updated_at: now,
      priority: 0,
      status: 'pending_research'
    };
    const t = tx(this.db, ['ideas', 'outbox'], 'readwrite');
    t.objectStore('ideas').put(idea);
    t.objectStore('outbox').add({ op: 'upsert_idea', payload: idea, ts: now });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    return idea;
  },

  async addAdvance(ideaId, { text }) {
    const now = new Date().toISOString();
    const advance = {
      id: uuid(), idea_id: ideaId, text, created_at: now
    };
    const t = tx(this.db, ['ideas', 'advances', 'outbox'], 'readwrite');
    // aumenta priority en la idea
    const ideaReq = t.objectStore('ideas').get(ideaId);
    ideaReq.onsuccess = () => {
      const idea = ideaReq.result;
      if (idea) {
        idea.priority = (idea.priority || 0) + 1;
        idea.updated_at = now;
        idea.status = 'pending_deepdive';
        t.objectStore('ideas').put(idea);
        t.objectStore('outbox').add({ op: 'upsert_idea', payload: idea, ts: now });
      }
    };
    t.objectStore('advances').put(advance);
    t.objectStore('outbox').add({ op: 'upsert_advance', payload: advance, ts: now });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    return advance;
  },

  _deriveTitle(text) {
    const clean = (text || '').trim().replace(/\s+/g, ' ');
    if (clean.length <= 60) return clean || '(sin título)';
    return clean.slice(0, 57) + '...';
  },

  async deleteAdvance(advanceId, ideaId) {
    const now = new Date().toISOString();
    const t = tx(this.db, ['advances', 'ideas', 'outbox'], 'readwrite');
    t.objectStore('advances').delete(advanceId);
    // reducir priority de la idea si la teníamos cargada
    if (ideaId) {
      const req = t.objectStore('ideas').get(ideaId);
      req.onsuccess = () => {
        const idea = req.result;
        if (idea) {
          idea.priority = Math.max(0, (idea.priority || 0) - 1);
          idea.updated_at = now;
          t.objectStore('ideas').put(idea);
          t.objectStore('outbox').add({ op: 'upsert_idea', payload: idea, ts: now });
        }
      };
    }
    t.objectStore('outbox').add({ op: 'delete_advance', payload: { id: advanceId }, ts: now });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    this.syncNow().catch(() => {});
  },

  async deleteEpisode(episodeId) {
    const now = new Date().toISOString();
    const t = tx(this.db, ['episodes', 'outbox'], 'readwrite');
    t.objectStore('episodes').delete(episodeId);
    t.objectStore('outbox').add({ op: 'delete_episode', payload: { id: episodeId }, ts: now });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    this.syncNow().catch(() => {});
  },

  async deleteIdea(ideaId) {
    // 1) Borrar local (ideas + advances + episodes de esa idea)
    const t = tx(this.db, ['ideas', 'advances', 'episodes', 'outbox'], 'readwrite');
    t.objectStore('ideas').delete(ideaId);
    // Advances de esa idea
    const advIdx = t.objectStore('advances').index('by_idea');
    const advReq = advIdx.getAllKeys(IDBKeyRange.only(ideaId));
    advReq.onsuccess = () => (advReq.result || []).forEach(k => t.objectStore('advances').delete(k));
    // Episodes de esa idea
    const epIdx = t.objectStore('episodes').index('by_idea');
    const epReq = epIdx.getAllKeys(IDBKeyRange.only(ideaId));
    epReq.onsuccess = () => (epReq.result || []).forEach(k => t.objectStore('episodes').delete(k));
    // Encolar delete en outbox para propagar al server
    t.objectStore('outbox').add({ op: 'delete_idea', payload: { id: ideaId }, ts: new Date().toISOString() });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    // Sync inmediato si hay red
    this.syncNow().catch(() => {});
  },

  // ---------- SYNC ----------
  async _flushOutbox() {
    const cfg = window.TORMENTA_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) return { skipped: true };

    const t = tx(this.db, ['outbox']);
    const items = await req2p(t.objectStore('outbox').getAll());
    if (!items.length) return { flushed: 0 };

    const headers = {
      'Content-Type': 'application/json',
      'apikey': cfg.SUPABASE_ANON,
      'Authorization': `Bearer ${cfg.SUPABASE_ANON}`,
      'Prefer': 'resolution=merge-duplicates'
    };
    let ok = 0;

    for (const item of items) {
      let url = null, method = 'POST', body = null;
      if (item.op === 'upsert_idea') {
        url = `${cfg.SUPABASE_URL}/rest/v1/ideas`;
        body = JSON.stringify(item.payload);
      } else if (item.op === 'upsert_advance') {
        url = `${cfg.SUPABASE_URL}/rest/v1/advances`;
        body = JSON.stringify(item.payload);
      } else if (item.op === 'delete_idea') {
        // FK con ON DELETE CASCADE limpia advances/episodes en el server.
        url = `${cfg.SUPABASE_URL}/rest/v1/ideas?id=eq.${encodeURIComponent(item.payload.id)}`;
        method = 'DELETE';
      } else if (item.op === 'delete_advance') {
        url = `${cfg.SUPABASE_URL}/rest/v1/advances?id=eq.${encodeURIComponent(item.payload.id)}`;
        method = 'DELETE';
      } else if (item.op === 'delete_episode') {
        url = `${cfg.SUPABASE_URL}/rest/v1/episodes?id=eq.${encodeURIComponent(item.payload.id)}`;
        method = 'DELETE';
      }
      if (!url) { await this._removeOutbox(item.id); continue; }
      try {
        const opts = { method, headers };
        if (body) opts.body = body;
        const r = await fetch(url, opts);
        if (r.ok || r.status === 409 || r.status === 204) {
          await this._removeOutbox(item.id);
          ok++;
        } else {
          console.warn('sync fail', item.op, r.status);
          break;
        }
      } catch (e) {
        console.warn('sync net error', e);
        break;
      }
    }
    return { flushed: ok, remaining: items.length - ok };
  },
  async _removeOutbox(id) {
    const t = tx(this.db, ['outbox'], 'readwrite');
    t.objectStore('outbox').delete(id);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  },

  async pullFromSupabase() {
    const cfg = window.TORMENTA_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) return { skipped: true };
    const headers = { 'apikey': cfg.SUPABASE_ANON, 'Authorization': `Bearer ${cfg.SUPABASE_ANON}` };

    // Reconciliación bidireccional real:
    //  - Server manda todos sus ids con updated_at.
    //  - Local se queda con lo que tenga updated_at más nuevo O si server no lo tiene ya no fue borrado local.
    //  - Los ids que tiene el server y NO están en local → se agregan.
    //  - Los ids que tiene local y NO están en server, pero tampoco en outbox como delete → se conservan
    //    (probablemente son ideas locales que aún no se sincronizaron).
    let changed = false;

    const pullTable = async (path, storeName) => {
      try {
        const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, { headers });
        if (!r.ok) return;
        const rows = await r.json();

        // leer estado actual local para comparar
        const t0 = tx(this.db, [storeName]);
        const localRows = await req2p(t0.objectStore(storeName).getAll());
        const localById = new Map(localRows.map(r => [r.id, r]));
        const remoteById = new Map(rows.map(r => [r.id, r]));

        const t = tx(this.db, [storeName], 'readwrite');
        const store = t.objectStore(storeName);

        // upsert: si el remoto tiene updated_at (o created_at) más nuevo, guardar
        rows.forEach(row => {
          const local = localById.get(row.id);
          if (!local) {
            store.put(row);
            changed = true;
          } else {
            const rTs = row.updated_at || row.created_at || '';
            const lTs = local.updated_at || local.created_at || '';
            if (rTs > lTs) { store.put(row); changed = true; }
          }
        });

        // Si el remoto ya NO tiene un id que local sí tiene → es una idea remota borrada.
        // Solo borrar del local si NO está pendiente en el outbox como upsert (o sea, no
        // es una idea local recién creada que aún no subió).
        const outboxItems = await req2p(tx(this.db, ['outbox']).objectStore('outbox').getAll());
        const pendingIds = new Set(
          outboxItems
            .filter(o => o.op && o.op.startsWith('upsert_'))
            .map(o => o.payload && o.payload.id)
            .filter(Boolean)
        );
        localRows.forEach(local => {
          if (!remoteById.has(local.id) && !pendingIds.has(local.id)) {
            store.delete(local.id);
            changed = true;
          }
        });

        await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
      } catch (e) { console.warn('pull', path, e); }
    };

    await pullTable('ideas?select=*&order=updated_at.desc',    'ideas');
    await pullTable('advances?select=*',                        'advances');
    await pullTable('episodes?select=*&order=created_at.desc', 'episodes');

    return { ok: true, changed };
  },

  async syncNow() {
    const outRes = await this._flushOutbox();
    const pullRes = await this.pullFromSupabase();
    return { ...outRes, changed: !!pullRes?.changed };
  },

  /**
   * Auto-sync.
   * @param {number} intervalMs
   * @param {(status:'pending'|'ok'|'err'|'idle')=>void} onStatus
   * @param {()=>void} onChanged — se llama cuando el pull trajo datos nuevos.
   */
  startAutoSync(intervalMs = 30000, onStatus = () => {}, onChanged = () => {}) {
    const tick = async () => {
      try {
        onStatus('pending');
        const r = await this.syncNow();
        if (r?.skipped) { onStatus('idle'); return; }
        onStatus(r?.remaining ? 'pending' : 'ok');
        if (r?.changed) onChanged();
      } catch (e) {
        console.warn('sync tick err', e);
        onStatus('err');
      }
    };
    tick();
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
    return setInterval(tick, intervalMs);
  }
};
